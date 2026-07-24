// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TickloreTicket} from "../src/TickloreTicket.sol";

/// @title  Deploy
/// @notice Puts TickloreTicket on-chain.
///
/// This script does one thing: create the contract and hand ownership to the
/// address you nominate. It deliberately does NOT mint anything — deployment
/// and first sale are separate events, and mixing them makes both harder to
/// verify.
///
/// The owner address is the box office. It is the only address that can mint
/// tickets or check people in. On testnet that's your own wallet. In
/// production it becomes the backend wallet that Stripe triggers after a
/// payment clears.
///
/// USAGE — see contracts/DEPLOY.md for the full walkthrough.
///
///     forge script script/Deploy.s.sol:Deploy \
///       --rpc-url $BASE_SEPOLIA_RPC \
///       --account tickloreDeployer \
///       --broadcast --verify
///
contract Deploy is Script {
    function run() external returns (TickloreTicket ticklore) {
        // Who should own the contract? Falls back to the deploying wallet,
        // which is almost always what you want on testnet.
        address owner = vm.envOr("TICKLORE_OWNER", address(0));

        vm.startBroadcast();

        if (owner == address(0)) {
            owner = msg.sender;
            console2.log("TICKLORE_OWNER not set - defaulting to the deployer.");
        }

        ticklore = new TickloreTicket(owner);

        vm.stopBroadcast();

        console2.log("");
        console2.log("=======================================================");
        console2.log(" TickloreTicket deployed");
        console2.log("=======================================================");
        console2.log(" Address    :", address(ticklore));
        console2.log(" Owner      :", owner);
        console2.log(" Collection :", ticklore.name());
        console2.log(" Symbol     :", ticklore.symbol());
        console2.log(" Next id    :", ticklore.nextTicketId());
        console2.log("=======================================================");
        console2.log("");
        console2.log("Save that address. Everything downstream points at it:");
        console2.log("  - the block explorer link for your pitch");
        console2.log("  - the backend that mints after a Stripe payment");
        console2.log("  - the door-scanning app");
        console2.log("");
    }
}
