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
        id = ticklore.mintTicket(buyer, NASTY, EVENT_DATE, unicode"VIP & Guest", 2500, 0, UNLOCK, false);
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
        uint256 id = ticklore.mintTicket(buyer, "Sullivan Family Reunion", EVENT_DATE, "General", 2500, 0, UNLOCK, false);
        string memory svg = _decodedSVG(id);
        assertTrue(_contains(svg, "Sullivan Family Reunion"), "clean name passes through untouched");
    }

    /// Control characters are illegal raw inside JSON strings.
    function test_NewlineInNameIsEscaped() public {
        vm.prank(boxOffice);
        uint256 id = ticklore.mintTicket(buyer, "Line One\nLine Two", EVENT_DATE, "General", 0, 0, UNLOCK, false);
        string memory json = _decodedJSON(id);
        assertTrue(_contains(json, "\\u000a"), "newline encoded as \\u000a");
        vm.parseJsonString(json, ".name"); // reverts if malformed
    }
}
