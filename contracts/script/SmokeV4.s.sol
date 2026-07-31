// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TickloreTicketV4} from "../src/TickloreTicketV4.sol";

/// @notice Live V4 smoke on Base Sepolia: one event exercising ALL FOUR new
///         decisions at once — two sponsors, two sections, price display OFF —
///         then two mints referencing different sponsor+section pairs, plus an
///         organizer handoff to a fresh address and back (owner fallback).
///         Print the tokenURIs so the keepsakes can be decoded off-chain.
contract SmokeV4 is Script {
    function run() external {
        TickloreTicketV4 t = TickloreTicketV4(vm.envAddress("V4_ADDR"));
        address minter = 0xE6Bc4936F328719651851ddce1Eb3248648dFF14;
        address parkingOrganizer = address(0xBEEF);

        TickloreTicketV4.Sponsor[] memory sponsors = new TickloreTicketV4.Sponsor[](2);
        sponsors[0] = TickloreTicketV4.Sponsor("Supported by", "Alpha Foundation");
        sponsors[1] = TickloreTicketV4.Sponsor("Sponsored by", "Beta Motors");
        string[] memory sections = new string[](2);
        sections[0] = "Table 7";
        sections[1] = "Section A";

        vm.startBroadcast();
        uint256 eventId = t.createEvent(
            unicode"The Founders Gala", "Grand Hall", 1780142400,
            sponsors, sections, 4 /* plum */, false, false, false /* price hidden */
        );
        uint256 tokA = t.mintTicket(eventId, minter, 15000, "", "", 1, 1); // Alpha + Table 7, $150 hidden
        uint256 tokB = t.mintTicket(eventId, minter, 0, "", "", 2, 2);     // Beta + Section A, free hidden
        // Authority handoff round-trip: organizer hands off, owner recovers.
        t.transferOrganizer(eventId, parkingOrganizer);
        t.transferOrganizer(eventId, minter); // we are the owner — the recovery path
        vm.stopBroadcast();

        console2.log("eventId", eventId);
        console2.log("organizer after round-trip", t.organizerOf(eventId));
        console2.log("tokA (Alpha/Table7)", tokA);
        console2.log("URI_A", t.tokenURI(tokA));
        console2.log("tokB (Beta/SectionA)", tokB);
        console2.log("URI_B", t.tokenURI(tokB));
    }
}
