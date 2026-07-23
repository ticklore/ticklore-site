// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title  TickloreTicket
/// @notice Every ticket is a one-of-one keepsake. This is the foundation.
contract TickloreTicket is ERC721 {
    // The blueprint for what every ticket remembers — its "Chapter One".
    struct TicketData {
        string  eventName;       // "Founders' Day Picnic"
        uint64  eventDate;       // when the event happens (unix time)
        string  tier;            // "General", "VIP", a seat, or a role
        uint256 donationAmount;  // amount given to the cause, in cents
        bool    used;            // has it been checked in at the door?
        uint64  transferUnlock;  // when the ticket becomes transferable
    }

    // The filing cabinet: look up any ticket's data by its ID number.
    mapping(uint256 => TicketData) public tickets;

    // A number dispenser: the ID the next ticket will get. Starts at 1.
    uint256 public nextTicketId = 1;

    constructor() ERC721("Ticklore Ticket", "TCKL") {}
}
