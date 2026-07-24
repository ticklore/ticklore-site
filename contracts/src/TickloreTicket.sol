// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title  TickloreTicket
/// @notice Every ticket is a one-of-one keepsake. This is the foundation.
contract TickloreTicket is ERC721, Ownable {
    struct TicketData {
        string  eventName;        // "Founders' Day Picnic"
        uint64  eventDate;        // when the event happens (unix time)
        string  tier;             // "General", "VIP", a seat, or a role
        uint256 pricePaid;        // what this ticket sold for, in cents (0 = free)
        uint256 donationAmount;   // optional gift to a cause, in cents (0 = none)
        bool    used;             // has it been checked in at the door?
        uint64  transferUnlock;   // when the ticket becomes transferable
        bool    nonTransferable;  // if true: NEVER transferable (sensitive events)
        address originalHolder;   // who it was first issued to (permanent provenance)
    }

    mapping(uint256 => TicketData) public tickets;
    uint256 public nextTicketId = 1;

    event TicketMinted(uint256 indexed ticketId, address indexed to, string eventName);
    event TicketCheckedIn(uint256 indexed ticketId);

    constructor(address initialOwner)
        ERC721("Ticklore Ticket", "TCKL")
        Ownable(initialOwner)
    {}

    /// @notice Create one ticket and hand it to `to`. Only the owner may call this.
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

    /// @notice Scan a ticket in at the door. Marks it used; a second scan fails.
    function checkIn(uint256 ticketId) external onlyOwner {
        require(_ownerOf(ticketId) != address(0), "Ticklore: no such ticket");
        require(!tickets[ticketId].used, "Ticklore: ticket already used");
        tickets[ticketId].used = true;
        emit TicketCheckedIn(ticketId);
    }

    /// @dev The chokepoint every mint, transfer, and burn flows through.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);
        if (from != address(0) && to != address(0)) {
            // Sensitive events: sealed shut, forever.
            require(
                !tickets[tokenId].nonTransferable,
                "Ticklore: ticket is permanently non-transferable"
            );
            // Everyone else: locked until the event is far enough behind us.
            require(
                block.timestamp >= tickets[tokenId].transferUnlock,
                "Ticklore: ticket is still locked (event not far enough behind us)"
            );
        }
        return super._update(to, tokenId, auth);
    }
}
