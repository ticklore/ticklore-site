// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {TickloreTicketV3} from "../src/TickloreTicketV3.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

contract TickloreTicketV3Test is Test {
    TickloreTicketV3 tk;
    address deployer  = makeAddr("deployer");
    address organizer = makeAddr("organizer");
    address agent     = makeAddr("agent");
    address buyer     = makeAddr("buyer");
    address stranger  = makeAddr("stranger");
    uint64 constant DATE = 1780142400;

    function setUp() public {
        tk = new TickloreTicketV3(deployer);
    }

    // --- sponsor-list builders -------------------------------------------------
    function _noSponsors() internal pure returns (TickloreTicketV3.Sponsor[] memory s) {
        s = new TickloreTicketV3.Sponsor[](0);
    }

    function _oneSponsor() internal pure returns (TickloreTicketV3.Sponsor[] memory s) {
        s = new TickloreTicketV3.Sponsor[](1);
        s[0] = TickloreTicketV3.Sponsor("Supported by", "The Acme Fund");
    }

    function _twoSponsors() internal pure returns (TickloreTicketV3.Sponsor[] memory s) {
        s = new TickloreTicketV3.Sponsor[](2);
        s[0] = TickloreTicketV3.Sponsor("Supported by", "Alpha Foundation");
        s[1] = TickloreTicketV3.Sponsor("Sponsored by", "Beta Motors");
    }

    // one sponsor; inscriptions per arg; not soulbound
    function _createEvent(bool inscriptions) internal returns (uint256 id) {
        vm.prank(organizer);
        id = tk.createEvent("The Sullivan Reunion", "Lynchburg, VA", DATE, _oneSponsor(), 2, inscriptions, false);
    }

    function test_CreateEventRecordsOrganizer() public {
        uint256 id = _createEvent(true);
        assertEq(tk.organizerOf(id), organizer);
        assertEq(id, 1);
        assertEq(tk.sponsorCount(id), 1);
    }

    function test_OrganizerCanMint() public {
        uint256 id = _createEvent(true);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, 2500, "Dave Chen", "First of many chapters", 1);
        assertEq(tk.ownerOf(tokenId), buyer);
        assertEq(tk.eventIdOf(tokenId), id);
    }

    function test_MintNonexistentEventReverts() public {
        vm.prank(organizer);
        vm.expectRevert(bytes("no such event"));
        tk.mintTicket(999, buyer, 0, "", "", 0);
    }

    function test_AgentCanMintThenRevoked() public {
        uint256 id = _createEvent(true);
        vm.prank(organizer);
        tk.setAgent(id, agent, true);

        vm.prank(agent);
        uint256 tokenId = tk.mintTicket(id, buyer, 2500, "Agent Minted", "hi", 1);
        assertEq(tk.ownerOf(tokenId), buyer);

        vm.prank(organizer);
        tk.setAgent(id, agent, false);
        vm.prank(agent);
        vm.expectRevert(bytes("not organizer/agent"));
        tk.mintTicket(id, buyer, 0, "", "", 0);
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
        tk.mintTicket(id, buyer, 0, "", "", 0);
    }

    function test_InscriptionBlockedWhenOff() public {
        uint256 id = _createEvent(false);
        vm.prank(organizer);
        vm.expectRevert(bytes("inscriptions off for this event"));
        tk.mintTicket(id, buyer, 2500, "Dave", "hi", 1);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, 2500, "", "", 1);
        assertEq(tk.ownerOf(tokenId), buyer);
    }

    function test_LockOnFirstMint() public {
        uint256 id = _createEvent(true);
        vm.prank(organizer);
        tk.updateEvent(id, "New Name", "New Venue", DATE, _oneSponsor(), 0, true, false);
        vm.prank(organizer);
        tk.mintTicket(id, buyer, 0, "", "", 1);
        vm.prank(organizer);
        vm.expectRevert(bytes("event locked (tickets minted)"));
        tk.updateEvent(id, "Cannot", "Change", DATE, _noSponsors(), 0, true, false);
    }

    function test_RedeemFlagFlipsOnce() public {
        uint256 id = _createEvent(true);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, 2500, "", "", 1);
        vm.prank(organizer);
        tk.redeem(tokenId);
        (, TickloreTicketV3.Ticket memory t) = tk.ticketData(tokenId);
        assertTrue(t.redeemed);
        vm.prank(organizer);
        vm.expectRevert(bytes("already redeemed"));
        tk.redeem(tokenId);
    }

    // --- anti-scalp: 10-day time lock, then free ---
    function test_TransferLockedThenFree() public {
        uint256 id = _createEvent(true);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, 2500, "", "", 1);

        vm.prank(buyer);
        vm.expectRevert(bytes("locked until 10 days after the event"));
        tk.transferFrom(buyer, stranger, tokenId);

        vm.warp(uint256(DATE) + 10 days + 1);
        vm.prank(buyer);
        tk.transferFrom(buyer, stranger, tokenId);
        assertEq(tk.ownerOf(tokenId), stranger);
    }

    // --- soulbound: permanently non-transferable ---
    function test_SoulboundNeverTransfers() public {
        vm.prank(organizer);
        uint256 id = tk.createEvent("Sensitive", "Private", DATE, _noSponsors(), 0, false, true);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, 0, "", "", 0);

        vm.warp(uint256(DATE) + 365 days); // even a year later
        vm.prank(buyer);
        vm.expectRevert(bytes("ticket is permanently non-transferable"));
        tk.transferFrom(buyer, stranger, tokenId);
        assertEq(tk.ownerOf(tokenId), buyer);
    }

    // --- V3: multi-sponsor, per-ticket reference --------------------------------

    /// Two tickets on the same event, each referencing a DIFFERENT sponsor, plus a
    /// third with no sponsor — each keepsake shows only its own credit.
    function test_PerTicketSponsorReference() public {
        vm.prank(organizer);
        uint256 id = tk.createEvent("Charity Scramble", "Pinehurst", DATE, _twoSponsors(), 0, false, false);
        assertEq(tk.sponsorCount(id), 2);

        vm.startPrank(organizer);
        uint256 a = tk.mintTicket(id, buyer, 0, "", "", 1); // Alpha Foundation
        uint256 b = tk.mintTicket(id, buyer, 0, "", "", 2); // Beta Motors
        uint256 none = tk.mintTicket(id, buyer, 0, "", "", 0); // no sponsor
        vm.stopPrank();

        string memory svgA = _svgOf(a);
        assertTrue(_contains(svgA, "Supported by &#183; Alpha Foundation") || _contains(svgA, "Alpha Foundation"), "A shows Alpha");
        assertFalse(_contains(svgA, "Beta Motors"), "A does not show Beta");

        string memory svgB = _svgOf(b);
        assertTrue(_contains(svgB, "Beta Motors"), "B shows Beta");
        assertFalse(_contains(svgB, "Alpha Foundation"), "B does not show Alpha");

        string memory svgN = _svgOf(none);
        assertFalse(_contains(svgN, "Alpha Foundation"), "none shows no Alpha");
        assertFalse(_contains(svgN, "Beta Motors"), "none shows no Beta");
    }

    function test_BadSponsorRefReverts() public {
        uint256 id = _createEvent(false); // one sponsor => valid refs are 0 and 1
        vm.prank(organizer);
        vm.expectRevert(bytes("bad sponsor ref"));
        tk.mintTicket(id, buyer, 0, "", "", 2);
    }

    /// Lane A: no sponsors at all, ref 0 — mints and renders cleanly.
    function test_LaneANoSponsors() public {
        vm.prank(organizer);
        uint256 id = tk.createEvent("Community 5K", "Riverfront", DATE, _noSponsors(), 0, false, false);
        assertEq(tk.sponsorCount(id), 0);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, 2000, "", "", 0);
        string memory svg = _svgOf(tokenId);
        assertTrue(_contains(svg, "Community 5K"), "name renders");
        assertTrue(_contains(svg, "$20.00"), "price renders");
    }

    function test_FreeTicketRendersFree() public {
        vm.prank(organizer);
        uint256 id = tk.createEvent("Sponsor Gala", "Grand Hall", DATE, _twoSponsors(), 0, false, false);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, 0, "", "", 1);
        assertTrue(_contains(_svgOf(tokenId), "Free"), "free renders");
    }

    function test_EventSponsorsView() public {
        uint256 id = _createEvent(false);
        TickloreTicketV3.Sponsor[] memory s = tk.eventSponsors(id);
        assertEq(s.length, 1);
        assertEq(s[0].name, "The Acme Fund");
    }

    function test_UpdateReplacesSponsorList() public {
        vm.prank(organizer);
        uint256 id = tk.createEvent("Pre-lock", "Somewhere", DATE, _oneSponsor(), 0, false, false);
        assertEq(tk.sponsorCount(id), 1);
        vm.prank(organizer);
        tk.updateEvent(id, "Pre-lock", "Somewhere", DATE, _twoSponsors(), 0, false, false);
        assertEq(tk.sponsorCount(id), 2);
        TickloreTicketV3.Sponsor[] memory s = tk.eventSponsors(id);
        assertEq(s[0].name, "Alpha Foundation");
        assertEq(s[1].name, "Beta Motors");
    }

    function test_TokenURIRendersAndEscapes() public {
        TickloreTicketV3.Sponsor[] memory s = new TickloreTicketV3.Sponsor[](1);
        s[0] = TickloreTicketV3.Sponsor("In honor of", unicode"Ben & Jerry's");
        vm.prank(organizer);
        uint256 id = tk.createEvent(unicode"Mom & Dad's \"50th\"", "Home", DATE, s, 3, true, false);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, 8500, "Dave & Priya", unicode"Where it began <3", 1);

        string memory svg = _svgOf(tokenId);
        assertTrue(_contains(svg, "Mom &amp; Dad&apos;s &quot;50th&quot;"), "event name escaped");
        assertTrue(_contains(svg, "Ben &amp; Jerry&apos;s"), "sponsor escaped");
        assertTrue(_contains(svg, "Where it began &lt;3"), "inscription escaped");
        assertTrue(_contains(svg, "$85.00"), "price renders");
        assertTrue(_contains(svg, "THE STORY"), "eyebrow present");
        assertFalse(_contains(svg, "<script"), "no injection");
    }

    // --- helpers ---------------------------------------------------------------
    function _svgOf(uint256 tokenId) internal view returns (string memory) {
        string memory uri = tk.tokenURI(tokenId);
        string memory json = string(Base64.decode(_after(uri, 29)));
        string memory imageURI = vm.parseJsonString(json, ".image");
        return string(Base64.decode(_after(imageURI, 26)));
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
