// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Test, console2} from "forge-std/Test.sol";
import {TickloreTicket} from "../src/TickloreTicket.sol";
import {Base64} from "@openzeppelin/contracts/utils/Base64.sol";

contract TickloreTicketTest is Test {
    TickloreTicket ticklore;
    address boxOffice = makeAddr("boxOffice");
    address buyer     = makeAddr("L.Grant");
    address friend    = makeAddr("friend");

    uint64 constant EVENT_DATE = 1780142400;         // ~ May 30, 2026 12:00 UTC
    uint64 constant UNLOCK     = EVENT_DATE + 30 days;

    // Cached in setUp. Reading ticklore.MINTER_ROLE() is itself a call, and
    // vm.prank only applies to the NEXT call — so reading a role inline would
    // silently consume the prank and the real call would run unpranked.
    bytes32 MINTER;
    bytes32 STAFF;
    bytes32 ADMIN;

    function setUp() public {
        ticklore = new TickloreTicket(boxOffice);
        MINTER = ticklore.MINTER_ROLE();
        STAFF  = ticklore.STAFF_ROLE();
        ADMIN  = ticklore.DEFAULT_ADMIN_ROLE();
    }

    // normal, transferable ticket
    function _mintPicnic() internal returns (uint256 id) {
        vm.prank(boxOffice);
        id = ticklore.mintTicket(buyer, "Founders' Day Picnic", EVENT_DATE, "General", 2500, 0, UNLOCK, false, "", "", 0, 0, "", "");
    }

    // sensitive, permanently non-transferable ticket
    function _mintSensitive() internal returns (uint256 id) {
        vm.prank(boxOffice);
        id = ticklore.mintTicket(buyer, "Support Group", EVENT_DATE, "Member", 0, 0, UNLOCK, true, "", "", 0, 0, "", "");
    }

    function _used(uint256 id) internal view returns (bool u) {
        (,,,,, u,,,,,,,,,) = ticklore.tickets(id);
    }

    function test_MintAndReadBackFirstTicket() public {
        uint256 id = _mintPicnic();
        (string memory eventName,,,uint256 pricePaid,,bool used,,,address originalHolder,,,,,,) = ticklore.tickets(id);
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
        ticklore.mintTicket(buyer, "Fake", EVENT_DATE, "General", 0, 0, UNLOCK, false, "", "", 0, 0, "", "");
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

    // =====================================================================
    // Escaping — the injection fix
    //
    // A name like  Mom & Dad's "50th"  is an ordinary thing for an organizer
    // to type and a document-breaker if we paste it in raw. These tests use a
    // deliberately hostile name that exercises every dangerous character at
    // once, then decode the finished ticket and prove it still holds together.
    // =====================================================================

    string constant NASTY = unicode"Mom & Dad's \"50th\" <script>alert(1)</script>";

    function _mintNasty() internal returns (uint256 id) {
        vm.prank(boxOffice);
        id = ticklore.mintTicket(buyer, NASTY, EVENT_DATE, unicode"VIP & Guest", 2500, 0, UNLOCK, false, "", "", 0, 0, "", "");
    }

    /// Strip a known prefix off a string and return the rest.
    function _after(string memory s, uint256 prefixLen) internal pure returns (string memory) {
        bytes memory b = bytes(s);
        bytes memory out = new bytes(b.length - prefixLen);
        for (uint256 i = prefixLen; i < b.length; i++) {
            out[i - prefixLen] = b[i];
        }
        return string(out);
    }

    function _contains(string memory haystack, string memory needle) internal pure returns (bool) {
        bytes memory h = bytes(haystack);
        bytes memory n = bytes(needle);
        if (n.length == 0 || n.length > h.length) return false;
        for (uint256 i = 0; i <= h.length - n.length; i++) {
            bool hit = true;
            for (uint256 j = 0; j < n.length; j++) {
                if (h[i + j] != n[j]) { hit = false; break; }
            }
            if (hit) return true;
        }
        return false;
    }

    /// Decode the tokenURI back into readable JSON.
    function _decodedJSON(uint256 id) internal view returns (string memory) {
        // "data:application/json;base64," is 29 characters.
        return string(Base64.decode(_after(ticklore.tokenURI(id), 29)));
    }

    /// Pull the image out of the JSON and decode it back into readable SVG.
    function _decodedSVG(uint256 id) internal returns (string memory) {
        string memory json = _decodedJSON(id);
        string memory imageURI = vm.parseJsonString(json, ".image");
        // "data:image/svg+xml;base64," is 26 characters.
        return string(Base64.decode(_after(imageURI, 26)));
    }

    /// The headline test: a hostile name must still produce PARSEABLE JSON.
    /// Before the fix, the stray double-quote ended the string early and this
    /// whole document was garbage — permanently, since it's written on-chain.
    function test_NastyNameStillProducesValidJSON() public {
        uint256 id = _mintNasty();
        string memory json = _decodedJSON(id);
        console2.log("DECODED JSON:", json);

        // vm.parseJsonString reverts on malformed JSON, so reaching the
        // assertion at all is most of the proof.
        string memory name = vm.parseJsonString(json, ".name");
        assertTrue(_contains(name, "Mom & Dad's"), "event name survived intact");
        assertTrue(_contains(name, "50th"), "quoted portion survived");
    }

    /// The raw JSON text must carry escaped quotes, not bare ones.
    function test_JSONEscapesQuotes() public {
        uint256 id = _mintNasty();
        string memory json = _decodedJSON(id);
        assertTrue(_contains(json, "\\\"50th\\\""), "double-quotes are backslash-escaped");
    }

    /// And the SVG must carry XML entities, not raw markup characters.
    function test_SVGEscapesMarkupCharacters() public {
        uint256 id = _mintNasty();
        string memory svg = _decodedSVG(id);
        console2.log("DECODED SVG:", svg);

        assertTrue(_contains(svg, "&amp;"),  "ampersand became &amp;");
        assertTrue(_contains(svg, "&lt;"),   "less-than became &lt;");
        assertTrue(_contains(svg, "&gt;"),   "greater-than became &gt;");
        assertTrue(_contains(svg, "&quot;"), "double-quote became &quot;");
        assertTrue(_contains(svg, "&apos;"), "apostrophe became &apos;");
    }

    /// The actual attack: no injected element may survive into the artwork.
    function test_SVGCannotInjectElement() public {
        uint256 id = _mintNasty();
        string memory svg = _decodedSVG(id);
        assertFalse(_contains(svg, "<script"), "no raw script element in the SVG");
        assertFalse(_contains(svg, "alert(1)</"), "no raw closing tag in the SVG");
    }

    /// Ordinary names must come through completely unchanged — the escaping
    /// should be invisible when there's nothing to escape.
    function test_OrdinaryNameUnchanged() public {
        vm.prank(boxOffice);
        uint256 id = ticklore.mintTicket(buyer, "Sullivan Family Reunion", EVENT_DATE, "General", 2500, 0, UNLOCK, false, "", "", 0, 0, "", "");
        string memory svg = _decodedSVG(id);
        assertTrue(_contains(svg, "Sullivan Family Reunion"), "clean name passes through untouched");
    }

    /// Control characters are illegal raw inside JSON strings.
    function test_NewlineInNameIsEscaped() public {
        vm.prank(boxOffice);
        uint256 id = ticklore.mintTicket(buyer, "Line One\nLine Two", EVENT_DATE, "General", 0, 0, UNLOCK, false, "", "", 0, 0, "", "");
        string memory json = _decodedJSON(id);
        assertTrue(_contains(json, "\\u000a"), "newline encoded as \\u000a");
        vm.parseJsonString(json, ".name"); // reverts if malformed
    }

    // =====================================================================
    // Design — sponsor credit line + color palette
    // =====================================================================

    /// A sponsored ticket renders the credit line, colors the card by palette,
    /// and carries a Sponsor trait in the metadata.
    function test_SponsorAndPaletteRender() public {
        vm.prank(boxOffice);
        uint256 id = ticklore.mintTicket(
            buyer, "Charity Gala", EVENT_DATE, "Patron", 15000, 0, UNLOCK, false,
            "In honor of", "Margaret Ellis", 2 /* burgundy */, 0, "", ""
        );

        string memory svg = _decodedSVG(id);
        assertTrue(_contains(svg, "In honor of"),   "sponsor lead-in renders");
        assertTrue(_contains(svg, "Margaret Ellis"), "sponsor name renders");
        assertTrue(_contains(svg, unicode" · "), "credit separator renders");
        assertTrue(_contains(svg, "#3c1622"),        "burgundy background applied");

        string memory json = _decodedJSON(id);
        assertTrue(_contains(json, "\"trait_type\":\"Sponsor\""), "Sponsor trait present");
        assertTrue(_contains(json, "Margaret Ellis"),             "sponsor value present");
    }

    /// No sponsor set -> no credit line, no Sponsor trait, default teal.
    function test_NoSponsorIsClean() public {
        uint256 id = _mintPicnic();
        string memory json = _decodedJSON(id);
        assertFalse(_contains(json, "\"trait_type\":\"Sponsor\""), "no blank Sponsor trait");
        string memory svg = _decodedSVG(id);
        assertTrue(_contains(svg, "#123138"), "default teal background");
    }

    /// A hostile sponsor name must be escaped in the SVG, like the event name.
    function test_SponsorNameIsEscaped() public {
        vm.prank(boxOffice);
        uint256 id = ticklore.mintTicket(
            buyer, "Gala", EVENT_DATE, "Patron", 0, 0, UNLOCK, false,
            "Presented by", unicode"Ben & Jerry's", 0, 0, "", ""
        );
        string memory svg = _decodedSVG(id);
        assertTrue(_contains(svg, "Ben &amp; Jerry&apos;s"), "sponsor name escaped for XML");
    }

    /// The buyer's keepsake inscription — name + memorable line — renders,
    /// carries a "Held by" trait, and escapes hostile characters.
    function test_BuyerInscriptionRenders() public {
        vm.prank(boxOffice);
        uint256 id = ticklore.mintTicket(
            buyer, "Night to Remember", EVENT_DATE, "General", 2500, 0, UNLOCK, false,
            "", "", 0, 0, unicode"Dave & Priya", unicode"Where it all began <3"
        );
        string memory svg = _decodedSVG(id);
        assertTrue(_contains(svg, "Where it all began &lt;3"), "message renders + escapes");
        assertTrue(_contains(svg, "Dave &amp; Priya"),         "holder name renders + escapes");

        string memory json = _decodedJSON(id);
        assertTrue(_contains(json, "\"trait_type\":\"Held by\""), "Held by trait present");
    }

    /// No inscription -> no line, no "Held by" trait.
    function test_NoInscriptionIsClean() public {
        uint256 id = _mintPicnic();
        string memory json = _decodedJSON(id);
        assertFalse(_contains(json, "\"trait_type\":\"Held by\""), "no blank Held by trait");
    }

    // =====================================================================
    // Roles
    //
    // The point of separating these: the minting server lives online and is
    // the most likely thing to be compromised. If it holds the owner key, a
    // breach costs the contract. If it holds only MINTER_ROLE, a breach costs
    // some junk tickets and one revokeRole call.
    // =====================================================================

    address server = makeAddr("mintServer");
    address doorStaff = makeAddr("doorStaff");

    /// A fresh deployment must work with no setup — owner holds every role.
    function test_OwnerStartsWithAllRoles() public view {
        assertTrue(ticklore.hasRole(ADMIN, boxOffice));
        assertTrue(ticklore.hasRole(MINTER, boxOffice));
        assertTrue(ticklore.hasRole(STAFF, boxOffice));
    }

    function test_GrantedMinterCanMint() public {
        vm.prank(boxOffice);
        ticklore.grantRole(MINTER, server);

        vm.prank(server);
        uint256 id = ticklore.mintTicket(buyer, "Server Minted", EVENT_DATE, "General", 2500, 0, UNLOCK, false, "", "", 0, 0, "", "");
        assertEq(ticklore.ownerOf(id), buyer);
    }

    /// The whole point: a minter is not an owner.
    function test_MinterCannotCheckIn() public {
        vm.prank(boxOffice);
        ticklore.grantRole(MINTER, server);

        uint256 id = _mintPicnic();
        vm.prank(server);
        vm.expectRevert();
        ticklore.checkIn(id);
    }

    /// And door staff cannot mint themselves free tickets.
    function test_StaffCannotMint() public {
        vm.prank(boxOffice);
        ticklore.grantRole(STAFF, doorStaff);

        vm.prank(doorStaff);
        vm.expectRevert();
        ticklore.mintTicket(buyer, "Free For Me", EVENT_DATE, "General", 0, 0, UNLOCK, false, "", "", 0, 0, "", "");
    }

    function test_GrantedStaffCanCheckIn() public {
        vm.prank(boxOffice);
        ticklore.grantRole(STAFF, doorStaff);

        uint256 id = _mintPicnic();
        vm.prank(doorStaff);
        ticklore.checkIn(id);
        assertTrue(_used(id), "staff checked the ticket in");
    }

    /// The recovery path. This is the test that justifies the whole change:
    /// a compromised server key is revoked in one transaction, and the
    /// contract is otherwise untouched.
    function test_RevokedMinterCannotMint() public {
        vm.startPrank(boxOffice);
        ticklore.grantRole(MINTER, server);
        vm.stopPrank();

        vm.prank(server);
        ticklore.mintTicket(buyer, "Before Revoke", EVENT_DATE, "General", 0, 0, UNLOCK, false, "", "", 0, 0, "", "");

        vm.prank(boxOffice);
        ticklore.revokeRole(MINTER, server);

        vm.prank(server);
        vm.expectRevert();
        ticklore.mintTicket(buyer, "After Revoke", EVENT_DATE, "General", 0, 0, UNLOCK, false, "", "", 0, 0, "", "");

        // Ownership never moved.
        assertEq(ticklore.owner(), boxOffice);
    }

    /// A minter must not be able to hand the role to anyone else.
    function test_MinterCannotGrantRoles() public {
        vm.prank(boxOffice);
        ticklore.grantRole(MINTER, server);

        vm.prank(server);
        vm.expectRevert();
        ticklore.grantRole(MINTER, buyer);
    }

    /// Wallets and marketplaces ask the contract what it is.
    function test_SupportsBothInterfaces() public view {
        assertTrue(ticklore.supportsInterface(0x80ac58cd), "ERC721");
        assertTrue(ticklore.supportsInterface(0x7965db0b), "AccessControl");
        assertFalse(ticklore.supportsInterface(0xffffffff), "sanity check");
    }

    // =====================================================================
    // Emergency stop
    //
    // The interesting tests here are the ones asserting what pausing does
    // NOT do. Freezing the door mid-event would strand paying attendees
    // outside, and making already-minted keepsakes unreadable would break
    // the central promise of the product.
    // =====================================================================

    function test_PauseBlocksMinting() public {
        vm.prank(boxOffice);
        ticklore.pause();

        vm.prank(boxOffice);
        vm.expectRevert();
        ticklore.mintTicket(buyer, "While Paused", EVENT_DATE, "General", 0, 0, UNLOCK, false, "", "", 0, 0, "", "");
    }

    function test_PauseBlocksTransfers() public {
        uint256 id = _mintPicnic();
        vm.warp(UNLOCK + 1 days); // past the unlock, so only the pause can stop it

        vm.prank(boxOffice);
        ticklore.pause();

        vm.prank(buyer);
        vm.expectRevert(bytes("Ticklore: transfers are paused"));
        ticklore.transferFrom(buyer, friend, id);
    }

    /// The deliberate exception. Door staff must keep working during an
    /// emergency, or a pause strands everyone holding a valid ticket.
    function test_PauseDoesNotBlockCheckIn() public {
        uint256 id = _mintPicnic();

        vm.prank(boxOffice);
        ticklore.pause();

        vm.prank(boxOffice);
        ticklore.checkIn(id);
        assertTrue(_used(id), "the door still works while paused");
    }

    /// A keepsake that vanishes when the company has a bad day is not a
    /// keepsake. Reading is a view function and can never be paused.
    function test_PauseDoesNotBlockReadingTickets() public {
        uint256 id = _mintPicnic();

        vm.prank(boxOffice);
        ticklore.pause();

        string memory uri = ticklore.tokenURI(id);
        assertGt(bytes(uri).length, 0, "ticket still renders while paused");
    }

    function test_UnpauseRestoresMinting() public {
        vm.startPrank(boxOffice);
        ticklore.pause();
        ticklore.unpause();
        uint256 id = ticklore.mintTicket(buyer, "After Unpause", EVENT_DATE, "General", 0, 0, UNLOCK, false, "", "", 0, 0, "", "");
        vm.stopPrank();
        assertEq(ticklore.ownerOf(id), buyer);
    }

    function test_StrangerCannotPause() public {
        vm.prank(buyer);
        vm.expectRevert();
        ticklore.pause();
    }

    /// The minting server holds MINTER_ROLE only. A compromised server must
    /// not be able to halt the whole platform.
    function test_MinterCannotPause() public {
        vm.prank(boxOffice);
        ticklore.grantRole(MINTER, server);

        vm.prank(server);
        vm.expectRevert();
        ticklore.pause();
    }
}
