// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {TickloreTicket} from "../src/TickloreTicket.sol";

contract TickloreTicketTest is Test {
    TickloreTicket ticklore;
    address boxOffice = makeAddr("boxOffice");
    address buyer     = makeAddr("L.Grant");
    address friend    = makeAddr("friend");

    uint64 constant EVENT_DATE = 1780142400;         // ~ May 30, 2026 12:00 UTC
    uint64 constant UNLOCK     = EVENT_DATE + 30 days;

    function setUp() public {
        ticklore = new TickloreTicket(boxOffice);
    }

    function _mintPicnic() internal returns (uint256 id) {
        vm.prank(boxOffice);
        id = ticklore.mintTicket(buyer, "Founders' Day Picnic", EVENT_DATE, "General", 2500, 0, UNLOCK);
    }

    function _used(uint256 id) internal view returns (bool u) {
        (,,,,, u,,) = ticklore.tickets(id);
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
        vm.prank(buyer);
        vm.expectRevert();
        ticklore.transferFrom(buyer, friend, id);
        assertEq(ticklore.ownerOf(id), buyer);
    }

    function test_TransferAllowedAfterUnlock() public {
        uint256 id = _mintPicnic();
        vm.warp(uint256(UNLOCK) + 1);
        vm.prank(buyer);
        ticklore.transferFrom(buyer, friend, id);
        assertEq(ticklore.ownerOf(id), friend);
    }

    function test_CheckIn() public {
        uint256 id = _mintPicnic();
        assertEq(_used(id), false);           // fresh
        vm.prank(boxOffice);
        ticklore.checkIn(id);                  // scan at the door
        assertEq(_used(id), true);             // stamped
        console2.log("Ticket #1 checked in. used =", _used(id));
    }

    function test_CheckInBlocksSecondScan() public {
        uint256 id = _mintPicnic();
        vm.prank(boxOffice);
        ticklore.checkIn(id);
        // try to sneak the same ticket through again
        vm.prank(boxOffice);
        vm.expectRevert(bytes("Ticklore: ticket already used"));
        ticklore.checkIn(id);
        console2.log("Second scan correctly REJECTED.");
    }

    function test_StrangerCannotCheckIn() public {
        uint256 id = _mintPicnic();
        vm.prank(buyer);                       // an attendee can't check themselves in
        vm.expectRevert();
        ticklore.checkIn(id);
    }

    function test_CheckInNonexistentReverts() public {
        vm.prank(boxOffice);
        vm.expectRevert(bytes("Ticklore: no such ticket"));
        ticklore.checkIn(999);
    }
}
