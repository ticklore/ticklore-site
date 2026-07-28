// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TickloreTicketV2} from "../src/TickloreTicketV2.sol";

/// @title  DeployV2
/// @notice Puts the event-model TickloreTicketV2 on-chain (Base Sepolia for now).
///         Owner controls only the emergency pause; per-event authority lives with
///         each event's organizer. Defaults owner to the deploying wallet.
contract DeployV2 is Script {
    function run() external returns (TickloreTicketV2 t) {
        address owner = vm.envOr("TICKLORE_OWNER", address(0));

        vm.startBroadcast();
        if (owner == address(0)) {
            owner = msg.sender;
        }
        t = new TickloreTicketV2(owner);
        vm.stopBroadcast();

        console2.log("=======================================================");
        console2.log(" TickloreTicketV2 (event model) deployed");
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
