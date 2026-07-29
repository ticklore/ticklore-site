// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TickloreTicketV3} from "../src/TickloreTicketV3.sol";

/// @notice One live create-event (TWO sponsors) + two mints referencing DIFFERENT
///         sponsors against the deployed V3, then print each tokenURI so we can
///         decode the on-chain keepsakes off-chain and confirm each carries only
///         its own sponsor. Not a test — real transactions on Base Sepolia.
contract SmokeV3 is Script {
    function run() external {
        TickloreTicketV3 t = TickloreTicketV3(vm.envAddress("V3_ADDR"));
        address minter = 0xE6Bc4936F328719651851ddce1Eb3248648dFF14;

        TickloreTicketV3.Sponsor[] memory sponsors = new TickloreTicketV3.Sponsor[](2);
        sponsors[0] = TickloreTicketV3.Sponsor("Supported by", "Alpha Foundation");
        sponsors[1] = TickloreTicketV3.Sponsor("Sponsored by", "Beta Motors");

        vm.startBroadcast();
        uint256 eventId = t.createEvent(
            unicode"The Charity Scramble", "Pinehurst, NC", 1780142400,
            sponsors, 3 /* forest */, true /* inscriptions */, false /* not soulbound */
        );
        uint256 tokA = t.mintTicket(eventId, minter, 0, "Dave Chen", unicode"For the kids", 1); // Alpha
        uint256 tokB = t.mintTicket(eventId, minter, 0, "Priya Rao", unicode"Drive it home", 2); // Beta
        vm.stopBroadcast();

        console2.log("eventId", eventId);
        console2.log("tokA (Alpha)", tokA);
        console2.log("URI_A", t.tokenURI(tokA));
        console2.log("tokB (Beta)", tokB);
        console2.log("URI_B", t.tokenURI(tokB));
    }
}
