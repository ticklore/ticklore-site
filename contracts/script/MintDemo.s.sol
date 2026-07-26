// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TickloreTicket} from "../src/TickloreTicket.sol";

/// @title  MintDemo
/// @notice Mints ticket #1 on a deployed contract — the "it's alive" moment.
///
/// Run this after Deploy.s.sol. It creates one real ticket on the testnet so
/// you can open it in a block explorer or wallet and watch the contract draw
/// its own artwork. Nothing about this is a simulation: the same code path
/// runs when a real buyer pays.
///
///     TICKLORE_CONTRACT=0xYourDeployedAddress \
///     forge script script/MintDemo.s.sol:MintDemo \
///       --rpc-url $BASE_SEPOLIA_RPC \
///       --account tickloreDeployer \
///       --broadcast
///
contract MintDemo is Script {
    function run() external {
        address contractAddr = vm.envAddress("TICKLORE_CONTRACT");
        TickloreTicket ticklore = TickloreTicket(contractAddr);

        // Who receives it. Defaults to whoever is running the script.
        address recipient = vm.envOr("TICKLORE_RECIPIENT", address(0));

        // A believable first chapter. The ampersand and apostrophe here are
        // deliberate — this is the input that would have broken the metadata
        // before the escaping fix, so minting it proves the fix on real chain.
        string memory eventName = "Sullivan Family Reunion";
        string memory tier      = "General Admission";
        uint64  eventDate       = uint64(block.timestamp + 30 days);
        uint256 pricePaid       = 2500;   // $25.00, stored as whole cents
        uint256 donation        = 0;
        uint64  transferUnlock  = uint64(block.timestamp + 60 days);
        bool    nonTransferable = false;

        vm.startBroadcast();

        if (recipient == address(0)) {
            recipient = msg.sender;
        }

        uint256 id = ticklore.mintTicket(
            recipient,
            eventName,
            eventDate,
            tier,
            pricePaid,
            donation,
            transferUnlock,
            nonTransferable,
            "Supported by",       // sponsor lead-in
            "The Ticklore Fund",  // sponsor name
            0,                    // palette: 0 = Teal & Gold
            0                     // style:   0 = Classic (only layout rendered so far)
        );

        vm.stopBroadcast();

        console2.log("");
        console2.log("=======================================================");
        console2.log(" Ticket minted");
        console2.log("=======================================================");
        console2.log(" Ticket id  :", id);
        console2.log(" Holder     :", recipient);
        console2.log(" Event      :", eventName);
        console2.log(" Contract   :", contractAddr);
        console2.log("=======================================================");
        console2.log("");
        console2.log("View it on the explorer:");
        console2.log("  https://sepolia.basescan.org/token/%s?a=%s", contractAddr, id);
        console2.log("");
    }
}
