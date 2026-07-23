// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {TickloreTicket} from "../src/TickloreTicket.sol";

contract TickloreTicketTest is Test {
    TickloreTicket ticklore;
    address boxOffice = makeAddr("boxOffice"); // the platform / owner
    address buyer     = makeAddr("L.Grant");   // the attendee

    uint64 constant EVENT_DATE = 1780142400;         // ~ May 30, 2026 12:00 UTC
    uint64 constant UNLOCK     = EVENT_DATE + 30 days;

    function setUp() public {
        ticklore = new TickloreTicket(boxOffice); // deploy, box office = owner
    }

    function test_MintAndReadBackFirstTicket() public {
        vm.prank(boxOffice); // "the next call comes from the box office"
        uint256 id = ticklore.mintTicket(
            buyer,
            "Founders' Day Picnic",
            EVENT_DATE,
            "General",
            2500, // price: $25.00
            0,    // donation: none
            UNLOCK
        );

        (
            string memory eventName,
            uint64 eventDate,
            string memory tier,
            uint256 pricePaid,
            uint256 donationAmount,
            bool used,
            uint64 transferUnlock,
            address originalHolder
        ) = ticklore.tickets(id);

        console2.log("============ TICKET #1, STRAIGHT FROM THE CHAIN ============");
        console2.log("Collection name :", ticklore.name());
        console2.log("Symbol          :", ticklore.symbol());
        console2.log("Event           :", eventName);
        console2.log("Tier            :", tier);
        console2.log("Price (cents)   :", pricePaid);
        console2.log("Donation (cents):", donationAmount);
        console2.log("Checked in?     :", used);
        console2.log("Event date (ts) :", uint256(eventDate));
        console2.log("Unlocks at (ts) :", uint256(transferUnlock));
        console2.log("Owned by        :", ticklore.ownerOf(id));
        console2.log("Original holder :", originalHolder);
        console2.log("Next ticket id  :", ticklore.nextTicketId());
        console2.log("===========================================================");

        assertEq(id, 1, "first id should be 1");
        assertEq(ticklore.ownerOf(1), buyer, "buyer should own it");
        assertEq(eventName, "Founders' Day Picnic");
        assertEq(pricePaid, 2500);
        assertEq(donationAmount, 0);
        assertEq(used, false);
        assertEq(originalHolder, buyer);
        assertEq(ticklore.nextTicketId(), 2, "dispenser should advance");
    }

    function test_StrangerCannotMint() public {
        vm.prank(buyer);       // a random attendee tries to print their own tickets
        vm.expectRevert();     // ...and the velvet rope stops them
        ticklore.mintTicket(buyer, "Fake", EVENT_DATE, "General", 0, 0, UNLOCK);
    }
}
