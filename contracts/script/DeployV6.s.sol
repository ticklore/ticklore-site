// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TickloreTicketV6} from "../src/TickloreTicketV6.sol";

/// @title  DeployV6
/// @notice Puts TickloreTicketV6 on-chain. V6 is V5 with the keepsake's own
///         typography brought in line with the site — same ABI, same storage,
///         same behaviour, different art.
///
///         Deploy to Base Sepolia FIRST and mint one (SmokeV6), because the art
///         is the whole point of this version and it must be looked at on real
///         devices before mainnet freezes it.
///
///         Owner defaults to the deploying wallet: emergency pause plus the
///         organizer-recovery fallback. Per-event authority still lives with
///         each event's organizer.
contract DeployV6 is Script {
    function run() external returns (TickloreTicketV6 t) {
        address owner = vm.envOr("TICKLORE_OWNER", address(0));

        vm.startBroadcast();
        if (owner == address(0)) {
            owner = msg.sender;
        }
        t = new TickloreTicketV6(owner);
        vm.stopBroadcast();

        console2.log("=======================================================");
        console2.log(" TickloreTicketV6 deployed");
        console2.log("=======================================================");
        console2.log(" Address    :", address(t));
        console2.log(" Owner      :", owner);
        console2.log(" Collection :", t.name());
        console2.log(" Symbol     :", t.symbol());
        console2.log(" Next event :", t.nextEventId());
        console2.log(" Next token :", t.nextTokenId());
        console2.log("=======================================================");
        console2.log(" Next: V6_ADDR=<address> forge script SmokeV6 --broadcast");
    }
}
