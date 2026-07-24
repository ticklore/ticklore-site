// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Strings} from "@openzeppelin/contracts/utils/Strings.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

/// @title  TickloreTicket
/// @notice Every ticket is a one-of-one keepsake. This is the foundation.
contract TickloreTicket is ERC721, Ownable {
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
    }

    mapping(uint256 => TicketData) public tickets;
    uint256 public nextTicketId = 1;

    event TicketMinted(uint256 indexed ticketId, address indexed to, string eventName);
    event TicketCheckedIn(uint256 indexed ticketId);

    constructor(address initialOwner)
        ERC721("Ticklore Ticket", "TCKL")
        Ownable(initialOwner)
    {}

    function mintTicket(
        address to,
        string calldata eventName,
        uint64 eventDate,
        string calldata tier,
        uint256 pricePaid,
        uint256 donationAmount,
        uint64 transferUnlock,
        bool nonTransferable
    ) external onlyOwner returns (uint256) {
        uint256 ticketId = nextTicketId;
        nextTicketId++;

        tickets[ticketId] = TicketData({
            eventName: eventName,
            eventDate: eventDate,
            tier: tier,
            pricePaid: pricePaid,
            donationAmount: donationAmount,
            used: false,
            transferUnlock: transferUnlock,
            nonTransferable: nonTransferable,
            originalHolder: to
        });

        _safeMint(to, ticketId);
        emit TicketMinted(ticketId, to, eventName);
        return ticketId;
    }

    function checkIn(uint256 ticketId) external onlyOwner {
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

        string memory json = string.concat(
            '{"name":"Ticklore #', Strings.toString(ticketId), unicode" — ", nameJSON, '",',
            '"description":"A one-of-one keepsake ticket on Ticklore. Every ticket has a story.",',
            '"image":"', image, '",',
            '"attributes":[',
                '{"trait_type":"Event","value":"', nameJSON, '"},',
                '{"trait_type":"Tier","value":"', tierJSON, '"},',
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

    function _buildSVG(uint256 ticketId, TicketData memory t) internal pure returns (string memory) {
        string memory priceStr = t.pricePaid == 0 ? "Free" : _formatMoney(t.pricePaid);
        string memory stamp = t.used
            ? '<text x="400" y="280" fill="#E3C25E" fill-opacity="0.14" font-family="Georgia, serif" font-style="italic" font-size="130" text-anchor="middle" transform="rotate(-16 400 260)">ADMITTED</text>'
            : "";

        return string.concat(
            '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500" viewBox="0 0 800 500">',
            '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">',
            '<stop offset="0" stop-color="#123138"/><stop offset="0.55" stop-color="#0B2024"/><stop offset="1" stop-color="#081619"/>',
            '</linearGradient></defs>',
            '<rect width="800" height="500" fill="url(#bg)"/>',
            '<rect x="18" y="18" width="764" height="464" rx="18" fill="none" stroke="#C9A227" stroke-opacity="0.55" stroke-width="1.5"/>',
            '<text x="52" y="70" fill="#E3C25E" font-family="monospace" font-size="22" letter-spacing="7">TICKLORE</text>',
            '<line x1="52" y1="90" x2="748" y2="90" stroke="#C9A227" stroke-opacity="0.25" stroke-width="1"/>',
            stamp,
            '<text x="52" y="205" fill="#C9A227" font-family="monospace" font-size="16" letter-spacing="5">CHAPTER</text>',
            '<text x="52" y="258" fill="#F1E9DD" font-family="Georgia, serif" font-size="46">', _escapeXML(t.eventName), '</text>',
            '<text x="52" y="296" fill="#7FB3A6" font-family="monospace" font-size="18" letter-spacing="1">', _escapeXML(t.tier), '</text>',
            '<text x="52" y="446" fill="#F1E9DD" font-family="monospace" font-size="22">', priceStr, '</text>',
            '<text x="748" y="450" fill="#E3C25E" font-family="Georgia, serif" font-size="44" text-anchor="end">#', Strings.toString(ticketId), '</text>',
            '<text x="52" y="472" fill="#5F817A" font-family="monospace" font-size="12" letter-spacing="3">EVERY TICKET HAS A STORY</text>',
            '</svg>'
        );
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

    /// @dev The chokepoint every mint, transfer, and burn flows through.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            require(!tickets[tokenId].nonTransferable, "Ticklore: ticket is permanently non-transferable");
            require(
                block.timestamp >= tickets[tokenId].transferUnlock,
                "Ticklore: ticket is still locked (event not far enough behind us)"
            );
        }
        return super._update(to, tokenId, auth);
    }
}
