// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title  TickloreTicketV2 — the event-model rewrite (ADR-001 rev 3)
/// @notice Events live on-chain. Each event carries its organizer's address, which
///         is the authority for minting and (in the future vault) writing. Ticket
///         data is now tiny — event data is REFERENCED, not copied — so mintTicket
///         is 4 args and the 14-arg stack-depth problem is gone by design.
///
///         Deliberately dropped vs V1 (flagged for review):
///           - price on the ticket   → a keepsake is a memory, not a receipt (Stripe holds price)
///           - tier on the ticket     → not in rev 3's ticket state
///           - transfer lock / non-transferable → rev 3 ships free transfer from day one
contract TickloreTicketV2 is ERC721, Ownable, Pausable {
    // -----------------------------------------------------------------------
    // Events (the on-chain record) + delegation
    // -----------------------------------------------------------------------
    struct Event {
        address organizer;            // authoritative — mint + (future) vault write authority
        string  name;
        string  venue;
        uint64  date;                 // unix; shown in metadata, not drawn on the card
        string  sponsorLeadIn;
        string  sponsorName;
        uint8   palette;
        bool    inscriptionsAllowed;  // organizer opt-in, default false
        bool    soulbound;            // organizer opt-in: permanently non-transferable, forever
        bool    locked;               // set true on first mint — the keepsake can't change under a holder
        bool    exists;
    }

    struct Ticket {
        uint256 eventId;
        uint256 pricePaid;    // whole cents; shown on the keepsake ("we paid WHAT?!")
        string  buyerName;
        string  inscription;
        bool    redeemed;
    }

    /// Anti-scalp: a ticket can't be transferred until this long after its event,
    /// so it can't be flipped during the run-up or the event itself. After that it
    /// moves freely as a keepsake.
    uint256 public constant TRANSFER_UNLOCK_WINDOW = 10 days;

    mapping(uint256 => Event) private eventsById;
    mapping(uint256 => Ticket) private ticketsById;                     // tokenId → ticket
    mapping(uint256 => mapping(address => bool)) private eventAgents;   // eventId → agent → allowed

    uint256 public nextEventId = 1;
    uint256 public nextTokenId = 1;

    event EventCreated(uint256 indexed eventId, address indexed organizer, string name);
    event EventUpdated(uint256 indexed eventId);
    event EventLocked(uint256 indexed eventId);
    event AgentSet(uint256 indexed eventId, address indexed agent, bool allowed);
    event TicketMinted(uint256 indexed tokenId, uint256 indexed eventId, address indexed to);
    event TicketRedeemed(uint256 indexed tokenId);

    constructor(address initialOwner) ERC721("Ticklore Ticket", "TCKL") Ownable(initialOwner) {}

    // -----------------------------------------------------------------------
    // Organizer surface
    // -----------------------------------------------------------------------

    /// @notice Create an event. The caller becomes its authoritative organizer.
    function createEvent(
        string calldata name,
        string calldata venue,
        uint64 date,
        string calldata sponsorLeadIn,
        string calldata sponsorName,
        uint8 palette,
        bool inscriptionsAllowed,
        bool soulbound
    ) external returns (uint256 eventId) {
        eventId = nextEventId++;
        Event storage e = eventsById[eventId];
        e.organizer = msg.sender;
        e.name = name;
        e.venue = venue;
        e.date = date;
        e.sponsorLeadIn = sponsorLeadIn;
        e.sponsorName = sponsorName;
        e.palette = palette;
        e.inscriptionsAllowed = inscriptionsAllowed;
        e.soulbound = soulbound;
        e.exists = true;
        emit EventCreated(eventId, msg.sender, name);
    }

    /// @notice Edit an event — allowed ONLY before the first ticket is minted.
    ///         After that the event is locked forever, so a sold keepsake's art
    ///         can never change under its holder (lock-on-first-mint).
    function updateEvent(
        uint256 eventId,
        string calldata name,
        string calldata venue,
        uint64 date,
        string calldata sponsorLeadIn,
        string calldata sponsorName,
        uint8 palette,
        bool inscriptionsAllowed,
        bool soulbound
    ) external {
        Event storage e = eventsById[eventId];
        require(e.exists, "no such event");
        require(msg.sender == e.organizer, "not organizer");
        require(!e.locked, "event locked (tickets minted)");
        e.name = name;
        e.venue = venue;
        e.date = date;
        e.sponsorLeadIn = sponsorLeadIn;
        e.sponsorName = sponsorName;
        e.palette = palette;
        e.inscriptionsAllowed = inscriptionsAllowed;
        e.soulbound = soulbound;
        emit EventUpdated(eventId);
    }

    /// @notice Delegate mint/write authority to an agent (e.g. Ticklore's server),
    ///         revocable any time by the organizer without anyone's cooperation.
    function setAgent(uint256 eventId, address agent, bool allowed) external {
        require(msg.sender == eventsById[eventId].organizer, "not organizer");
        eventAgents[eventId][agent] = allowed;
        emit AgentSet(eventId, agent, allowed);
    }

    function isEventAgent(uint256 eventId, address who) public view returns (bool) {
        return eventAgents[eventId][who];
    }

    function organizerOf(uint256 eventId) public view returns (address) {
        return eventsById[eventId].organizer;
    }

    function eventIdOf(uint256 tokenId) public view returns (uint256) {
        require(_ownerOf(tokenId) != address(0), "no such ticket");
        return ticketsById[tokenId].eventId;
    }

    /// @dev Organizer or a delegated agent.
    function _canManage(uint256 eventId) internal view returns (bool) {
        return msg.sender == eventsById[eventId].organizer || eventAgents[eventId][msg.sender];
    }

    // -----------------------------------------------------------------------
    // Mint + redeem
    // -----------------------------------------------------------------------

    /// @notice Mint one ticket for an event. Event data is referenced at render
    ///         time, so this stays tiny. The first mint locks the event.
    function mintTicket(
        uint256 eventId,
        address to,
        uint256 price,
        string calldata buyerName,
        string calldata inscription
    ) external whenNotPaused returns (uint256 tokenId) {
        Event storage e = eventsById[eventId];
        require(e.exists, "no such event");
        require(_canManage(eventId), "not organizer/agent");
        if (bytes(inscription).length > 0 || bytes(buyerName).length > 0) {
            require(e.inscriptionsAllowed, "inscriptions off for this event");
        }
        if (!e.locked) {
            e.locked = true;
            emit EventLocked(eventId);
        }

        tokenId = nextTokenId++;
        Ticket storage t = ticketsById[tokenId];
        t.eventId = eventId;
        t.pricePaid = price;
        t.buyerName = buyerName;
        t.inscription = inscription;

        _safeMint(to, tokenId);
        emit TicketMinted(tokenId, eventId, to);
    }

    /// @notice Door redemption — a flag, never a burn (burning would seal the vault).
    function redeem(uint256 tokenId) external {
        require(_ownerOf(tokenId) != address(0), "no such ticket");
        uint256 eventId = ticketsById[tokenId].eventId;
        require(_canManage(eventId), "not organizer/agent");
        require(!ticketsById[tokenId].redeemed, "already redeemed");
        ticketsById[tokenId].redeemed = true;
        emit TicketRedeemed(tokenId);
    }

    /// @notice Read a ticket's composed data (event + ticket).
    function ticketData(uint256 tokenId)
        external
        view
        returns (Event memory ev, Ticket memory tk)
    {
        require(_ownerOf(tokenId) != address(0), "no such ticket");
        tk = ticketsById[tokenId];
        ev = eventsById[tk.eventId];
    }

    // -----------------------------------------------------------------------
    // On-chain metadata + art — composed from event + ticket at render time
    // -----------------------------------------------------------------------

    function tokenURI(uint256 tokenId) public view override returns (string memory) {
        require(_ownerOf(tokenId) != address(0), "no such ticket");
        Ticket memory t = ticketsById[tokenId];
        Event memory e = eventsById[t.eventId];

        string memory image = string.concat(
            "data:image/svg+xml;base64,",
            Base64.encode(bytes(_buildSVG(tokenId, e, t)))
        );

        string memory sponsorAttr = bytes(e.sponsorName).length > 0
            ? string.concat('{"trait_type":"Sponsor","value":"', _escapeJSON(e.sponsorName), '"},')
            : "";
        string memory holderAttr = bytes(t.buyerName).length > 0
            ? string.concat('{"trait_type":"Held by","value":"', _escapeJSON(t.buyerName), '"},')
            : "";

        string memory json = string.concat(
            '{"name":"Ticklore #', Strings.toString(tokenId), unicode" — ", _escapeJSON(e.name), '",',
            '"description":"A one-of-one keepsake ticket on Ticklore. Every ticket has a story.",',
            '"image":"', image, '",',
            '"attributes":[',
                '{"trait_type":"Event","value":"', _escapeJSON(e.name), '"},',
                '{"trait_type":"Venue","value":"', _escapeJSON(e.venue), '"},',
                sponsorAttr,
                holderAttr,
                '{"trait_type":"Redeemed","value":"', t.redeemed ? "Yes" : "No", '"}',
            ']}'
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    struct Palette {
        string bg0; string bg1; string bg2;
        string accent; string bright; string ink; string sub;
    }

    function _palette(uint8 p) internal pure returns (Palette memory) {
        if (p == 1) return Palette("#20283a", "#161c2b", "#0e121c", "#8fa3c0", "#d3ddec", "#F2F4F8", "#8b98ac"); // Midnight & Silver
        if (p == 2) return Palette("#3c1622", "#290d17", "#1b070d", "#C9A227", "#E9C558", "#F6EAE0", "#c48f99"); // Burgundy & Gold
        if (p == 3) return Palette("#173a2d", "#0f2a1f", "#0a2017", "#cdba8c", "#ecdfbe", "#F3EEE1", "#93b4a0"); // Forest & Cream
        if (p == 4) return Palette("#2b1a3a", "#1e1129", "#140b1c", "#c58fb0", "#e6b9d2", "#F3ECF3", "#a58fb8"); // Plum & Rose
        return Palette("#123138", "#0B2024", "#081619", "#C9A227", "#E3C25E", "#F1E9DD", "#7FB3A6");             // Teal & Gold (default)
    }

    function _stamp(bool redeemed, string memory bright) internal pure returns (string memory) {
        if (!redeemed) return "";
        return string.concat(
            '<text x="400" y="280" fill="', bright,
            '" fill-opacity="0.14" font-family="Georgia, serif" font-style="italic" font-size="130" text-anchor="middle" transform="rotate(-16 400 260)">ADMITTED</text>'
        );
    }

    function _sponsorLine(Event memory e, string memory accent) internal pure returns (string memory) {
        if (bytes(e.sponsorName).length == 0) return "";
        string memory credit = bytes(e.sponsorLeadIn).length > 0
            ? string.concat(_escapeXML(e.sponsorLeadIn), unicode" · ", _escapeXML(e.sponsorName))
            : _escapeXML(e.sponsorName);
        return string.concat(
            '<text x="52" y="322" fill="', accent,
            '" font-family="monospace" font-size="15" letter-spacing="2">', credit, '</text>'
        );
    }

    function _inscription(Ticket memory t, string memory ink, string memory sub) internal pure returns (string memory) {
        string memory out = "";
        if (bytes(t.inscription).length > 0) {
            out = string.concat(
                '<text x="52" y="384" fill="', ink,
                '" font-family="Georgia, serif" font-style="italic" font-size="21">',
                unicode"“", _escapeXML(t.inscription), unicode"”", '</text>'
            );
        }
        if (bytes(t.buyerName).length > 0) {
            out = string.concat(out,
                '<text x="52" y="412" fill="', sub,
                '" font-family="monospace" font-size="15" letter-spacing="1">',
                unicode"— ", _escapeXML(t.buyerName), '</text>'
            );
        }
        return out;
    }

    function _buildSVG(uint256 tokenId, Event memory e, Ticket memory t) internal pure returns (string memory) {
        Palette memory c = _palette(e.palette);

        string memory frame = string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">',
            '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
            '<stop offset="0" stop-color="', c.bg0, '"/><stop offset="0.55" stop-color="', c.bg1, '"/><stop offset="1" stop-color="', c.bg2, '"/>',
            '</linearGradient></defs>',
            '<rect width="800" height="500" fill="url(#bg)"/>',
            '<rect x="18" y="18" width="764" height="464" rx="18" fill="none" stroke="', c.accent, '" stroke-opacity="0.55" stroke-width="1.5"/>'
        );

        string memory masthead = string.concat(
            '<text x="52" y="70" fill="', c.bright, '" font-family="monospace" font-size="22" letter-spacing="7">TICKLORE</text>',
            '<line x1="52" y1="90" x2="748" y2="90" stroke="', c.accent, '" stroke-opacity="0.25" stroke-width="1"/>',
            _stamp(t.redeemed, c.bright),
            '<text x="52" y="188" fill="', c.accent, '" font-family="monospace" font-size="16" letter-spacing="5">THE STORY</text>'
        );

        string memory story = string.concat(
            '<text x="52" y="238" fill="', c.ink, '" font-family="Georgia, serif" font-size="46">', _escapeXML(e.name), '</text>',
            bytes(e.venue).length > 0
                ? string.concat('<text x="52" y="270" fill="', c.sub, '" font-family="monospace" font-size="17" letter-spacing="1">', _escapeXML(e.venue), '</text>')
                : "",
            _sponsorLine(e, c.accent),
            _inscription(t, c.ink, c.sub)
        );

        string memory priceStr = t.pricePaid == 0 ? "Free" : _formatMoney(t.pricePaid);
        string memory footer = string.concat(
            '<text x="52" y="462" fill="', c.ink, '" font-family="monospace" font-size="22">', priceStr, '</text>',
            '<text x="748" y="462" fill="', c.bright, '" font-family="Georgia, serif" font-size="44" text-anchor="end">#', Strings.toString(tokenId), '</text>',
            '<text x="52" y="478" fill="', c.sub, '" fill-opacity="0.6" font-family="monospace" font-size="12" letter-spacing="3">EVERY TICKET HAS A STORY</text>',
            '</svg>'
        );

        return string.concat(frame, masthead, story, footer);
    }

    // -----------------------------------------------------------------------
    // Escaping (unchanged from V1) — organizer/buyer text is embedded into JSON
    // and SVG, each with its own dangerous characters.
    // -----------------------------------------------------------------------

    function _escapeJSON(string memory input) internal pure returns (string memory) {
        bytes memory b = bytes(input);
        bytes memory buf = new bytes(b.length * 6);
        uint256 n = 0;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == '"') { buf[n++] = "\\"; buf[n++] = '"'; }
            else if (c == "\\") { buf[n++] = "\\"; buf[n++] = "\\"; }
            else if (uint8(c) < 0x20) {
                buf[n++] = "\\"; buf[n++] = "u"; buf[n++] = "0"; buf[n++] = "0";
                buf[n++] = _hexDigit(uint8(c) >> 4); buf[n++] = _hexDigit(uint8(c) & 0x0f);
            } else { buf[n++] = c; }
        }
        return string(_trim(buf, n));
    }

    function _escapeXML(string memory input) internal pure returns (string memory) {
        bytes memory b = bytes(input);
        bytes memory buf = new bytes(b.length * 6);
        uint256 n = 0;
        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];
            if (c == "&") { buf[n++] = "&"; buf[n++] = "a"; buf[n++] = "m"; buf[n++] = "p"; buf[n++] = ";"; }
            else if (c == "<") { buf[n++] = "&"; buf[n++] = "l"; buf[n++] = "t"; buf[n++] = ";"; }
            else if (c == ">") { buf[n++] = "&"; buf[n++] = "g"; buf[n++] = "t"; buf[n++] = ";"; }
            else if (c == '"') { buf[n++] = "&"; buf[n++] = "q"; buf[n++] = "u"; buf[n++] = "o"; buf[n++] = "t"; buf[n++] = ";"; }
            else if (c == "'") { buf[n++] = "&"; buf[n++] = "a"; buf[n++] = "p"; buf[n++] = "o"; buf[n++] = "s"; buf[n++] = ";"; }
            else if (uint8(c) < 0x20) { continue; }
            else { buf[n++] = c; }
        }
        return string(_trim(buf, n));
    }

    function _trim(bytes memory buf, uint256 n) private pure returns (bytes memory) {
        bytes memory out = new bytes(n);
        for (uint256 i = 0; i < n; i++) out[i] = buf[i];
        return out;
    }

    function _hexDigit(uint8 v) private pure returns (bytes1) {
        return v < 10 ? bytes1(uint8(bytes1("0")) + v) : bytes1(uint8(bytes1("a")) + (v - 10));
    }

    /// @dev Whole cents → "$25.00".
    function _formatMoney(uint256 cents) internal pure returns (string memory) {
        uint256 dollars = cents / 100;
        uint256 rem = cents % 100;
        string memory remStr = rem < 10 ? string.concat("0", Strings.toString(rem)) : Strings.toString(rem);
        return string.concat("$", Strings.toString(dollars), ".", remStr);
    }

    // -----------------------------------------------------------------------
    // Emergency stop — mints + transfers pause; reads never do.
    // -----------------------------------------------------------------------
    function pause() external onlyOwner { _pause(); }
    function unpause() external onlyOwner { _unpause(); }

    function _update(address to, uint256 tokenId, address auth) internal override returns (address) {
        address from = _ownerOf(tokenId);
        // Real transfer between two people (mints have from == address(0) and are
        // always allowed). Blocked while paused, and blocked until the anti-scalp
        // window has passed — 10 days after the event.
        if (from != address(0) && to != address(0)) {
            require(!paused(), "transfers paused");
            Event storage e = eventsById[ticketsById[tokenId].eventId];
            require(!e.soulbound, "ticket is permanently non-transferable");
            require(block.timestamp >= uint256(e.date) + TRANSFER_UNLOCK_WINDOW, "locked until 10 days after the event");
        }
        return super._update(to, tokenId, auth);
    }
}
