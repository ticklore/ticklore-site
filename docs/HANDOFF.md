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
  - `feature/ticket-contract` → Render → **https://app.ticklore.com** (the actual app: `/shop`,
    `/organize`, `/admin`, `/claim/...`, mint-service). Custom domain live 2026-07-31 (GoDaddy CNAME
    `app` → `ticklore-site.onrender.com`; the onrender URL still works forever, old QR sheets stay
    valid; `PUBLIC_URL=https://app.ticklore.com` so all NEW QRs/links/emails use the real name;
    `app.ticklore.com` added to Privy's Domains tab). 8-point sweep green on the new domain.
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
**THE DESIGN PASS IS DONE — V4 IS THE STANDING FREEZE CANDIDATE (2026-07-31).**
`contracts/src/TickloreTicketV4.sol`, deployed to Base Sepolia at
**`0x31DFbEC3A80700078BDB53403D5ef79e4dC07049`** (owner = minter). **23 forge tests green**;
live-smoked: one event with 2 sponsors + 2 sections + price hidden, two mints each carrying exactly
their own sponsor+section pair, authority handed off and recovered on-chain. Alex's four calls, all
built: (1) per-event `showPrice` (OFF renders nothing — not "$0", not "Free"); (2) **sections
on-chain** (`string[] sections` + per-ticket `sectionRef`, engraved in the old tier slot y=298 —
"Table 7" as memory; seat maps remain not-our-fight); (3) **`transferOrganizer(eventId, new)`** —
organizer primary, owner (Ticklore) recovery fallback, reassign-only, `OrganizerTransferred` event,
agent grants persist; (4) lock-on-first-mint CONFIRMED permanent. `mintTicket` is now 7 args
(`…, sponsorRef, sectionRef`). This also unblocks organizer-authority-via-Privy at the contract
level. Scripts: `DeployV4.s.sol`, `SmokeV4.s.sol`.
**V4 WIRING — DONE + PUSHED DORMANT (2026-07-31, same session).** `lib/ticklore-v4.js` (9-arg
createEvent, 7-arg mint, `transferOrganizer`, `normalizeSections`, retries); server prefers
V4>V3>V2>V1; Lane A form gains a **"show the price on the keepsake"** toggle (default ON); concierge
block rows gain a **Section** field (blocks naming the same section share one on-chain entry — dedup
server-side) + a batch-level price-display toggle; claim codes carry `sectionRef`/`section` and the
sheet groups by sponsor+section+price; claims/redeems mint on the event's OWN contract version.
**Flip-survival:** `/ticket/:id` now probes newest→oldest (`ownerOf`) so keepsakes keep rendering
across flips, and because token ids COLLIDE across versions, every page that knows a token's home
pins it with `?v=N` (wallet cards, claim/door/success pages — threaded end to end). All verified vs
deployed V4: Lane A price-hidden buy, sectioned batch claims (Table 7/Acme/$25 vs VIP/Free), and
V3-token-#1 vs V4-token-#1 resolving correctly by pin. **THE FLIP (Alex's Render action, not done):
ADD `TICKLORE_CONTRACT_V4 = 0x31DFbEC3A80700078BDB53403D5ef79e4dC07049`** (keep all earlier vars;
added, never replaced). Old V3 keepsakes (incl. Alex's owned #23) survive the flip via the version pin.
**Arweave cost — RESEARCHED + RESOLVED (2026-07-31): permanence is cheap; cost is a NON-ISSUE.**
Numbers (July 2026): Arweave is a ONE-TIME payment for 200+ years (endowment model). Protocol rate
≈ 11 AR/GiB with AR ≈ $1.91 → ≈ $21/GiB; Turbo bundler retail ≈ $33/GiB. Per-event reality:
- **Text is effectively FREE** — Turbo uploads under 100 KiB cost nothing, and the permanent core's
  text (event record, story, letters, sponsor credits) is all KB-scale.
- **Lean curated vault** (30 web-optimized photos, ~45MB) ≈ **$1.50–2**. **Generous** (100 photos,
  ~250MB) ≈ **$8–9**. Extreme 1GB ≈ $35. Vs the $750 batch fee: **0.2–1.2% of one Lane B sale.**
  Even a 5× AR price spike keeps a generous vault under ~$45.
- **Payment rail: ArDrive/ar.io Turbo credits bought BY CARD** — Ticklore never holds or trades AR
  tokens (credits are non-tradeable storage credit, pegged to storage power). Clean fit with the
  no-crypto-custody posture.
**Recommendations:** bake a ~$15 permanence allowance into the batch fee; web-optimize photos at
upload (the store's 8MB cap already helps; add resize later); keep VIDEO out of the permanent core
for now (GB-scale each — app-layer only); the real constraint is curation discipline, not cost —
which is already the product's privacy model. With this, **every pre-freeze research item is closed**
— the freeze now waits only on its trigger (first real keepsake / vault deploy).
The original batched items, for the record:
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
4b. **Custody-migration exemption (caught 2026-07-31, NOT in V4):** when a custodial "held for you"
   keepsake's owner signs in, the right move is transferring it into their own wallet — but that's a
   transfer, and the 10-day anti-scalp lock blocks it near the event. The final pass should **exempt
   transfers FROM the platform custody wallet** (giving someone their own ticket isn't scalping).
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

## Vault EXPERIENCE — BUILT (2026-07-31, app layer only; contract still waits for freeze)
Per the two-layer split below, the presentation + submission layer is now real:
- **`lib/vault-store.js` — THE STORAGE SEAM.** JSON store + media dir today; Arweave anchors the
  permanent core behind this same API after the freeze, nothing upstream changes. Entries
  `{type: photo|letter, title, text, credit, media, status}`; **"pending" state already exists** for
  future attendee submissions (today's concierge flow publishes directly — the admin IS the curator,
  which IS the privacy model: curation, not gating).
- **`lib/vault.js`** — public `/vault/:key` (open reads, branded: hero, THE STORY from the event
  blurb, FROM THE NIGHT ITSELF photo gallery with captions/credits, LETTERS & MEMORIES quote cards,
  THE PATRONS OF THIS NIGHT sponsor panel — where sponsor recognition actually lives);
  `/vault-media/:name` (unguessable names, traversal-safe, 8MB cap, png/jpg/webp/gif only);
  `/admin/vault/:key` curation console (ADMIN_PASSWORD; photo upload via file picker → base64,
  letters with title/credit, list + remove) linked from each `/admin` event row ("Vault →").
- Old placeholder vaultPage removed from wallet.js; wallet cards link straight into the real thing.
- Verified end-to-end locally: create event → curate 2 photos + a letter → public page renders all
  sections + sponsors; media serves; wrong password 401; remove works.
- **Render env for persistence (Alex, whenever): `VAULT_STORE=/var/data/vault.json` and
  `VAULT_MEDIA=/var/data/vault-media`** — without them the defaults work but are wiped on redeploy.
- **Attendee submissions — BUILT (2026-07-31, commit c93def1).** "Add your memory" on the public
  vault page: submissions land PENDING; only the curator publishes (curation stays the protection).
  **Open by default** (Alex's call — photos are donations, don't toll-booth generosity) with a
  per-event **"holders-only" toggle** on the concierge form (Privy sign-in + claim record for THIS
  event, verified server-side; form hides if Privy isn't configured). Guardrails: inscription
  moderation on all text (letters checked line-by-line), 6 submissions/hr/IP (attempts count),
  200-pending cap/event, 8MB photos. Submitter name/email ride along for curation (verified flag on
  holders); name auto-becomes the credit. Console: Publish button, pending highlights, awaiting count.
- **Claim receipts — BUILT (2026-07-31).** `email.sendClaimEmail` — after a claim, the attendee gets
  a branded keepsake email ("See your keepsake" + "Open the memory vault" buttons; owned vs held
  copy). Fired AFTER the claim response; mail can never slow or break a claim. Active only when
  `RESEND_API_KEY` is set (same gate as ticket emails; `FROM_EMAIL` override applies).
- Still later: Arweave anchoring (post-freeze; cost RESOLVED — see Money/Arweave section), organizer
  self-serve curation (with organizer accounts).

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
**Small-fry sweep — DONE (2026-08-01):** photo-consent line on the vault submit form; `gas` field in
`/health` ("ok" / "LOW — top up" under 0.0005 ETH / "EMPTY"); square 512×512 PWA icon
(`public/icon-512.png`, brand-ink bg, manifest any+maskable); per-event **claims CSV export**
(`/admin/event/:key/claims.csv`, admin-gated, CSV↓ button in the console) — the organizer's
"who came?" list with code/status/sponsor/price/email/ticket/admitted columns.

**Near:**
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
  claimants now prove email ownership. Dashboard gotchas learned: secret fields are display-masked
  (use the copy button); Render masks too (verify via the eye icon).
  **`/wallet` PWA login — BUILT (2026-07-31):** shared server verify extracted to `lib/privy.js`
  (all-three-or-nothing gate; used by concierge + wallet); `claims.listByOwner` matches by wallet
  address (OWNED, minted to their Privy wallet) or email (custodial "held for you");
  `POST /wallet/tickets` verifies the token server-side and returns the person's keepsakes; the
  wallet page signs in with the same email OTP (session-aware — returning visitors skip the gate),
  renders REAL on-chain art with Yours / Held-for-you / Admitted badges, links each card to its
  event vault (vault route fixed to resolve sponsor events). Privy env is live on Render, so this
  deploy makes `/wallet` real immediately (sample page remains the fallback when unconfigured).
  **Organizer authority via Privy waits for the final contract pass** (needs authority
  reassignment, not in V3).
- **Phase-2 vault** (after freeze; read ADR-001 rev 3 first).

## Gala sales lanes — BUILT (2026-08-01): activation + Stripe-sells-a-code
Both point-of-sale models for real events (all additive; dormant until an event uses them):
- **Seller activation (gift-card model), per-event toggle:** printed cards are born DORMANT; the desk
  activates each at the moment of cash sale via `/activate/:code` (link on the card's own claim page)
  with a **per-event seller PIN** (auto-generated, shown once at create — volunteers never hold the
  admin password). Dormant cards show "Almost yours" and refuse to claim; a photographed card is
  worthless paper. Online codes are always born active (payment IS activation).
- **Stripe-sells-a-code (the card lane):** mark a block **online** at create — its codes are NEVER
  printed. `/buy/:key` is the poster-QR payment page (price from the online block, live remaining
  count) → Stripe checkout → the webhook **allocates one unsold code and emails the claim link**
  (`sendCodeEmail`) — from there the buyer walks the identical claim flow as a cash buyer (mint at
  claim, newest contract, Privy-owned when signed in). Idempotent via the order store (Stripe retries
  can't double-sell); paid-but-sold-out logs a loud REFUND NEEDED and releases the session; `/bought`
  is the "check your email" landing. **No mint in the webhook — the old V1 webhook mint path is
  bypassed entirely for code sales.**
- **TO GO LIVE with card sales (Alex, when the Gala says yes):** set `STRIPE_SECRET_KEY` (+ add a
  webhook endpoint in the Stripe dashboard → `https://app.ticklore.com/webhook`, event
  `checkout.session.completed` → copy its signing secret to `STRIPE_WEBHOOK_SECRET`). Test mode first.
- **The wedding (no money, vault-first): needs NOTHING new** — plain batch, `showPrice` off, open
  vault submissions, guests pour photos in, curate. Ready today.

## Demo buy = the real road (2026-08-01, Alex's catch)
The demo buy used to insta-mint with NO buyer identity (no email anywhere — legacy showroom).
Now a demo "purchase" of any published on-chain event does exactly what a card payment does:
generates a claim code → redirects to the claim page (email or Privy OTP) → mint at claim on the
event's own contract version → buyer's own wallet when signed in → receipt email. The claim page
gained optional **name + inscription fields** (only when the organizer allows; prefilled from the
shop form; ALWAYS moderated at the claim POST before the mint — a rejected line costs a rephrase,
never the claim, and never a mint-cap slot beyond the buy). Seed events (Sullivan/Riverbend, not
on-chain) keep the legacy instant showcase mint on V1. Commit 96a2c91.

## Backups — BUILT (2026-07-31): the custody ledger never has one copy
The off-chain JSON stores ARE the custody ledger (who owns which custodial keepsake, which claim
codes exist, events' on-chain ids, vault entries). `lib/backup.js`:
- **`GET /admin/backup`** (ADMIN_PASSWORD header) — full tar.gz of every store + the vault media dir,
  streamed on demand; a "Download full backup" button lives in the `/admin` console (fetch→blob so
  the password never rides a URL).
- **Nightly email snapshot** — the JSON stores bundled into one self-describing gzipped document,
  mailed to **`BACKUP_EMAIL`** via the existing Resend key; at most once per 20h (marker file on the
  persistent disk survives redeploys); media excluded to stay mail-sized. Degrades gracefully when
  either env is missing. `GET /admin/backup/status` reports coverage + last-send.
- **PRIVACY RULE: backups contain emails + custody records — they go to the admin and nowhere else.
  Never to public/permanent storage (no Arweave for backups).**
- Restore-drilled: archive extracts, custody records verified intact.
- **Alex's env (one line, recommended): `BACKUP_EMAIL=<his email>`** to turn the nightly on.
- Note for future stores: a new JSON store must be added to `storeFiles()` in `lib/backup.js`.

## 🥂 NYE GALA PILOT — CONFIRMED, planning stage (2026-08-01)
**First live pilot: New Year's Eve gala, firm cap 150, general admission.** Selling opens ~November;
the planning committee meets in ~1–2 months — wrinkles ironed out BEFORE that meeting. Full spec:
**`docs/nye-pilot-brief.md`** (from the web-chat planning session; read it before touching pilot code).
- **Two channels, ONE 150-cap pool:** online (Stripe-sells-a-code, built) + ~5–6 volunteer sellers
  with pre-printed claim-code stubs (cash → buyer scans → self-claims; built).
- **Already satisfied from the brief** (spec'd against a stale code copy): random codes (72-bit),
  the "sold" state (= seller activation, dormant→PIN-activate at sale), door check-in engine
  (once-only redeem + ALREADY USED), online channel, CSV reconciliation.
- **NYE build list (genuinely new):** (1) color+number labels per block (`BLUE 07`, restart per
  color, 5×30) on stubs/sheets/CSV/door; (2) issued-to-seller tracking + reallocation; (3) capacity
  dashboard vs the 150 cap (online + claimed + sold-unclaimed + issued-unsold + reserve → true
  remaining, enforced across channels); (4) claim-on-behalf door override (code + email → mint);
  (5) reserve blocks (~10 held back, releasable); (6) door kit upgrades: PIN access (NOT the admin
  password), big green/red result + name/label/timestamp, running count, manual lookup by
  name/label, fast-fail + printable fallback list (wifi will be saturated).
- Pilot posture: flag duplicates, let a human decide — 150 neighbors, low fraud risk.
- Open operational Qs (committee's): gatekeeper for stubs/cash (NOT Alex), ticket price, seller count.
- Build order: Stage 1 = labels + seller/reserve tracking + capacity dashboard; Stage 2 = door kit.

## Testing discipline (learned 2026-08-01, the hard way)
A one-character quote-escape bug in server-rendered inline JS shipped a SyntaxError that silently
killed the entire admin console — routes tested green, page text tested green, but nobody ever
PARSED the page's JavaScript. **Whenever inline `<script>` content in a server-rendered page is
touched, run `scripts/js-syntax-audit.sh` (WSL):** boots the server, renders all 12 pages, extracts
every inline script block, `node --check`s each. Also remember: template literals collapse `\'` to
`'` — prefer data-attributes over quoting values into onclick handlers (the Delete-button pattern).

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
