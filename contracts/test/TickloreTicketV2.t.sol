// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {TickloreTicketV2} from "../src/TickloreTicketV2.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

contract TickloreTicketV2Test is Test {
    TickloreTicketV2 tk;
    address deployer  = makeAddr("deployer");
    address organizer = makeAddr("organizer");
    address agent     = makeAddr("agent");
    address buyer     = makeAddr("buyer");
    address stranger  = makeAddr("stranger");
    uint64 constant DATE = 1780142400;

    function setUp() public {
        tk = new TickloreTicketV2(deployer);
    }

    function _createEvent(bool inscriptions) internal returns (uint256 id) {
        vm.prank(organizer);
        id = tk.createEvent("The Sullivan Reunion", "Lynchburg, VA", DATE, "Supported by", "The Acme Fund", 2, inscriptions);
    }

    function test_CreateEventRecordsOrganizer() public {
        uint256 id = _createEvent(true);
        assertEq(tk.organizerOf(id), organizer);
        assertEq(id, 1);
    }

    function test_OrganizerCanMint() public {
        uint256 id = _createEvent(true);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, "Dave Chen", "First of many chapters");
        assertEq(tk.ownerOf(tokenId), buyer);
        assertEq(tk.eventIdOf(tokenId), id);
    }

    function test_MintNonexistentEventReverts() public {
        vm.prank(organizer);
        vm.expectRevert(bytes("no such event"));
        tk.mintTicket(999, buyer, "", "");
    }

    function test_AgentCanMintThenRevoked() public {
        uint256 id = _createEvent(true);
        vm.prank(organizer);
        tk.setAgent(id, agent, true);

        vm.prank(agent);
        uint256 tokenId = tk.mintTicket(id, buyer, "Agent Minted", "hi");
        assertEq(tk.ownerOf(tokenId), buyer);

        vm.prank(organizer);
        tk.setAgent(id, agent, false);
        vm.prank(agent);
        vm.expectRevert(bytes("not organizer/agent"));
        tk.mintTicket(id, buyer, "", "");
    }

    function test_StrangerCannotSetAgent() public {
        uint256 id = _createEvent(true);
        vm.prank(stranger);
        vm.expectRevert(bytes("not organizer"));
        tk.setAgent(id, agent, true);
    }

    function test_StrangerCannotMint() public {
        uint256 id = _createEvent(true);
        vm.prank(stranger);
        vm.expectRevert(bytes("not organizer/agent"));
        tk.mintTicket(id, buyer, "", "");
    }

    function test_InscriptionBlockedWhenOff() public {
        uint256 id = _createEvent(false);
        vm.prank(organizer);
        vm.expectRevert(bytes("inscriptions off for this event"));
        tk.mintTicket(id, buyer, "Dave", "hi");
        // a plain ticket (no name/inscription) still mints
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, "", "");
        assertEq(tk.ownerOf(tokenId), buyer);
    }

    function test_LockOnFirstMint() public {
        uint256 id = _createEvent(true);
        // editable while unsold
        vm.prank(organizer);
        tk.updateEvent(id, "New Name", "New Venue", DATE, "", "", 0, true);
        // first mint locks it
        vm.prank(organizer);
        tk.mintTicket(id, buyer, "", "");
        vm.prank(organizer);
        vm.expectRevert(bytes("event locked (tickets minted)"));
        tk.updateEvent(id, "Cannot", "Change", DATE, "", "", 0, true);
    }

    function test_RedeemFlagFlipsOnce() public {
        uint256 id = _createEvent(true);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, "", "");
        vm.prank(organizer);
        tk.redeem(tokenId);
        (, TickloreTicketV2.Ticket memory t) = tk.ticketData(tokenId);
        assertTrue(t.redeemed);
        vm.prank(organizer);
        vm.expectRevert(bytes("already redeemed"));
        tk.redeem(tokenId);
    }

    function test_FreeTransfer() public {
        uint256 id = _createEvent(true);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, "", "");
        // rev 3: transfer is free from day one — no unlock window
        vm.prank(buyer);
        tk.transferFrom(buyer, stranger, tokenId);
        assertEq(tk.ownerOf(tokenId), stranger);
    }

    function test_TokenURIRendersAndEscapes() public {
        vm.prank(organizer);
        uint256 id = tk.createEvent(unicode"Mom & Dad's \"50th\"", "Home", DATE, "In honor of", unicode"Ben & Jerry's", 3, true);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, "Dave & Priya", unicode"Where it began <3");

        string memory uri = tk.tokenURI(tokenId);
        assertGt(bytes(uri).length, 0);
        string memory json = string(Base64.decode(_after(uri, 29)));
        string memory imageURI = vm.parseJsonString(json, ".image");
        string memory svg = string(Base64.decode(_after(imageURI, 26)));

        assertTrue(_contains(svg, "Mom &amp; Dad&apos;s &quot;50th&quot;"), "event name escaped");
        assertTrue(_contains(svg, "Ben &amp; Jerry&apos;s"), "sponsor escaped");
        assertTrue(_contains(svg, "Where it began &lt;3"), "inscription escaped");
        assertTrue(_contains(svg, "THE STORY"), "eyebrow present");
        assertFalse(_contains(svg, "<script"), "no injection");
    }

    function _after(string memory s, uint256 prefixLen) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length - prefixLen);
        for (uint256 i = prefixLen; i < b.length; i++) out[i - prefixLen] = b[i];
        return string(out);
    }

    function _contains(string memory hay, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(hay); bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool hit = true;
            for (uint256 j = 0; j < n.length; j++) { if (h[i + j] != n[j]) { hit = false; break; } }
            if (hit) return true;
        }
        return false;
    }
}
