# Ticklore — CANONICAL HANDOFF · updated 2026-07-30
### Single source of truth: live technical state + product decisions + north star
### THIS repo copy (`docs/HANDOFF.md`) is authoritative — git is the sync. It supersedes all Downloads copies.

**For:** the next Claude picking up Ticklore — self-contained; no transcript needed.
**Founder:** Alex Winfield (alex@vbre.org). Learns Solidity line-by-line; wants **honest pushback over
agreement**, and has been right in disagreements — argue properly. **NO deadline — quality-gated, not
date-gated. The October pilot date is OUT** ("if it takes longer, it takes longer" applies to the
launch itself). Tag work **near** vs **later** for per-session focus, not to protect a date.
**Two rooms:** the **Code** session (desktop app, wired to the repo) does edits/deploys and reads/updates
this file each session; the **web chat** does thinking, specs, and product decisions from a pasted copy.

---

## TL;DR — current state
The **V3 multi-sponsor stack and the Lane B concierge backend are LIVE on the demo**
(`ticklore-site.onrender.com`). Live and verified: `/health` green (V1), reads/publish/buy on **V3**,
`/admin` concierge armed behind `ADMIN_PASSWORD`, demo mint cap 20/day, `/organize` cleaned to pure
Lane A (no sponsor UI). The full concierge flow works end-to-end: sponsor blocks → claim codes → QR
sheet → attendee claims → ticket lazy-mints carrying its block's sponsor.
**Freeze is REFRAMED (see ⚠️ below): event-triggered (first real keepsake / vault deploy), never
scheduled. The final contract design pass happens when we next touch the contract — batched, no rush.**

## The product (one paragraph)
Ticklore — "every ticket has a story." An ERC-721 keepsake-ticketing product on **Base** (currently
Base **Sepolia** testnet, chainId 84532). Minting is gated behind a Node **`mint-service/`** (Express +
ethers v6); **Stripe is the cash register — the contract never holds money.** The keepsake renders its
art **on-chain** via `tokenURI` (base64 SVG). Longer arc: an installable attendee **keepsake wallet
(PWA)** at `/wallet` opening into a per-event **memory vault** (Phase 2, not built yet).

## Positioning (put it on the wall)
Ticklore is **NOT a smaller Ticketmaster**. They swim in **logistics** (seat maps, dynamic pricing,
anti-bot, millions of forgettable seats); Ticklore is in **memory** — local, meaningful events worth
keeping. Never compete feature-for-feature on box-office plumbing. Filter for every new feature:
*is this memory, or is this logistics?* Memory = maybe yes. Pure logistics = probably not ours.

## Where the code + deploys + toolchain live
- **Code clone (wired):** `C:\Users\bigow\OneDrive\Documents\GitHub\ticklore-site` (GitHub
  `weldingcrypto/ticklore-site`).
- **Two deploys, two branches — one push does NOT update both:**
  - `main` → Netlify → **ticklore.com** (password-gated marketing site; browser basic-auth popup).
  - `feature/ticket-contract` → Render → **ticklore-site.onrender.com** (the actual app: `/shop`,
    `/organize`, `/admin`, `/claim/...`, mint-service).
- **Dev toolchain:** full env in **WSL2 Ubuntu** (Node 22 + Foundry 1.7.1), repo at
  `/home/alex/ticklore-site`. OneDrive clone has **no** `node_modules` (npm only in WSL). Drive WSL
  from PowerShell via a **script file** (`wsl -e bash -lic "bash /mnt/c/…/script.sh"`) — inline bash
  gets mangled by PowerShell↔WSL quoting. Verify visuals with local headless Chrome
  (`chrome.exe --headless=new`), which can also hit live `onrender.com` URLs.
- **Other docs:** `C:\Users\bigow\Downloads\ticklore-*.md` — incl. `ticklore-vault-architecture-decision.md`
  (ADR-001 rev 3, **read before building the vault**), `ticklore-plan-refinement-v3.1.md` (sponsor/pricing
  write-up), `ticklore-team-section-v3-dropin.md`, `ticklore-cofounder-pat-osborne.md`.

## LIVE STACK (as deployed, verified 2026-07-27)
| Render env var | Value | Powers |
|---|---|---|
| `TICKLORE_CONTRACT` | `0xc2D99cC604c5211A6bd8a1D0594D684d0c48f3BD` (V1) | `/health`, seed fallback |
| `TICKLORE_CONTRACT_V2` | `0xb953ab6ceF8D339641F55177778829F557D86D06` (V2) | legacy event-model (superseded) |
| `TICKLORE_CONTRACT_V3` | `0x353e83989592aB5dA812eE59D89Ea1356e283866` (V3) | **active** — reads, publish, buy, concierge |
| `ADMIN_PASSWORD` | (Alex's) | the `/admin` concierge gate (password-only, no username) |
| `ORGANIZER_PASSWORD` | (Alex's) | the `/organize` gate |
| `EVENT_STORE` | `/var/data/events.json` | events, on persistent disk |
| `CLAIM_STORE` | `/var/data/claims.json` | claim codes, on persistent disk (survives redeploys) |
| `ALLOW_DEMO_BUY` | true | demo buy path |
| `MINTER_PRIVATE_KEY`, `RPC_URL` | (set) | signer + Base Sepolia RPC |

**Env discipline (hard-won):** every contract flip is an **ADDED** variable, never a replacement. The
code prefers the newest configured model (V3 > V2 > V1). Pointing `TICKLORE_CONTRACT` at a newer
contract breaks `/health` (V1 `nextTicketId()` reverts) — keep V1 where it is.
**Post-V3-flip note:** reads moved to V3, so old V2 demo tickets 404 — fresh events only.
**Demo mint cap:** 20/day default, override `DEMO_DAILY_MINT_CAP`; in-memory (resets UTC midnight +
redeploy); over-cap = calm 429 "today's batch is full" page.

## Contract lineage
- **V1** `TickloreTicket.sol` (`0xc2D99c…`) — original 14-arg mint; powers `/health` only.
- **V2** `TickloreTicketV2.sol` (`0xb953…`) — event model (events on-chain, organizer authority,
  5-arg mint, lock-on-first-mint, 10-day anti-scalp window, soulbound opt-in, redeem-as-flag,
  on-chain SVG). 12 tests. **Superseded by V3;** still deployed.
- **V3** `TickloreTicketV3.sol` (`0x353e83989592aB5dA812eE59D89Ea1356e283866`, owner = minter
  `0xE6Bc4936F…`) — **V2 + multi-sponsor**: `Event` holds `Sponsor[] {leadIn,name}` (cap 128);
  `Ticket` carries `sponsorRef` (0 = none, else 1-based index — **permanent, on-chain**);
  `mintTicket(eventId,to,price,buyerName,inscription,sponsorRef)`; views `eventSponsors`/`sponsorCount`;
  price=0 renders "Free". Lane A = empty list + ref 0; Lane B = list + per-ticket ref. **18 forge tests
  green**; smoke-verified on-chain (two tickets on one event each carrying only its own sponsor).
  Scripts: `DeployV3.s.sol`, `SmokeV3.s.sol`. (Foundry gotcha: busy wallet → "nonce too low" on
  broadcast; re-run with `--slow`.)

## ⚠️ FREEZE — REFRAMED (DECIDED 2026-07-30): event-triggered, not scheduled
**What "freeze" means (so nobody re-scares themselves):** every deployed contract is already immutable;
V1→V2→V3 were *replacements* at new addresses, not edits. "Freeze" is simply the **promise to stop
replacing** — because (a) every replacement orphans the old contract's keepsakes (fatal to the
permanence pitch once real people hold them), and (b) the vault is immutable/no-admin and anchors to
ONE ticket-contract address forever.
**The freeze is triggered by events, never by calendar:** (1) the first keepsake a real person truly
keeps — whatever contract mints it is de facto the forever contract; (2) deploying the vault. Until
either happens, iterate contracts freely on testnet. **Hard line: never run a real pilot on a contract
already slated for replacement.** Everything off-chain (mint-service, UI, claim flow, pricing) plus all
per-event data (palette, sponsors, blocks, soulbound) stays flexible forever regardless.
**The deployed V3 is NOT the final contract.** Discipline kept from the 2026-07-29 review: whenever the
contract is next touched, **batch everything known into ONE design pass** — no dribbled patches. Known
items for that pass:
1. **Price-display option (REVISED decision):** price shows when it tells a true story; the organizer
   can **OMIT** it (sponsor-funded/free events shouldn't stamp "$0" forever; gifts shouldn't brag a
   price). Decide mechanism (per-event flag vs per-ticket) in the pass.
2. **Section/table blocks (seating — DECIDED):** YES to named sections/tiers (GA / Section A / VIP)
   and tables/zones (Table 7) — reuse the **block** model (a section/table is a named block a ticket
   references). **REJECTED:** interactive seat maps / live seat-locking (logistics ocean — not our
   fight). OPEN: is section/table **permanent on the keepsake** (when it's part of the story — matches
   sponsor/inscription pattern) or operational-only (door management)?
3. **Authority handoff/reassignment (DECIDED):** BOTH organizer (primary) and Ticklore (fallback,
   recovery-only) can reassign an event's organizer authority to a new address. Reassign-only,
   on-chain, auditable — never seize. Moves the ADMIN role only; never alters minted keepsakes.
4. **Event-metadata mutability** — the standing call is lock-on-first-mint; confirm it as the final
   answer (or refine) in the pass.
5. **Arweave cost** for the vault — settle before the vault deploys (it anchors to the final contract).
Sequence when the trigger nears: final design pass → the contract that mints real keepsakes →
Privy → Phase-2 vault.

## How the mint-service is wired (as-built)
All model code is additive + env-gated; the code prefers newest (V3 > V2 > V1).
- `lib/ticklore-v3.js` — V3 interface (sponsor tuples, `sponsorRef`, `normalizeSponsors`); **RPC-lag
  retry loops** on mint ("no such event") and read ("no such ticket") — safe, failures are pre-send.
  (`ticklore-v2.js` same pattern for V2; `ticklore.js` = V1 + `getSigner`, key handling in one place.)
- `server.js` — connects each chain if its env is set; `ticketSource()` routes `/ticket` reads to the
  newest; mounts stripe-routes, storefront, organizer, **concierge**, wallet.
- `lib/organizer.js` — public Lane A create form (`/organize`, `ORGANIZER_PASSWORD`): name, venue,
  date, price, palette/style, inscription toggle, soulbound toggle. **No sponsor UI — removed;
  sponsors are concierge-only.** Publish → `createEvent` on newest model, stores `onChainEventId` +
  `onChainVersion`.
- `lib/events.js` — file-backed event store: `sponsors[]`, `mode` ("standard" | "sponsor"), `blocks`,
  `mintedCount` + `recordMint()`, dedup guard, validation.
- `lib/stripe-routes.js` — webhook-minting flow (mint on Stripe's signed webhook, never the redirect);
  demo buy at `/success?demo=` gated by `ALLOW_DEMO_BUY` + **mint cap** (reserve before mint, release
  on failure); V3 buys mint with the event's sponsor assignment; sponsor events are hidden from
  `/shop` and rejected by the demo buy (claim-only).
- `lib/mint-cap.js` — the 20/day demo fuse (`tryReserveMint`/`releaseMint`/`status`).

## Lane B concierge backend — BUILT + LIVE (2026-07-27)
The "Ticklore prints tickets manually" tool. Admin-only (`ADMIN_PASSWORD`); needs V3.
- **`/admin`** — create a sponsor event by defining **sponsor blocks** (sponsor × ticket count:
  Acme × 4, Beta × 8…). On create → V3 `createEvent` with the full sponsor list (permanent) + generate
  one **claim code per ticket**, tagged to its block. Nothing mints yet. Console lists events with
  claimed/unclaimed stats; delete removes the event + unclaimed codes (minted tickets stay on-chain).
- **`/admin/event/:key/sheet`** — printable **QR sheet**, codes grouped by sponsor (server-side SVG QR
  via the `qrcode` dep; no external calls). Print, cut, hand each foursome their codes.
- **`/claim/:code`** — public claim page: attendee enters **email** → ticket **LAZY-MINTS on V3**
  carrying its block's sponsor, held custodially against the email (migrates to Privy later).
  reserve→mint→finalize: a code mints exactly once; failed mints release the code.
- `lib/claims.js` — file-backed code store (generate/reserve/finalize/release/stats/removeByEvent);
  codes are 12-char base64url, unguessable; `CLAIM_STORE` on the persistent disk.
- **Distribution model (DECIDED): claim links / QR + lazy mint + email-custodial.** **By BLOCK, not
  rotation** — each sponsor owns a set of tickets; Alex assigns blocks at setup; attribution rides the
  code, so lineup changes break nothing. (Round-robin was built briefly and corrected.)
- Verified end-to-end vs deployed V3: Acme×3/Beta×3 → QR on every code → claim Acme → ticket carries
  Acme → double-claim blocked → Beta claim carries Beta.
- **Door check-in (redemption) — BUILT (2026-07-30).** Per-event opt-in on the concierge create form
  (`redemptionEnabled`, default off = keepsake-only). Claimed tickets on enabled events get a
  "Door check-in →" link on the claim page → `/door/:code`: staff enters the **admin password**, the
  server calls the contract's `redeem` (never a burn), the keepsake gains its permanent on-chain
  **ADMITTED** stamp, and claim/door pages flip to "Admitted ✓" (mirrored as `redeemedAt` in the claim
  store; the chain is the truth). Wrong password 401; double check-in 409; unclaimed → "claim first";
  keepsake-only events → "not enabled". Note: freshly stamped art can lag a few seconds behind on
  public-RPC reads — harmless in practice.
- **Batch-is-the-product gaps — CLOSED (2026-07-30).** Blocks no longer require a sponsor (plain
  blocks mint with sponsorRef 0; the sheet groups them as "General"), and each block carries an
  optional **price** — what the buyer pays the organizer directly, engraved at claim (0/blank renders
  "Free"; sheet group labels show the price so staff know which cards sell for what). Verified vs
  deployed V3: Acme@$25 / plain@$10 / plain-free all engrave correctly, on-chain sponsor list holds
  only real sponsors.
- Not built yet: attendee wallet-connect on claim, emailed claim receipts.

## Two product modes (DECIDED — the spine)
1. **Lane A — Standard ticketing (general admission), self-serve, the scale engine.** Organizer sets up
   their own event; attendees pay; Ticklore skims **5% + $0.99 per ticket** via **Stripe Connect
   Standard** application fee (organizer = merchant of record; onboards to Connect ONCE at signup).
   **NO sponsor feature at all.**
2. **Lane B — Sponsor Keepsake events, Ticklore-built ONLY (concierge), premium.** Usually **free to
   the attendee** (sponsor-funded); keepsake carries permanent sponsor attribution; distributed by
   claim code. High-touch on purpose — Alex hands-on every one to learn the market before self-serve.
   *Named risk:* this makes Alex the bottleneck for Lane B until it graduates to software — chosen
   deliberately (depth now to earn scale later).
- This split **DISSOLVED the "gate the sponsor toggle" problem** — no public toggle exists; access
  control = "only Ticklore creates sponsor events."

## Money architecture (DECIDED)
- **Ticklore never holds ticket or sponsor money.** Buyer's card → the **organizer's** Stripe → their
  bank; Ticklore mints on the signed "payment succeeded" webhook (a signal, not funds). Organizer =
  merchant of record (their refunds/chargebacks/tax). Keeps Ticklore clear of money-transmitter
  status (confirm with a payments attorney before scale).
- **Lane A revenue:** Connect application-fee skim, **5% + $0.99**. **Connect is deferred BY DESIGN
  (strategy, not accident):** sponsor events have free tickets (invoice the organizer directly) and
  early standard events can run LLC-as-merchant. Concierge-first can operate and earn for months;
  build Connect when self-serve demand is real.
- **Lane B revenue — REVISED (Alex, 2026-07-30): THE BATCH IS THE PRODUCT.** Ticklore charges the
  organizer a **flat $750 for an allotment of batched tickets**; the organizer then sells/distributes
  them however they like (cash at the door, their own channels, give-aways) — **Ticklore never touches
  ticket money in Lane B, ever.** Sponsors are an OPTION within a batch, not its reason: fully
  sponsor-funded (free to attendee), partially sponsored (credit on ticket, buyer pays the organizer
  directly), or **no sponsor at all** (plain batch). Engraved price = what the buyer actually pays the
  organizer — honest even though the money never passes through Ticklore. This supersedes the earlier
  tier-×-placement framing ($750 had been "the floor"); larger batches / premium concierge work can
  still be quoted up, but the flat batch fee is the base product. **Still true: a FEE, never a % of the
  sponsor's payment.** Billing is manual/offline (invoice the organizer). This kills any remaining
  Lane B need for Stripe Connect.
- **Sponsor money stays the organizer's** — their fundraising, collected however they already do it.
  Ticklore takes no cut of sponsorship.

## PRODUCT DECISIONS & NORTH STAR (the "why" — do not lose this)
- **North star:** the keepsake is the reason. Quality test: **"would someone set this ticket as their
  desktop wallpaper?"** If it isn't something a person is proud to look at every day, it isn't done.
- **Sponsors are the PATRON, never the point.** A restrained, permanent on-chain credit line. If any
  choice optimizes sponsor visibility over attendee sentiment, it's wrong. Sponsor **logos live in the
  event vault, not on the ticket face.**
- **Buyer inscription = YES, but GATED — moderation checkpoint BUILT (2026-07-30).** Short one-liner
  engraved at mint; organizer opt-in (off by default). `lib/moderation.js` runs BEFORE the mint fires
  (and before the mint-cap reservation, so rejections cost nothing): profanity/slur blocklist with
  leetspeak normalization + squeezed matching + whole-token masked-variant checks ("f*ck", "f0ck",
  "f u c k" all caught; "Ashton"/"Fukushima" safe); links, emails, and long digit runs rejected
  ("a memory, not an ad"). Leans strict on purpose: a false positive costs a rephrase, a false negative
  is forever. Pilot-grade — when events get bigger, layer a moderation API and/or organizer approval
  behind the same `checkInscription()` seam.
- **Permanence discipline:** engraved event record + generated art always on-chain. Text memories
  fully on-chain; photos → durable storage + on-chain hash. Attendee images opt-in, moderated, PG.
- **No resale royalties; never position the ticket as an appreciating asset.**
- **Anti-scalp:** 10-day transfer lock after the event date, then free as a keepsake; per-event
  **soulbound** opt-in is permanent.
- **Price on ticket:** kept when it tells a true story; **omit option is a freeze-pass item** (above).
- **Design system (future):** organizer picks palette/layout from **curated** options the contract
  renders — never free-form.

## Vault design note (2026-07-28, Alex)
The vault should look and feel like a **real, branded web page** — full Ticklore styling, same feel as
the ticket — the *deeper story behind the keepsake*: event hero, the story, photo galleries, roster,
**sponsor credits panel** (logos live here), post-event memories. Two layers: the *look* is
presentation (app renders it freely); *where content lives* decides permanence — the permanent core
(event record, story, sponsor credits) anchors on **Arweave permaweb**, with the interactive/editable
layer as a normal app view on top. (Ties to the Arweave-cost freeze item. Full architecture: ADR-001
rev 3 — vault keyed by `eventId`, open reads, privacy via curation not encryption.)

## Trademark / IP (informal — NOT legal advice)
- **Trademark the name: worth it. Patents: almost certainly not.** Moat = brand + keepsake positioning
  + execution. No exact "Ticklore" conflict found informally, but the category is crowded with "Tick-"
  marks and confusion-likelihood is the test — the "-lore" ending helps. Before filing: real clearance
  search + attorney; likely classes 042 (+ possibly 041). Free now: use **™**; copyright is automatic.

## Team / site
- **Pat "Ozzy" Osborne = committed CO-FOUNDER** (biz dev & partnerships; spelling "Osborne").
- **Allison Allred is OUT of Ticklore entirely** (stays on VBRE) — remove any remaining references.
- **about.html — DONE (2026-07-30, commit 6a6fd10 on `main`):** "Founders" heading + Ozzy's co-founder
  card next to Alex's, matching styling; no Allison card existed (already clean).
- Ozzy short bio: "Serial entrepreneur and recovery advocate. CEO of OzzySunSales (solar) and Wizard
  Homes Inc. (recovery housing), and co-founder of Virginia Beach Recovery Events. At Ticklore, Ozzy
  leads partnerships and business development — driven by a servant's heart and a belief in second
  chances."

## Open items
**Near:**
- **Token `ticklore-jul25`:** rotated per Alex — one 10-second confirm in GitHub → Settings →
  Developer settings that the old token is dead, then delete this line.
**Later (or when the trigger nears):**
- **The final contract design pass** (the ⚠️ items) — do it batched whenever the contract is next
  touched; mandatory before any real pilot.
- Lane A **Stripe Connect** build (5% + $0.99 skim + organizer onboarding) — when self-serve demand is real.
- **Rotate the throwaway testnet minter key `0xE6Bc4936F…`** (exposed in an earlier transcript; in
  `showroom-key.txt`) before anything touches real money.
- Attendee wallet-connect on claim (Privy).
- **Privy — ATTENDEE SIDE IN PROGRESS (started 2026-07-31; dormant behind env).** Chosen (Stripe owns
  Privy; free ≤499 MAU → $299 → $499). Vanilla path: `@privy-io/js-sdk-core` bundled once via esbuild
  → `public/privy.js` (rebuild cmd in `privy-entry.js`); server verify via `@privy-io/server-auth`
  (`PrivyClient.verifyAuthToken` → `getUserById` → embedded-wallet address — address always from
  Privy's API, never the client). **Built + tested with fake creds:** claim page swaps to email→OTP
  flow when configured (`sendCode`/`loginWithCode`, hidden wallet iframe, `getAccessToken`), claim
  POST requires the token and mints **to the attendee's own embedded wallet** (`owned:true`,
  address recorded on the claim record); without env, custodial flow is untouched (regression-tested).
  **Gate = ALL THREE env vars or nothing:** `PRIVY_APP_ID`, `PRIVY_CLIENT_ID`, `PRIVY_APP_SECRET`.
  **LIVE + VERIFIED (2026-07-31):** Alex created the Privy app (client `ticklore-web`; domain
  allowlisted; three vars in Render) and ran the first real OTP claim — **ticket #23 (event 17) minted
  into HIS embedded wallet `0x34F66783403C927608F75fFE0acE691BA130F9ea`**, confirmed on-chain
  (`ownerOf` ≠ minter). First truly attendee-owned keepsake in the product's history. OTP bonus:
  claimants now prove email ownership. **Remaining:** `/wallet` PWA login (list YOUR keepsakes —
  weekend work); note dashboard gotchas learned: secret fields are display-masked (use the copy
  button); Render masks too (verify via the eye icon). **Organizer authority via Privy waits for the
  final contract pass** (needs authority reassignment, not in V3).
- **Phase-2 vault** (after freeze; read ADR-001 rev 3 first).

## Guardrails (persist these)
- **Never paste GitHub tokens or private keys into chat.**
- Deploy contracts / hold the key with the **throwaway testnet key only.** The **human** makes all
  Render dashboard env changes.
- Editing loop: change OneDrive clone → commit/push (`feature/ticket-contract` auto-deploys to Render)
  → stage into WSL for forge/node testing → headless Chrome to verify visuals.
- Code session reads this file at session start and updates it at session end; git is the sync.

---
_Consolidated 2026-07-30 from the Code session's live-state log and the web chat's 2026-07-28/29
decision updates. Supersedes both `ticklore-handoff-CANONICAL-2026-07-27*.md` files in Downloads._
