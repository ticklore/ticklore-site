// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TickloreTicketV4} from "../src/TickloreTicketV4.sol";

/// @title  DeployV4
/// @notice Puts the batched-design-pass TickloreTicketV4 on-chain (Base Sepolia
///         for now). Same authority model (owner = emergency pause + organizer
///         recovery fallback; per-event authority lives with each event's
///         organizer, now reassignable). Defaults owner to the deploying wallet.
contract DeployV4 is Script {
    function run() external returns (TickloreTicketV4 t) {
        address owner = vm.envOr("TICKLORE_OWNER", address(0));

        vm.startBroadcast();
        if (owner == address(0)) {
            owner = msg.sender;
        }
        t = new TickloreTicketV4(owner);
        vm.stopBroadcast();

        console2.log("=======================================================");
        console2.log(" TickloreTicketV4 (final design pass) deployed");
        console2.log("=======================================================");
        console2.log(" Address    :", address(t));
        console2.log(" Owner      :", owner);
        console2.log(" Collection :", t.name());
        console2.log(" Symbol     :", t.symbol());
        console2.log(" Next event :", t.nextEventId());
        console2.log(" Next token :", t.nextTokenId());
        console2.log("=======================================================");
    }
}
