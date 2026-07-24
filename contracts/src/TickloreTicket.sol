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

    /// @notice Standard NFT metadata — the ticket describes itself, on-chain.
    function tokenURI(uint256 ticketId) public view override returns (string memory) {
        require(_ownerOf(ticketId) != address(0), "Ticklore: no such ticket");
        TicketData memory t = tickets[ticketId];

        // Human-friendly values (this is a display layer, so we format here).
        string memory priceStr    = t.pricePaid == 0 ? "Free" : _formatMoney(t.pricePaid);
        string memory donationStr = t.donationAmount == 0 ? "None" : _formatMoney(t.donationAmount);
        string memory usedStr     = t.used ? "Yes" : "No";

        // Build the metadata JSON the whole NFT world understands.
        string memory json = string.concat(
            '{"name":"Ticklore #', Strings.toString(ticketId), unicode" — ", t.eventName, '",',
            '"description":"A one-of-one keepsake ticket on Ticklore. Every ticket has a story.",',
            '"attributes":[',
                '{"trait_type":"Event","value":"', t.eventName, '"},',
                '{"trait_type":"Tier","value":"', t.tier, '"},',
                '{"trait_type":"Price","value":"', priceStr, '"},',
                '{"trait_type":"Donation","value":"', donationStr, '"},',
                '{"trait_type":"Checked In","value":"', usedStr, '"}',
            ']}'
        );

        // Wrap it as a self-contained data URI (no server needed, ever).
        return string.concat(
            "data:application/json;base64,",
            Base64.encode(bytes(json))
        );
    }

    /// @dev Turn whole cents into "$25.00". Solidity has no decimals, so we do it by hand.
    function _formatMoney(uint256 cents) internal pure returns (string memory) {
        uint256 dollars = cents / 100;   // whole dollars
        uint256 rem     = cents % 100;   // leftover cents
        string memory remStr = rem < 10
            ? string.concat("0", Strings.toString(rem)) // pad "5" -> "05"
            : Strings.toString(rem);
        return string.concat("$", Strings.toString(dollars), ".", remStr);
    }

    /// @dev The chokepoint every mint, transfer, and burn flows through.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            require(
                !tickets[tokenId].nonTransferable,
                "Ticklore: ticket is permanently non-transferable"
            );
            require(
                block.timestamp >= tickets[tokenId].transferUnlock,
                "Ticklore: ticket is still locked (event not far enough behind us)"
            );
        }
        return super._update(to, tokenId, auth);
    }
}
