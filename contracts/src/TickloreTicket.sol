// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title  TickloreTicket
/// @notice Every ticket is a one-of-one keepsake. This is the foundation.
contract TickloreTicket is ERC721, Ownable, AccessControl, Pausable {
    // -----------------------------------------------------------------------
    // Roles
    //
    // Two jobs need doing day to day, and neither should require the keys to
    // the whole contract:
    //
    //   MINTER_ROLE  the server that mints a ticket once a payment clears.
    //                It lives online and is therefore the most exposed thing
    //                we run. If it is compromised, an attacker can mint junk
    //                tickets — bad, but survivable, because the owner can
    //                revoke the role and the contract itself is untouched.
    //
    //   STAFF_ROLE   a phone at the door scanning tickets. Handing door staff
    //                the master key so they can mark tickets used would be
    //                absurd; this is the narrow permission that lets them do
    //                exactly one thing.
    //
    // The owner holds DEFAULT_ADMIN_ROLE and can grant or revoke either at any
    // time. The distinction that matters: losing a role is an inconvenience,
    // losing ownership is a catastrophe. Keeping them separate means the thing
    // most likely to be stolen is the thing that costs least.
    // -----------------------------------------------------------------------

    bytes32 public constant MINTER_ROLE = keccak256("MINTER_ROLE");
    bytes32 public constant STAFF_ROLE  = keccak256("STAFF_ROLE");
    bytes32 public constant PAUSER_ROLE = keccak256("PAUSER_ROLE");

    struct TicketData {
        string  eventName;
        uint64  eventDate;
        string  tier;
        uint256 pricePaid;
        uint256 donationAmount;
        bool    used;
        uint64  transferUnlock;
        bool    nonTransferable;
        address originalHolder;
        // Organizer design choices, engraved with the ticket.
        //   sponsorLabel + sponsorName  render as one graceful credit line.
        //   palette                     selects the color scheme (0 = the
        //                               original teal, so existing art is
        //                               unchanged).
        //   style                       layout variant — stored now, rendered
        //                               in a later pass, so adding it costs no
        //                               change to how this contract is called.
        string  sponsorLabel;
        string  sponsorName;
        uint8   palette;
        uint8   style;
        // The buyer's own keepsake touch: their name and one memorable line,
        // set at purchase. This is the ticket-to-person memory — the whole point.
        string  holderName;
        string  message;
    }

    mapping(uint256 => TicketData) public tickets;
    uint256 public nextTicketId = 1;

    event TicketMinted(uint256 indexed ticketId, address indexed to, string eventName);
    event TicketCheckedIn(uint256 indexed ticketId);

    constructor(address initialOwner)
        ERC721("Ticklore Ticket", "TCKL")
        Ownable(initialOwner)
    {
        // The owner starts with every role, so a fresh deployment behaves
        // exactly as before and nothing is unusable out of the box. Delegation
        // is then a deliberate act: grant MINTER_ROLE to the server wallet,
        // STAFF_ROLE to the door device, and keep ownership somewhere cold.
        _grantRole(DEFAULT_ADMIN_ROLE, initialOwner);
        _grantRole(MINTER_ROLE, initialOwner);
        _grantRole(STAFF_ROLE, initialOwner);
        _grantRole(PAUSER_ROLE, initialOwner);
    }

    function mintTicket(
        address to,
        string calldata eventName,
        uint64 eventDate,
        string calldata tier,
        uint256 pricePaid,
        uint256 donationAmount,
        uint64 transferUnlock,
        bool nonTransferable,
        string calldata sponsorLabel,
        string calldata sponsorName,
        uint8 palette,
        uint8 style,
        string calldata holderName,
        string calldata message
    ) external onlyRole(MINTER_ROLE) whenNotPaused returns (uint256) {
        uint256 ticketId = nextTicketId;
        nextTicketId++;

        // Write straight to storage field-by-field. A `TicketData({...})` literal
        // would need all twelve values live on the stack at once — past the EVM's
        // 16-slot limit with this many parameters. `used` stays its default false.
        TicketData storage d = tickets[ticketId];
        d.eventName       = eventName;
        d.eventDate       = eventDate;
        d.tier            = tier;
        d.pricePaid       = pricePaid;
        d.donationAmount  = donationAmount;
        d.transferUnlock  = transferUnlock;
        d.nonTransferable = nonTransferable;
        d.originalHolder  = to;
        d.sponsorLabel    = sponsorLabel;
        d.sponsorName     = sponsorName;
        d.palette         = palette;
        d.style           = style;
        d.holderName      = holderName;
        d.message         = message;

        _safeMint(to, ticketId);
        emit TicketMinted(ticketId, to, eventName);
        return ticketId;
    }

    function checkIn(uint256 ticketId) external onlyRole(STAFF_ROLE) {
        require(_ownerOf(ticketId) != address(0), "Ticklore: no such ticket");
        require(!tickets[ticketId].used, "Ticklore: ticket already used");
        tickets[ticketId].used = true;
        emit TicketCheckedIn(ticketId);
    }

    /// @notice Standard NFT metadata — the ticket describes AND draws itself, on-chain.
    function tokenURI(uint256 ticketId) public view override returns (string memory) {
        require(_ownerOf(ticketId) != address(0), "Ticklore: no such ticket");
        TicketData memory t = tickets[ticketId];

        string memory priceStr    = t.pricePaid == 0 ? "Free" : _formatMoney(t.pricePaid);
        string memory donationStr = t.donationAmount == 0 ? "None" : _formatMoney(t.donationAmount);
        string memory usedStr     = t.used ? "Yes" : "No";
        string memory image       = _svgDataURI(ticketId, t);

        // Escape once, reuse — building the escaped string twice would double the gas.
        string memory nameJSON = _escapeJSON(t.eventName);
        string memory tierJSON = _escapeJSON(t.tier);

        // A Sponsor trait, only when there is one — no blank attributes.
        string memory sponsorAttr = bytes(t.sponsorName).length > 0
            ? string.concat('{"trait_type":"Sponsor","value":"', _escapeJSON(t.sponsorName), '"},')
            : "";
        // Likewise a "Held by" trait for the buyer's name, only when set.
        string memory holderAttr = bytes(t.holderName).length > 0
            ? string.concat('{"trait_type":"Held by","value":"', _escapeJSON(t.holderName), '"},')
            : "";

        string memory json = string.concat(
            '{"name":"Ticklore #', Strings.toString(ticketId), unicode" — ", nameJSON, '",',
            '"description":"A one-of-one keepsake ticket on Ticklore. Every ticket has a story.",',
            '"image":"', image, '",',
            '"attributes":[',
                '{"trait_type":"Event","value":"', nameJSON, '"},',
                '{"trait_type":"Tier","value":"', tierJSON, '"},',
                sponsorAttr,
                holderAttr,
                '{"trait_type":"Price","value":"', priceStr, '"},',
                '{"trait_type":"Donation","value":"', donationStr, '"},',
                '{"trait_type":"Checked In","value":"', usedStr, '"}',
            ']}'
        );

        return string.concat("data:application/json;base64,", Base64.encode(bytes(json)));
    }

    /// @dev Draw the ticket as an SVG and wrap it as a self-contained image data URI.
    function _svgDataURI(uint256 ticketId, TicketData memory t) internal pure returns (string memory) {
        return string.concat(
            "data:image/svg+xml;base64,",
            Base64.encode(bytes(_buildSVG(ticketId, t)))
        );
    }

    /// @dev The curated color schemes. Seven colors describe a whole ticket.
    ///      Index 0 is the original teal, so a ticket minted with no palette set
    ///      renders exactly as it always did.
    struct Palette {
        string bg0; string bg1; string bg2;   // background gradient (top → bottom)
        string accent;                          // border, rules, section labels
        string bright;                          // wordmark, ticket number, stamp
        string ink;                             // event name, price
        string sub;                             // tier, footer
    }

    function _palette(uint8 p) internal pure returns (Palette memory) {
        if (p == 1) return Palette("#20283a", "#161c2b", "#0e121c", "#8fa3c0", "#d3ddec", "#F2F4F8", "#8b98ac"); // Midnight & Silver
        if (p == 2) return Palette("#3c1622", "#290d17", "#1b070d", "#C9A227", "#E9C558", "#F6EAE0", "#c48f99"); // Burgundy & Gold
        if (p == 3) return Palette("#173a2d", "#0f2a1f", "#0a2017", "#cdba8c", "#ecdfbe", "#F3EEE1", "#93b4a0"); // Forest & Cream
        if (p == 4) return Palette("#2b1a3a", "#1e1129", "#140b1c", "#c58fb0", "#e6b9d2", "#F3ECF3", "#a58fb8"); // Plum & Rose
        return Palette("#123138", "#0B2024", "#081619", "#C9A227", "#E3C25E", "#F1E9DD", "#7FB3A6");             // Teal & Gold (default)
    }

    /// @dev The "ADMITTED" watermark, only after check-in.
    function _stamp(bool used, string memory bright) internal pure returns (string memory) {
        if (!used) return "";
        return string.concat(
            '<text x="400" y="280" fill="', bright,
            '" fill-opacity="0.14" font-family="Georgia, serif" font-style="italic" font-size="130" text-anchor="middle" transform="rotate(-16 400 260)">ADMITTED</text>'
        );
    }

    /// @dev One graceful sponsor credit line, only when a sponsor name is set.
    ///      Both parts are escaped — a sponsor called  Ben & Jerry's  is safe.
    function _sponsorLine(TicketData memory t, string memory accent) internal pure returns (string memory) {
        if (bytes(t.sponsorName).length == 0) return "";
        string memory credit = bytes(t.sponsorLabel).length > 0
            ? string.concat(_escapeXML(t.sponsorLabel), unicode" · ", _escapeXML(t.sponsorName))
            : _escapeXML(t.sponsorName);
        return string.concat(
            '<text x="52" y="322" fill="', accent,
            '" font-family="monospace" font-size="15" letter-spacing="2">', credit, '</text>'
        );
    }

    /// @dev The buyer's keepsake inscription: a memorable line in italic, signed
    ///      with their name. Either part is optional; both are escaped.
    function _inscription(TicketData memory t, string memory ink, string memory sub) internal pure returns (string memory) {
        string memory out = "";
        if (bytes(t.message).length > 0) {
            out = string.concat(
                '<text x="52" y="384" fill="', ink,
                '" font-family="Georgia, serif" font-style="italic" font-size="21">',
                unicode"“", _escapeXML(t.message), unicode"”", '</text>'
            );
        }
        if (bytes(t.holderName).length > 0) {
            out = string.concat(out,
                '<text x="52" y="412" fill="', sub,
                '" font-family="monospace" font-size="15" letter-spacing="1">',
                unicode"— ", _escapeXML(t.holderName), '</text>'
            );
        }
        return out;
    }

    function _buildSVG(uint256 ticketId, TicketData memory t) internal pure returns (string memory) {
        Palette memory c = _palette(t.palette);
        string memory priceStr = t.pricePaid == 0 ? "Free" : _formatMoney(t.pricePaid);

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
            _stamp(t.used, c.bright),
            '<text x="52" y="188" fill="', c.accent, '" font-family="monospace" font-size="16" letter-spacing="5">CHAPTER</text>'
        );

        string memory story = string.concat(
            '<text x="52" y="238" fill="', c.ink, '" font-family="Georgia, serif" font-size="46">', _escapeXML(t.eventName), '</text>',
            '<text x="52" y="274" fill="', c.sub, '" font-family="monospace" font-size="18" letter-spacing="1">', _escapeXML(t.tier), '</text>',
            _sponsorLine(t, c.accent),
            _inscription(t, c.ink, c.sub)
        );

        string memory footer = string.concat(
            '<text x="52" y="460" fill="', c.ink, '" font-family="monospace" font-size="22">', priceStr, '</text>',
            '<text x="748" y="462" fill="', c.bright, '" font-family="Georgia, serif" font-size="44" text-anchor="end">#', Strings.toString(ticketId), '</text>',
            '<text x="52" y="478" fill="', c.sub, '" fill-opacity="0.6" font-family="monospace" font-size="12" letter-spacing="3">EVERY TICKET HAS A STORY</text>',
            '</svg>'
        );

        return string.concat(frame, masthead, story, footer);
    }

    /// @dev Turn whole cents into "$25.00". Solidity has no decimals, so we do it by hand.
    function _formatMoney(uint256 cents) internal pure returns (string memory) {
        uint256 dollars = cents / 100;
        uint256 rem     = cents % 100;
        string memory remStr = rem < 10
            ? string.concat("0", Strings.toString(rem))
            : Strings.toString(rem);
        return string.concat("$", Strings.toString(dollars), ".", remStr);
    }

    // ---------------------------------------------------------------------
    // Escaping
    //
    // Organizer-supplied text (eventName, tier) gets embedded into two very
    // different documents: a JSON metadata file and an SVG image. Each has its
    // own set of characters that mean "stop reading text, start reading
    // structure." If we paste raw text in, a name like  Mom & Dad's 50th  or
    // Summer "Gala"  can break the document — permanently, because this is
    // written on-chain and can never be edited.
    //
    // These two functions neutralize those characters. Same idea both times,
    // different rulebook, because JSON and XML disagree about what's dangerous.
    // ---------------------------------------------------------------------

    /// @dev Escape text for safe use inside a JSON string literal.
    ///      JSON cares about: double-quote, backslash, and control characters.
    function _escapeJSON(string memory input) internal pure returns (string memory) {
        bytes memory b = bytes(input);
        // Worst case is a control char becoming \u00XX — six bytes for one.
        bytes memory buf = new bytes(b.length * 6);
        uint256 n = 0;

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];

            if (c == '"') {
                buf[n++] = "\\";
                buf[n++] = '"';
            } else if (c == "\\") {
                buf[n++] = "\\";
                buf[n++] = "\\";
            } else if (uint8(c) < 0x20) {
                // Newlines, tabs, and friends are illegal raw inside JSON strings.
                buf[n++] = "\\";
                buf[n++] = "u";
                buf[n++] = "0";
                buf[n++] = "0";
                buf[n++] = _hexDigit(uint8(c) >> 4);
                buf[n++] = _hexDigit(uint8(c) & 0x0f);
            } else {
                // Everything else passes through untouched — including the
                // multi-byte pieces of accented and non-Latin characters,
                // which all sit above 0x7F and never collide with the rules above.
                buf[n++] = c;
            }
        }

        return string(_trim(buf, n));
    }

    /// @dev Escape text for safe use inside SVG/XML element content.
    ///      XML cares about: ampersand, angle brackets, and quotes.
    function _escapeXML(string memory input) internal pure returns (string memory) {
        bytes memory b = bytes(input);
        // Worst case is a quote becoming &quot; — six bytes for one.
        bytes memory buf = new bytes(b.length * 6);
        uint256 n = 0;

        for (uint256 i = 0; i < b.length; i++) {
            bytes1 c = b[i];

            if (c == "&") {
                // Must come first in our thinking: & is the escape character
                // itself. Because we emit entities directly rather than doing
                // find-and-replace passes, there's no double-escaping risk.
                buf[n++] = "&"; buf[n++] = "a"; buf[n++] = "m"; buf[n++] = "p"; buf[n++] = ";";
            } else if (c == "<") {
                buf[n++] = "&"; buf[n++] = "l"; buf[n++] = "t"; buf[n++] = ";";
            } else if (c == ">") {
                buf[n++] = "&"; buf[n++] = "g"; buf[n++] = "t"; buf[n++] = ";";
            } else if (c == '"') {
                buf[n++] = "&"; buf[n++] = "q"; buf[n++] = "u"; buf[n++] = "o"; buf[n++] = "t"; buf[n++] = ";";
            } else if (c == "'") {
                buf[n++] = "&"; buf[n++] = "a"; buf[n++] = "p"; buf[n++] = "o"; buf[n++] = "s"; buf[n++] = ";";
            } else if (uint8(c) < 0x20) {
                // Control characters aren't legal in XML at all. Drop them
                // rather than encode them — there's nothing to render anyway.
                continue;
            } else {
                buf[n++] = c;
            }
        }

        return string(_trim(buf, n));
    }

    /// @dev We allocate for the worst case, then cut the buffer down to what we used.
    function _trim(bytes memory buf, uint256 n) private pure returns (bytes memory) {
        bytes memory out = new bytes(n);
        for (uint256 i = 0; i < n; i++) {
            out[i] = buf[i];
        }
        return out;
    }

    /// @dev 0-15 -> "0".."f", for the \u00XX form above.
    function _hexDigit(uint8 v) private pure returns (bytes1) {
        return v < 10
            ? bytes1(uint8(bytes1("0")) + v)
            : bytes1(uint8(bytes1("a")) + (v - 10));
    }

    // -----------------------------------------------------------------------
    // Emergency stop
    //
    // WHAT PAUSING DOES AND DELIBERATELY DOES NOT DO
    //
    // Paused:   minting, and transfers between people.
    // NOT paused: checkIn.
    //
    // That exception is intentional and worth defending. A pause is most
    // likely to be hit during a live event — that is when things go wrong and
    // someone is watching. If pausing also froze the door, four hundred people
    // holding valid tickets would be standing outside a venue they paid to
    // enter, and the cure would be worse than almost any disease.
    //
    // checkIn is also the least dangerous thing this contract does. It flips
    // one boolean, moves no value, and creates nothing. Stopping mints stops
    // bad tickets being made; stopping transfers stops them being moved. The
    // door can stay open.
    //
    // Reading tickets is never paused either. tokenURI is a view function, so
    // even during an emergency every ticket already minted still renders. A
    // keepsake that disappears when the company has a bad day is not a
    // keepsake.
    // -----------------------------------------------------------------------

    /// @notice Halt minting and transfers. Check-in keeps working.
    function pause() external onlyRole(PAUSER_ROLE) {
        _pause();
    }

    /// @notice Resume normal operation.
    function unpause() external onlyRole(PAUSER_ROLE) {
        _unpause();
    }

    /// @dev Both ERC721 and AccessControl answer this question, so Solidity
    ///      makes us say explicitly that the answer is "either one is fine."
    ///      This is how a wallet or marketplace asks the contract what it is:
    ///      yes, an NFT; yes, role-based permissions.
    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(ERC721, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    /// @dev The chokepoint every mint, transfer, and burn flows through.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            // A real transfer between two people, as opposed to a mint.
            require(!paused(), "Ticklore: transfers are paused");
            require(!tickets[tokenId].nonTransferable, "Ticklore: ticket is permanently non-transferable");
            require(
                block.timestamp >= tickets[tokenId].transferUnlock,
                "Ticklore: ticket is still locked (event not far enough behind us)"
            );
        }
        return super._update(to, tokenId, auth);
    }
}
