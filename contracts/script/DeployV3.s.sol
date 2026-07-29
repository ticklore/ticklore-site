// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TickloreTicketV3} from "../src/TickloreTicketV3.sol";

/// @title  DeployV3
/// @notice Puts the multi-sponsor TickloreTicketV3 on-chain (Base Sepolia for now).
///         Same authority model as V2 (owner = emergency pause only; per-event
///         authority lives with each event's organizer). Defaults owner to the
///         deploying wallet.
contract DeployV3 is Script {
    function run() external returns (TickloreTicketV3 t) {
        address owner = vm.envOr("TICKLORE_OWNER", address(0));

        vm.startBroadcast();
        if (owner == address(0)) {
            owner = msg.sender;
        }
        t = new TickloreTicketV3(owner);
        vm.stopBroadcast();

        console2.log("=======================================================");
        console2.log(" TickloreTicketV3 (event model + multi-sponsor) deployed");
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
