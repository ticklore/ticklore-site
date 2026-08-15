// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {TickloreTicketV6} from "../src/TickloreTicketV6.sol";

/// @notice Live V6 smoke on Base Sepolia. One event, two keepsakes, built to
///         put the NEW TYPOGRAPHY under maximum pressure rather than to flatter
///         it — because this is the version whose whole purpose is the art, and
///         mainnet freezes it.
///
///         Token A: long event name, venue, section, sponsor, inscription and a
///         shown price — every line occupied at once, so the wordmark has to
///         hold its own in a crowded card.
///         Token B: bare minimum, price hidden — the wordmark and the tagline
///         alone in a mostly empty card, where crowding and tracking show up
///         most plainly.
///
///         Prints both tokenURIs for decoding and rendering off-chain.
contract SmokeV6 is Script {
    function run() external {
        TickloreTicketV6 t = TickloreTicketV6(vm.envAddress("V6_ADDR"));
        address minter = 0xE6Bc4936F328719651851ddce1Eb3248648dFF14;

        TickloreTicketV6.Sponsor[] memory sponsors = new TickloreTicketV6.Sponsor[](1);
        sponsors[0] = TickloreTicketV6.Sponsor("Supported by", "Oceanfront 12 & 12");
        string[] memory sections = new string[](1);
        sections[0] = "Table 7";

        vm.startBroadcast();
        // Busy card: price shown, everything populated.
        uint256 busy = t.createEvent(
            unicode"New Year's Eve Gala", "Wyndham Virginia Beach Oceanfront",
            1798761600 /* 2026-12-31 */, sponsors, sections,
            1 /* midnight & silver */, true /* inscriptions */, false, true /* show price */
        );
        uint256 tokA = t.mintTicket(busy, minter, 6000, "Alex W", unicode"Where it began", 1, 1);

        // Sparse card: nothing but the frame, the name and the wordmark.
        TickloreTicketV6.Sponsor[] memory none = new TickloreTicketV6.Sponsor[](0);
        string[] memory noSections = new string[](0);
        uint256 sparse = t.createEvent(
            unicode"Quiet Evening", "", 1798761600, none, noSections,
            0 /* teal & gold */, false, false, false /* price hidden */
        );
        uint256 tokB = t.mintTicket(sparse, minter, 0, "", "", 0, 0);
        vm.stopBroadcast();

        console2.log("busy eventId ", busy);
        console2.log("tokA (crowded card)", tokA);
        console2.log("URI_A", t.tokenURI(tokA));
        console2.log("sparse eventId", sparse);
        console2.log("tokB (empty card)", tokB);
        console2.log("URI_B", t.tokenURI(tokB));
    }
}
