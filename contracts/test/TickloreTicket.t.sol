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

    // normal, transferable ticket
    function _mintPicnic() internal returns (uint256 id) {
        vm.prank(boxOffice);
        id = ticklore.mintTicket(buyer, "Founders' Day Picnic", EVENT_DATE, "General", 2500, 0, UNLOCK, false);
    }

    // sensitive, permanently non-transferable ticket
    function _mintSensitive() internal returns (uint256 id) {
        vm.prank(boxOffice);
        id = ticklore.mintTicket(buyer, "Support Group", EVENT_DATE, "Member", 0, 0, UNLOCK, true);
    }

    function _used(uint256 id) internal view returns (bool u) {
        (,,,,, u,,,) = ticklore.tickets(id);
    }

    function test_MintAndReadBackFirstTicket() public {
        uint256 id = _mintPicnic();
        (string memory eventName,,,uint256 pricePaid,,bool used,,,address originalHolder) = ticklore.tickets(id);
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
        ticklore.mintTicket(buyer, "Fake", EVENT_DATE, "General", 0, 0, UNLOCK, false);
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
        assertEq(_used(id), false);
        vm.prank(boxOffice);
        ticklore.checkIn(id);
        assertEq(_used(id), true);
    }

    function test_CheckInBlocksSecondScan() public {
        uint256 id = _mintPicnic();
        vm.prank(boxOffice);
        ticklore.checkIn(id);
        vm.prank(boxOffice);
        vm.expectRevert(bytes("Ticklore: ticket already used"));
        ticklore.checkIn(id);
    }

    function test_StrangerCannotCheckIn() public {
        uint256 id = _mintPicnic();
        vm.prank(buyer);
        vm.expectRevert();
        ticklore.checkIn(id);
    }

    function test_CheckInNonexistentReverts() public {
        vm.prank(boxOffice);
        vm.expectRevert(bytes("Ticklore: no such ticket"));
        ticklore.checkIn(999);
    }

    function test_NonTransferableBlockedEvenAfterUnlock() public {
        uint256 id = _mintSensitive();
        // fast-forward a FULL YEAR past the unlock — still sealed
        vm.warp(uint256(UNLOCK) + 365 days);
        vm.prank(buyer);
        vm.expectRevert(bytes("Ticklore: ticket is permanently non-transferable"));
        ticklore.transferFrom(buyer, friend, id);
        assertEq(ticklore.ownerOf(id), buyer);
        console2.log("Sensitive ticket stays put even a year after unlock. Owner:", ticklore.ownerOf(id));
    }

    function test_TokenURICard() public {
        uint256 id1 = _mintPicnic();
        string memory fresh = ticklore.tokenURI(id1);
        console2.log("FRESH:", fresh);
        assertGt(bytes(fresh).length, 0);

        uint256 id2 = _mintPicnic();
        vm.prank(boxOffice);
        ticklore.checkIn(id2);
        string memory used = ticklore.tokenURI(id2);
        console2.log("USED:", used);
        assertGt(bytes(used).length, 0);
    }

    function test_TokenURINonexistentReverts() public {
        vm.expectRevert(bytes("Ticklore: no such ticket"));
        ticklore.tokenURI(999);
    }
}
