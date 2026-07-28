// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TickloreTicketV2} from "../src/TickloreTicketV2.sol";

/// @notice One live create-event + mint against the deployed V2, then print the
///         tokenURI so we can decode the on-chain keepsake off-chain. Not a test —
///         a real transaction on Base Sepolia.
contract SmokeV2 is Script {
    function run() external {
        TickloreTicketV2 t = TickloreTicketV2(vm.envAddress("V2_ADDR"));
        address minter = 0xE6Bc4936F328719651851ddce1Eb3248648dFF14;

        vm.startBroadcast();
        uint256 eventId = t.createEvent(
            unicode"The Sullivan Family Reunion", "Lynchburg, VA", 1780142400,
            "Supported by", "The Acme Fund", 2 /* burgundy */, true /* inscriptions */, false /* not soulbound */
        );
        uint256 tokenId = t.mintTicket(eventId, minter, 2500, "Dave Chen", unicode"First of many chapters");
        vm.stopBroadcast();

        console2.log("eventId", eventId);
        console2.log("tokenId", tokenId);
        console2.log("URI", t.tokenURI(tokenId));
    }
}
