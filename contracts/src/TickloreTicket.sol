// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/// @title  TickloreTicket
/// @notice Every ticket is a one-of-one keepsake. This is the foundation.
contract TickloreTicket is ERC721, Ownable {
    // The blueprint for what every ticket remembers — its "Chapter One".
    struct TicketData {
        string  eventName;       // "Founders' Day Picnic"
        uint64  eventDate;       // when the event happens (unix time)
        string  tier;            // "General", "VIP", a seat, or a role
        uint256 pricePaid;       // what this ticket sold for, in cents (0 = free)
        uint256 donationAmount;  // optional gift to a cause, in cents (0 = none)
        bool    used;            // has it been checked in at the door?
        uint64  transferUnlock;  // when the ticket becomes transferable
        address originalHolder;  // who it was first issued to (permanent provenance)
    }

    // The filing cabinet: look up any ticket's data by its ID number.
    mapping(uint256 => TicketData) public tickets;

    // A number dispenser: the ID the next ticket will get. Starts at 1.
    uint256 public nextTicketId = 1;

    // A public announcement emitted every time a ticket is created.
    event TicketMinted(uint256 indexed ticketId, address indexed to, string eventName);

    // At birth, name the collection AND record who owns the box office.
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
        uint64 transferUnlock
    ) external onlyOwner returns (uint256) {
        uint256 ticketId = nextTicketId; // take the current number...
        nextTicketId++;                  // ...and advance the dispenser.

        tickets[ticketId] = TicketData({
            eventName: eventName,
            eventDate: eventDate,
            tier: tier,
            pricePaid: pricePaid,
            donationAmount: donationAmount,
            used: false,
            transferUnlock: transferUnlock,
            originalHolder: to
        });

        _safeMint(to, ticketId);
        emit TicketMinted(ticketId, to, eventName);
        return ticketId;
    }

    /// @dev The chokepoint EVERY mint, transfer, and burn flows through.
    ///      We override it to enforce the transfer lock. `from` is the current
    ///      owner (address(0) means this is a fresh mint).
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address)
    {
        address from = _ownerOf(tokenId);

        // Guard ONLY real wallet-to-wallet transfers — never the initial mint.
        if (from != address(0) && to != address(0)) {
            require(
                block.timestamp >= tickets[tokenId].transferUnlock,
                "Ticklore: ticket is still locked (event not far enough behind us)"
            );
        }

        return super._update(to, tokenId, auth); // let the standard logic finish.
    }
}
