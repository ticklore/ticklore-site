// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

// Pull in OpenZeppelin's audited ERC-721 (NFT) building block.
import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";

/// @title  TickloreTicket
/// @notice Every ticket is a one-of-one keepsake. This is the foundation.
contract TickloreTicket is ERC721 {
    // Runs exactly once, at the moment the contract is deployed.
    // It names the collection: a full name and a short "symbol".
    constructor() ERC721("Ticklore Ticket", "TCKL") {}
}
