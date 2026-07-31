// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {TickloreTicketV4} from "../src/TickloreTicketV4.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

contract TickloreTicketV4Test is Test {
    TickloreTicketV4 tk;
    address deployer  = makeAddr("deployer");
    address organizer = makeAddr("organizer");
    address successor = makeAddr("successor");
    address agent     = makeAddr("agent");
    address buyer     = makeAddr("buyer");
    address stranger  = makeAddr("stranger");
    uint64 constant DATE = 1780142400;

    function setUp() public {
        tk = new TickloreTicketV4(deployer);
    }

    // --- builders --------------------------------------------------------------
    function _noSponsors() internal pure returns (TickloreTicketV4.Sponsor[] memory s) {
        s = new TickloreTicketV4.Sponsor[](0);
    }

    function _oneSponsor() internal pure returns (TickloreTicketV4.Sponsor[] memory s) {
        s = new TickloreTicketV4.Sponsor[](1);
        s[0] = TickloreTicketV4.Sponsor("Supported by", "The Acme Fund");
    }

    function _twoSponsors() internal pure returns (TickloreTicketV4.Sponsor[] memory s) {
        s = new TickloreTicketV4.Sponsor[](2);
        s[0] = TickloreTicketV4.Sponsor("Supported by", "Alpha Foundation");
        s[1] = TickloreTicketV4.Sponsor("Sponsored by", "Beta Motors");
    }

    function _noSections() internal pure returns (string[] memory s) {
        s = new string[](0);
    }

    function _twoSections() internal pure returns (string[] memory s) {
        s = new string[](2);
        s[0] = "Table 7";
        s[1] = "Section A";
    }

    // one sponsor, no sections, price shown; inscriptions per arg; not soulbound
    function _createEvent(bool inscriptions) internal returns (uint256 id) {
        vm.prank(organizer);
        id = tk.createEvent("The Sullivan Reunion", "Lynchburg, VA", DATE, _oneSponsor(), _noSections(), 2, inscriptions, false, true);
    }

    // --- ported V3 coverage ----------------------------------------------------

    function test_CreateEventRecordsOrganizer() public {
        uint256 id = _createEvent(true);
        assertEq(tk.organizerOf(id), organizer);
        assertEq(id, 1);
        assertEq(tk.sponsorCount(id), 1);
    }

    function test_OrganizerCanMint() public {
        uint256 id = _createEvent(true);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, 2500, "Dave Chen", "First of many chapters", 1, 0);
        assertEq(tk.ownerOf(tokenId), buyer);
        assertEq(tk.eventIdOf(tokenId), id);
    }

    function test_MintNonexistentEventReverts() public {
        vm.prank(organizer);
        vm.expectRevert(bytes("no such event"));
        tk.mintTicket(999, buyer, 0, "", "", 0, 0);
    }

    function test_AgentCanMintThenRevoked() public {
        uint256 id = _createEvent(true);
        vm.prank(organizer);
        tk.setAgent(id, agent, true);

        vm.prank(agent);
        uint256 tokenId = tk.mintTicket(id, buyer, 2500, "Agent Minted", "hi", 1, 0);
        assertEq(tk.ownerOf(tokenId), buyer);

        vm.prank(organizer);
        tk.setAgent(id, agent, false);
        vm.prank(agent);
        vm.expectRevert(bytes("not organizer/agent"));
        tk.mintTicket(id, buyer, 0, "", "", 0, 0);
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
        tk.mintTicket(id, buyer, 0, "", "", 0, 0);
    }

    function test_InscriptionBlockedWhenOff() public {
        uint256 id = _createEvent(false);
        vm.prank(organizer);
        vm.expectRevert(bytes("inscriptions off for this event"));
        tk.mintTicket(id, buyer, 2500, "Dave", "hi", 1, 0);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, 2500, "", "", 1, 0);
        assertEq(tk.ownerOf(tokenId), buyer);
    }

    function test_LockOnFirstMint() public {
        uint256 id = _createEvent(true);
        vm.prank(organizer);
        tk.updateEvent(id, "New Name", "New Venue", DATE, _oneSponsor(), _noSections(), 0, true, false, true);
        vm.prank(organizer);
        tk.mintTicket(id, buyer, 0, "", "", 1, 0);
        vm.prank(organizer);
        vm.expectRevert(bytes("event locked (tickets minted)"));
        tk.updateEvent(id, "Cannot", "Change", DATE, _noSponsors(), _noSections(), 0, true, false, true);
    }

    function test_RedeemFlagFlipsOnce() public {
        uint256 id = _createEvent(true);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, 2500, "", "", 1, 0);
        vm.prank(organizer);
        tk.redeem(tokenId);
        (, TickloreTicketV4.Ticket memory t) = tk.ticketData(tokenId);
        assertTrue(t.redeemed);
        vm.prank(organizer);
        vm.expectRevert(bytes("already redeemed"));
        tk.redeem(tokenId);
    }

    function test_TransferLockedThenFree() public {
        uint256 id = _createEvent(true);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, 2500, "", "", 1, 0);

        vm.prank(buyer);
        vm.expectRevert(bytes("locked until 10 days after the event"));
        tk.transferFrom(buyer, stranger, tokenId);

        vm.warp(uint256(DATE) + 10 days + 1);
        vm.prank(buyer);
        tk.transferFrom(buyer, stranger, tokenId);
        assertEq(tk.ownerOf(tokenId), stranger);
    }

    function test_SoulboundNeverTransfers() public {
        vm.prank(organizer);
        uint256 id = tk.createEvent("Sensitive", "Private", DATE, _noSponsors(), _noSections(), 0, false, true, true);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, 0, "", "", 0, 0);

        vm.warp(uint256(DATE) + 365 days); // even a year later
        vm.prank(buyer);
        vm.expectRevert(bytes("ticket is permanently non-transferable"));
        tk.transferFrom(buyer, stranger, tokenId);
        assertEq(tk.ownerOf(tokenId), buyer);
    }

    function test_PerTicketSponsorReference() public {
        vm.prank(organizer);
        uint256 id = tk.createEvent("Charity Scramble", "Pinehurst", DATE, _twoSponsors(), _noSections(), 0, false, false, true);
        assertEq(tk.sponsorCount(id), 2);

        vm.startPrank(organizer);
        uint256 a = tk.mintTicket(id, buyer, 0, "", "", 1, 0);
        uint256 b = tk.mintTicket(id, buyer, 0, "", "", 2, 0);
        uint256 none = tk.mintTicket(id, buyer, 0, "", "", 0, 0);
        vm.stopPrank();

        string memory svgA = _svgOf(a);
        assertTrue(_contains(svgA, "Alpha Foundation"), "A shows Alpha");
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
        tk.mintTicket(id, buyer, 0, "", "", 2, 0);
    }

    function test_TokenURIRendersAndEscapes() public {
        TickloreTicketV4.Sponsor[] memory s = new TickloreTicketV4.Sponsor[](1);
        s[0] = TickloreTicketV4.Sponsor("In honor of", unicode"Ben & Jerry's");
        vm.prank(organizer);
        uint256 id = tk.createEvent(unicode"Mom & Dad's \"50th\"", "Home", DATE, s, _noSections(), 3, true, false, true);
        vm.prank(organizer);
        uint256 tokenId = tk.mintTicket(id, buyer, 8500, "Dave & Priya", unicode"Where it began <3", 1, 0);

        string memory svg = _svgOf(tokenId);
        assertTrue(_contains(svg, "Mom &amp; Dad&apos;s &quot;50th&quot;"), "event name escaped");
        assertTrue(_contains(svg, "Ben &amp; Jerry&apos;s"), "sponsor escaped");
        assertTrue(_contains(svg, "Where it began &lt;3"), "inscription escaped");
        assertTrue(_contains(svg, "$85.00"), "price renders");
        assertTrue(_contains(svg, "THE STORY"), "eyebrow present");
        assertFalse(_contains(svg, "<script"), "no injection");
    }

    // --- V4: price display -----------------------------------------------------

    /// showPrice OFF: neither a dollar figure nor "Free" appears — the price
    /// area renders nothing at all.
    function test_ShowPriceOffRendersNothing() public {
        vm.prank(organizer);
        uint256 id = tk.createEvent("Quiet Gala", "Grand Hall", DATE, _noSponsors(), _noSections(), 0, false, false, false);
        vm.startPrank(organizer);
        uint256 paid = tk.mintTicket(id, buyer, 15000, "", "", 0, 0);
        uint256 comp = tk.mintTicket(id, buyer, 0, "", "", 0, 0);
        vm.stopPrank();

        string memory svgPaid = _svgOf(paid);
        assertFalse(_contains(svgPaid, "$150.00"), "no price shown");
        assertFalse(_contains(svgPaid, "Free"), "no Free shown");

        string memory svgComp = _svgOf(comp);
        assertFalse(_contains(svgComp, "Free"), "comp shows nothing either");
    }

    function test_ShowPriceOnRendersTruthfully() public {
        vm.prank(organizer);
        uint256 id = tk.createEvent("Cash Night", "Riverbend", DATE, _noSponsors(), _noSections(), 0, false, false, true);
        vm.startPrank(organizer);
        uint256 paid = tk.mintTicket(id, buyer, 2500, "", "", 0, 0);
        uint256 comp = tk.mintTicket(id, buyer, 0, "", "", 0, 0);
        vm.stopPrank();
        assertTrue(_contains(_svgOf(paid), "$25.00"), "paid shows price");
        assertTrue(_contains(_svgOf(comp), "Free"), "comp shows Free");
    }

    // --- V4: sections ----------------------------------------------------------

    function test_SectionRendersPerTicket() public {
        vm.prank(organizer);
        uint256 id = tk.createEvent("Winter Ball", "The Armory", DATE, _noSponsors(), _twoSections(), 0, false, false, true);
        assertEq(tk.sectionCount(id), 2);

        vm.startPrank(organizer);
        uint256 t7 = tk.mintTicket(id, buyer, 0, "", "", 0, 1); // Table 7
        uint256 sa = tk.mintTicket(id, buyer, 0, "", "", 0, 2); // Section A
        uint256 none = tk.mintTicket(id, buyer, 0, "", "", 0, 0);
        vm.stopPrank();

        string memory svg7 = _svgOf(t7);
        assertTrue(_contains(svg7, "Table 7"), "t7 shows Table 7");
        assertFalse(_contains(svg7, "Section A"), "t7 does not show Section A");

        string memory svgA = _svgOf(sa);
        assertTrue(_contains(svgA, "Section A"), "sa shows Section A");
        assertFalse(_contains(svgA, "Table 7"), "sa does not show Table 7");

        string memory svgN = _svgOf(none);
        assertFalse(_contains(svgN, "Table 7"), "none shows no section");
        assertFalse(_contains(svgN, "Section A"), "none shows no section");
    }

    function test_BadSectionRefReverts() public {
        vm.prank(organizer);
        uint256 id = tk.createEvent("Winter Ball", "The Armory", DATE, _noSponsors(), _twoSections(), 0, false, false, true);
        vm.prank(organizer);
        vm.expectRevert(bytes("bad section ref"));
        tk.mintTicket(id, buyer, 0, "", "", 0, 3);
    }

    function test_UpdateReplacesSections() public {
        vm.prank(organizer);
        uint256 id = tk.createEvent("Pre-lock", "Somewhere", DATE, _noSponsors(), _twoSections(), 0, false, false, true);
        assertEq(tk.sectionCount(id), 2);
        string[] memory one = new string[](1);
        one[0] = "VIP";
        vm.prank(organizer);
        tk.updateEvent(id, "Pre-lock", "Somewhere", DATE, _noSponsors(), one, 0, false, false, true);
        assertEq(tk.sectionCount(id), 1);
        assertEq(tk.eventSections(id)[0], "VIP");
    }

    // --- V4: authority handoff -------------------------------------------------

    function test_TransferOrganizerByOrganizer() public {
        uint256 id = _createEvent(false);
        vm.prank(organizer);
        tk.transferOrganizer(id, successor);
        assertEq(tk.organizerOf(id), successor);

        // The successor manages now; the old organizer is out.
        vm.prank(successor);
        uint256 tokenId = tk.mintTicket(id, buyer, 0, "", "", 1, 0);
        assertEq(tk.ownerOf(tokenId), buyer);
        vm.prank(organizer);
        vm.expectRevert(bytes("not organizer/agent"));
        tk.mintTicket(id, buyer, 0, "", "", 0, 0);
    }

    function test_TransferOrganizerByOwnerFallback() public {
        uint256 id = _createEvent(false);
        vm.prank(deployer); // contract owner = Ticklore recovery path
        tk.transferOrganizer(id, successor);
        assertEq(tk.organizerOf(id), successor);
    }

    function test_TransferOrganizerStrangerReverts() public {
        uint256 id = _createEvent(false);
        vm.prank(stranger);
        vm.expectRevert(bytes("not organizer/owner"));
        tk.transferOrganizer(id, stranger);
        vm.prank(organizer);
        vm.expectRevert(bytes("zero address"));
        tk.transferOrganizer(id, address(0));
    }

    function test_TransferOrganizerEmitsAndAgentsPersist() public {
        uint256 id = _createEvent(false);
        vm.prank(organizer);
        tk.setAgent(id, agent, true);

        vm.expectEmit(true, true, true, true);
        emit TickloreTicketV4.OrganizerTransferred(id, organizer, successor, organizer);
        vm.prank(organizer);
        tk.transferOrganizer(id, successor);

        // Agent grants survive the handoff (the successor can revoke them).
        assertTrue(tk.isEventAgent(id, agent));
        vm.prank(agent);
        uint256 tokenId = tk.mintTicket(id, buyer, 0, "", "", 0, 0);
        assertEq(tk.ownerOf(tokenId), buyer);
        vm.prank(successor);
        tk.setAgent(id, agent, false);
        assertFalse(tk.isEventAgent(id, agent));
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
