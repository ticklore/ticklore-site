// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {TickloreTicket} from "../src/TickloreTicket.sol";

contract TickloreTicketTest is Test {
    TickloreTicket ticklore;
    address boxOffice = makeAddr("boxOffice"); // the platform / owner
    address buyer     = makeAddr("L.Grant");   // the attendee
    address friend    = makeAddr("friend");    // someone they might gift/sell to

    uint64 constant EVENT_DATE = 1780142400;         // ~ May 30, 2026 12:00 UTC
    uint64 constant UNLOCK     = EVENT_DATE + 30 days;

    function setUp() public {
        ticklore = new TickloreTicket(boxOffice);
    }

    function _mintPicnic() internal returns (uint256 id) {
        vm.prank(boxOffice);
        id = ticklore.mintTicket(buyer, "Founders' Day Picnic", EVENT_DATE, "General", 2500, 0, UNLOCK);
    }

    function test_MintAndReadBackFirstTicket() public {
        uint256 id = _mintPicnic();
        (string memory eventName,,,uint256 pricePaid,,bool used,,address originalHolder) = ticklore.tickets(id);
        assertEq(id, 1);
        assertEq(ticklore.ownerOf(1), buyer);
        assertEq(eventName, "Founders' Day Picnic");
        assertEq(pricePaid, 2500);
        assertEq(used, false);
        assertEq(originalHolder, buyer);
        assertEq(ticklore.nextTicketId(), 2);
    }

    function test_StrangerCannotMint() public {
        vm.prank(buyer);
        vm.expectRevert();
        ticklore.mintTicket(buyer, "Fake", EVENT_DATE, "General", 0, 0, UNLOCK);
    }

    function test_TransferBlockedBeforeUnlock() public {
        uint256 id = _mintPicnic();
        // clock is still way before the event; try to pass the ticket along
        vm.prank(buyer);
        vm.expectRevert(); // the bouncer stops it
        ticklore.transferFrom(buyer, friend, id);
        // ownership unchanged
        assertEq(ticklore.ownerOf(id), buyer);
        console2.log("Before unlock: transfer correctly BLOCKED. Owner still:", ticklore.ownerOf(id));
    }

    function test_TransferAllowedAfterUnlock() public {
        uint256 id = _mintPicnic();
        // time-travel to just past the unlock window
        vm.warp(uint256(UNLOCK) + 1);
        vm.prank(buyer);
        ticklore.transferFrom(buyer, friend, id); // now it's a keepsake, freely movable
        assertEq(ticklore.ownerOf(id), friend);
        console2.log("After unlock: transfer ALLOWED. New owner:", ticklore.ownerOf(id));

        // provenance check: original holder is still recorded as the buyer
        (,,,,,,,address originalHolder) = ticklore.tickets(id);
        assertEq(originalHolder, buyer);
        console2.log("Chapter One intact: original holder still", originalHolder);
    }
}
