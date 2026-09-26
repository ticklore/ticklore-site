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

## ❄️ V5 — THE FREEZE CANDIDATE (2026-08-01): built, deployed, wired (dormant)
**`TickloreTicketV5.sol` at `0x508b9F249CC370f54271266123eC2Dfa01D35F8F`** (Base Sepolia, owner=minter).
V5 = V4 + **the custody-delivery exemption**: a transfer FROM the contract owner (platform custody)
is a keepsake ARRIVING at its holder — bypasses the anti-scalp window AND soulbound (a soulbound
keepsake must reach its person; it can never leave them after). Everything else confirmed final.
**27 forge tests green** (V4's 23 + 4 custody). **Live smoke proved the Serenity lifecycle on-chain:**
soulbound custodial mint → delivered inside the window → holder locked forever after
("permanently non-transferable"). Wired: `lib/ticklore-v5.js` (thin — V4's ABI + `transferTicket()`
for future custody→Privy migration), `chainV5` everywhere (server/organizer/concierge/version maps).
Local test: creates land on V5 (`onChainVersion:5`), claims mint + render `?v=5`, V4/V3 keepsakes
survive. **FLIP (Alex): ADD `TICKLORE_CONTRACT_V5=0x508b9F249CC370f54271266123eC2Dfa01D35F8F`.**
**With V5, the contract design pass is COMPLETE — the freeze now awaits only its trigger and the
MAINNET DECISION (open, Alex's): pilots on Base mainnet (true "forever") vs Sepolia. Recommendation
leans mainnet for real keepsakes; brings the production bundle (fresh minter key, real gas, Privy
prod, Resend domain).**

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

## 📊 ORGANIZER DASHBOARD — BUILT (2026-08-02): a window, not a login
`/organizer/:key?t=<orgToken>` — the read-only share link Alex hands the committee chair. Live cards:
**sold/registered · keepsakes claimed · through the door · unsold inventory**, per-channel table
(printed cards / online / registered list — honest about what each channel can know: without desk
activation, print sales are "at the desk"), vault published/awaiting counts, auto-refresh 30s,
phone-friendly. **Counts, NEVER names** — the no-roster rule applies to organizer screens too; zero
attendee identity on the page (verified). Token miss = existence-hiding 404. Every event carries an
`orgToken` (legacy backfilled via `ensureOrgToken`); the **"Live →"** link in each `/admin` event row
opens it (copy the URL from the browser to share; revoke by regenerating the token). This is the NYE
capacity view pulled forward AND the seed of the eventual organizer panel. Wired: `lib/organizer-dash.js`,
mounted in server.js; dashUrl in `/admin/events`. Verified end-to-end: mixed-channel event, activation,
claim (minted on V5 locally), door check-in → all counts exact; token gating; 12-page JS audit clean.

## 🚪 VISIBILITY v2 — BUILT (spec item 1, the pilot blocker) 2026-08-02
The plaque/interior split is live in code. `/vault/:key` now ONLY ever serves the **plaque** (name,
date, venue, sponsor credits, sign-in door, and — for open-submission events — a "leave a memory at
the door" form that lands pending). The **interior** (photos, faces, memories, letters) is served
exclusively by the holder-verified `/view` door, in EVERY state. Three states, **private by default
(fail closed)**: private = slug alone returns an existence-hiding 404, the plaque needs the event's
unguessable `vaultToken` (receipt emails and the wallet carry tokened links automatically); unlisted =
direct link + noindex + generic `<title>`; public = rich head (title/description), **sponsor names as
crawlable text**, no robots-meta (indexable when vaults move to ticklore.com — the app-domain
X-Robots-Tag still covers today). Choosing public triggers the **one-way-door confirmation** in the
admin (deliberate friction, per spec). **Legacy migration fails closed** — pre-v2 records carry no
vaultToken (the tell): old "public" (open interior) → UNLISTED, old "holders" → private; nothing
becomes index-visible without a fresh, confirmed choice. Verified: 404s hide existence, zero interior
leakage in any state, /view gates all three, legacy mapping, admin friction, plaque JS parses.
Queued from the spec: marketing-site SEO items 4–7 (Netlify side) · the `/vault/<organizer>/<event>`
URL structure + slug utility (Option B ratified; builds when vaults move under ticklore.com).

## DECISIONS RATIFIED (Alex, 2026-08-02)
- **URL/slug resolution = OPTION B, RATIFIED.** The chain stores only the immutable eventId (the lot
  number); Ticklore resolves it to the current URL (the county office). Already the built
  architecture — V5 stores zero URLs on-chain. The middle path (Arweave canonical pointer, keyed by
  eventId) bolts onto the VAULT contract post-freeze; the ticket contract never needs touching.
  **The §2 mainnet blocker in docs/vault-urls-privacy-seo.md is CLOSED.**
- **Vault consent authority = ORGANIZER ALONE** (curating on their community's behalf). The attendee-
  say question is settled.

## PRIORITY ORDER (agreed with the project room, 2026-08-02)
1. ✅ **Resend — COMPLETE (2026-08-02).** Domain `ticklore.com` verified (MX/SPF/DKIM at GoDaddy —
   remember: host names WITHOUT the domain suffix there), `RESEND_API_KEY` + `FROM_EMAIL =
   Ticklore <tickets@ticklore.com>` live in Render, `tickets@` aliased to Alex's real mailbox for
   replies. **Proven end-to-end: a roster invite delivered to a real inbox from the real name.**
   Debugging lessons for the log: the live server NEVER had a Resend key before tonight (that was
   every "email didn't arrive" mystery — nothing was ever sent); Resend API keys are visible ONLY at
   creation (copy then, or mint a fresh one); FROM needs `Name <addr>` — brackets without the display
   name are rejected. First impressions with the Serenity community are now protected.
2. **Mainnet production bundle** — new contract deploy on Base mainnet + **the minter key rotation
   carried since July finally closes here** + real gas + Privy production + env swap.
3. **Serenity pitch** — Ozzy's move; machinery is ready.
4. **NYE track** — has until November and is the biggest build; it does NOT jump the queue.

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

## 🔒 PRIVACY & DISCRETION DEFAULTS — REQUIRED for pilot #1 (2026-08-01)
**Both pilots are anonymity-sensitive recovery-community events.** Full spec: `docs/privacy-defaults.md`.
**⚠️ POSITIONING RULE (Alex is firm): NEVER market as "the recovery ticketing platform"** — that
discloses by association. Public language: "privacy-first / discreet." "Recovery friendly" is spoken
only, in-community. These are platform capabilities for ANY event.
The defaults: (1) **first name + last initial** on keepsakes ("Alex W.") — full surname never rendered,
never on-chain; (2) **no public roster, ever**; (3) **neutral on-chain labelling** for sensitive events
(the chain proves the keepsake exists; only the vault says what it was); (4) **gated vault** — photos
AND write-ups visible only to keepsake holders, noindex, no public links; (5) per-event **soulbound**
default ON for sensitive events; (6) **attendee data belongs to the organizer** — never marketed to,
sold, or used (organizer-agreement language; sharpest anti-Eventbrite contrast); (7) photo submissions
reviewed before entering the vault (built).
**BUILT (2026-08-01): S1 names + S2 gated vault + S3 discreet preset.**
- **S1 `lib/names.js`** — "Alex Winfield"→"Alex W." server-side at the mint seam + vault auto-credit;
  conservative rule leaves "Dave & Priya" / "The Sullivan family" untouched. 13 cases green.
- **S2 gated vault** — `vaultVisibility: "public"|"holders"` per event. Holders-gated: the open web
  gets a locked page (event name + date ONLY, noindex/nofollow, zero content, sign-in);
  `POST /vault/:key/view` verifies the Privy token holds a claim record for THIS event and returns the
  full vault HTML (auto-opens for remembered sessions). Verified: no content leak on the locked page,
  401/400 on missing/garbage tokens, public vaults unchanged, inline JS parses.
- **S3 "Discreet event" preset** — one checkbox on `/admin` create sets soulbound + holders-only vault
  viewing AND submissions, with the neutral-name warning in the form. **Verified on-chain: a discreet
  keepsake's transfer reverts "permanently non-transferable."**
- **S4 roster import — BUILT.** `/admin/roster/:key` (admin console rows link it): paste the
  organizer's registration export (tolerates CSV/semicolons/tabs/headers/dupes/junk) + optional
  engraved price → codes on a **"roster" channel** (never printed, born active, email stamped at
  creation). **Idempotent by email per event** — re-pasting an updated list only adds the new people,
  so separate imports per price tier (campers $35 / RV $30 / non-camper $25) and weekly list updates
  are all safe. **"Email the unsent" button** sends claim links in batches of 80, sequential
  (~2/sec), resumable across days (Resend free-tier limits); failures stay queued. `lib/roster.js` +
  `claims.importRoster/listRoster/markEmailed` + `email.sendRosterEmail` (warm, discreet copy: "this
  link is yours alone", no prices/hype). Verified: messy-paste parse, idempotent re-import, live
  Resend pipeline (rejected test domains gracefully, queue intact), roster code claims + engraves its
  price, sheet excludes roster codes, CSV includes them, page JS parses.
- **S5 roster-leak audit — DONE (2026-08-01). The track is complete.** Seeded a distinctive identity
  through the full flow (roster import → claim → mint on a discreet event), then grepped every public
  surface: `/claim`, `/door`, `/activate`, `/ticket` + image, locked `/vault`, `/shop`, `/event`,
  `/wallet` — **zero identity hits on all nine.** Fixed the one real leak found: `/order/:sessionId`
  returned the raw order record including the buyer's email on an unauthenticated poll — now
  whitelisted to `{status, ticketId, custodial}`. All five admin gates re-verified (401s).
- Alex's live check remaining: open a gated vault with his own Privy login (the happy path my tests
  can only deny-side simulate).
Note: gated vaults must also stay OFF the public Arweave permaweb later — they take the ADR's
anticipated private-vault path (server-side holder check), not the public core.

## 🏕️ PILOT #1 = SERENITY ON THE SHORE (Oct 9–11, 2026) — NYE becomes pilot #2
**17th-annual recovery-community campout, First Landing State Park, Virginia Beach.** Ozzy has a part
in it (VBRE warm channel) and carries the pitch — first real co-founder BD test. **The pitch is the
17 years: no permanent record of any of them.**
- **They keep their EXISTING registration** (sotscampout.org). The ask: *"send me the list; everyone
  gets a keepsake"* — low risk to them, and it tests the standalone-vault play for real.
- Registration types (their pricing): Camper $35 pre/$40 on-site · RV $30/$35 · Non-Camper $25/$30.
- **Needs essentially no new machinery beyond the privacy defaults + a ROSTER IMPORT:** paste/upload
  the list (name + email) → codes generate → each camper gets an emailed claim link
  (`sendCodeEmail` exists) → self-claim → keepsake + gated vault. Camp logistics are the park's problem.
- Earlier + smaller + friendlier than the gala; NYE keeps the heavy mechanics (cash sellers, firm 150,
  door kit) as pilot #2.

## ⭐ NORTH-STAR FREEZE CONSTRAINTS (logged 2026-07-31 web chat; verified against V4)
Long-term vision = the universal keepsake wallet (one wallet, a whole life of events, any organizer —
NOT a near-term build; don't pivot, accumulate). What matters NOW: the contract design must not
foreclose it. Verified already satisfied by the V4 design: (a) one person's tickets from many
organizers under one wallet ✅ (ERC-721 ownership + Privy identity); (b) events are first-class objects
creatable with no ticket sale ✅ (`createEvent` is independent); (c) vaults not coupled to payments ✅
(keyed by event). Keep it that way through the final pass. Moderation never delegates to sponsors;
uploads stay gated.

## 🥂 NYE GALA PILOT — now PILOT #2, planning stage (2026-08-01)
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

## Mission Control + organizer-invite tooling (2026-08-04, fd4f980)
`/admin/overview` — founder one-screen: totals (codes/sold/keepsakes/check-ins/awaiting-curation), per-event
table w/ dashboard jump links, system chips (gas both chains, backup age, email readiness), 30s refresh.
Console rows: **Invite 📋** copies the organizer dashboard link; **⟳** revokes + reissues it (old link dies
instantly, new one lands on the clipboard). Organizer flow stays a bearer link — no accounts. Sold math
per channel: activated stubs (or claims when no activation), online allocations, full roster. JS audit
now permanently covers 15 pages.

## 💳 STRIPE CONNECT — BUILT (2026-08-04, a752969), dormant until keys
Alex met the trigger ("must land with them"): card sales run ON the organizer's own Stripe (Connect
Standard, organizer = merchant of record), platform fee 5%+$0.99 (env: TICKLORE_FEE_PCT/
TICKLORE_FEE_FLAT_CENTS, capped at price) peeled at source. No organizer accounts: the "Connect your
Stripe" card rides the bearer-link dashboard -> Stripe OAuth -> we store only stripeAccountId on the
event. Checkout uses {stripeAccount} + application_fee_amount when connected; platform-collect
otherwise. Webhook: account secret first, then STRIPE_WEBHOOK_SECRET_CONNECT (Connect endpoints sign
differently — register BOTH endpoint types in Stripe). TO LIGHT IT (Alex, test mode first): enable
Connect in Stripe dashboard; env: STRIPE_SECRET_KEY, STRIPE_CONNECT_CLIENT_ID (ca_...),
STRIPE_WEBHOOK_SECRET (+_CONNECT). Then dry-run with the 4242 card.

**Stripe env LIVE (2026-08-06, sandbox/test mode):** all four vars planted in Render (sk_test / two distinct whsec — ticklore=account, adventurous-glow=connected / ca_ pending-verify) inside the VBRE sandbox; server detector confirms the engine is live. Redirect URI must be registered in sandbox Connect OAuth settings: https://app.ticklore.com/connect/callback. NEXT: the dress rehearsal — test paid event -> Connect a sandbox account via the dashboard link -> buy with 4242 -> fee split + claim email. Stripe UI notes for the log: webhooks are now "Event destinations" (Add destination), the account-vs-connected choice is called "Event destination scope", and sandbox keys live inside the sandbox (black banner = right universe; acct_1T852XPeeGIX4sbJ = VBRE sandbox fingerprint).

**Sponsor-line clarity (2026-08-08):** admin ALWAYS had sponsors — per-BLOCK (lead-in + name are the first two fields of every Ticket block row; block model = different sponsors per set of tickets). Alex missed it among unlabeled fields → header strip added above block rows. Sponsor line RESTORED to /organize (single event-wide pair) per Alex; **DECISION PARKED: gate-or-remove the /organize sponsor line when true self-serve opens** (it sits behind ORGANIZER_PASSWORD today, so the concierge revenue gate is not yet at risk).

## 🎆 THE NYE GALA IS CONFIRMED (2026-08-08) — TICKLORE'S FIRST REAL EVENT
The committee said YES. Pilot #1 is real: New Year's Eve Gala, Dec 31 2026. This fires the countdown on:
(1) **Door kit** (Stage 2: PIN access not admin-pw, big green/red scan result, running count, manual lookup, printable fallback) — must exist by Dec 31; (2) **claim-on-behalf + reserve blocks** (Stage 1 leftovers; labels/capacity dashboard already built); (3) **THE MAINNET DECISION + production bundle** — real people keeping real keepsakes = the freeze trigger per Alex's own rule (fresh minter key funded and waiting at 0x668e62D9…ecf3); (4) **Stripe LIVE-mode migration** (current setup = sandbox; needs live keys, live Connect client id + redirect URI, live webhook destinations) AND the still-pending **sandbox dress rehearsal** (Connect a test account → 4242 buy → fee split → claim email); (5) gathering the committee's operational answers: final price, seller count, cash/card split, gatekeeper for stubs+cash (NOT Alex), whose Stripe receives card money (they must Connect), sponsor blocks if any.

**Committee answers arriving (2026-08-09).** Much of the operational spec rode in inside the gala page
itself: **$60 · 150 seats · Wyndham Virginia Beach Oceanfront · Oceanfront 12 & 12 · doors 7:00 · Italian
dinner 7:30 · speaker 9:00 · DJ Jrand 10:00 · semi-formal.** Confirmed same day: **the organization is a
registered 501(c)** (subsection TBC — matters only for whether Stripe's discounted nonprofit rate applies,
which is (c)(3)-specific and must be applied for, never automatic). This CLOSES the "whose bank account"
question in the cleanest way: the **entity onboards to Connect with its EIN**, funds land in the
organization's own account, and the **treasurer** is the person who clicks the dashboard link. No
volunteer's personal account, no mingled funds. Unchanged by nonprofit status: Stripe still KYCs a human
**representative** (name/DOB/address/SSN) — tell the treasurer up front so the form isn't a surprise.
Our $3.99 platform fee on a $60 ticket is unaffected either way; a nonprofit rate would only shrink
Stripe's own ~$2.04. **Caution logged: keep tax-deductibility language OFF the gala page** unless their
treasurer/accountant supplies it — a dinner ticket generally isn't deductible in full (the meal has fair
market value). Not Ticklore's call to draft.

**AA marks removed from /gala (2026-08-09, d52b600), permanently.** The Twelve Traditions cut against
lending the AA name or symbol to an outside enterprise and against public-media identification. The logo
slot and its CSS are deleted outright — not hidden behind an `onerror`, so there is nothing to
accidentally restore later. The footer credits the group by its own name only (Oceanfront 12 & 12,
Virginia Beach). **Standing rule for every surface we build for this community: no AA marks, ever.**
Same commit run: the footer's Ticklore mark became a link to ticklore.com (new tab) so a curious buyer
can find out who we are without losing their place mid-purchase (f54e56b). A duplicate `/nyegalavb` page
was staged and then removed — **`/gala` is the one and only Gala page.**

**✅ V5 FLIP DONE (Alex, 2026-08-09) — CONFIRMED LIVE.** `/health` reports
`minting.version: 5` on `0x508b9F249CC370f54271266123eC2Dfa01D35F8F`. The app now mints on the freeze
candidate, so the Stripe rehearsal exercises the same contract generation that goes to mainnet. Still
Base Sepolia (84532); mainnet is the deliberate next step. Also set: `TICKLORE_FEE_PCT=0` +
`TICKLORE_FEE_FLAT_CENTS=0` — **the Gala is a NO-CUT pilot at Alex's call** (see zero-fee commit e8330b7;
`??` not `||`, so a configured 0 survives instead of silently reverting to 5%).

**`/health` now judges the CHAIN THAT MINTS (b436e40).** Gas was read from V1's provider — correct until
V5 moves to mainnet, at which point the same minter address has two balances on two chains and /health
would report "gas: ok" from the wrong one while the wallet paying for the door ran dry. New `minting`
block names version/chain/contract/balance; V1 fields kept for anything watching them, its verdict now
`legacyGas`. Threshold is `MIN_GAS_ETH` (default 0.0005 ≈ 25 mints) — **raise it before the Gala; 150
seats needs more runway than the default warns at.** Mission Control already did this correctly; /health
was the one a monitor polls at 3am, and the one lying.

**💝 GIVING — BUILT (3361834, live).** Two ways: an optional donation on the ticket page (its own line
item on the same payment, presets $25/$50/$100/other, pay button relabels to the total) and standalone
`/donate/:key` for a gift with no ticket. **The trap that shaped it:** any session not tagged `codeSale`
falls through to the legacy mint path, so a naive donation would have minted a real keepsake for someone
who bought no seat — the donation branch now comes FIRST in the webhook and returns. Gifts allocate no
code and never count against the 150. Kept structurally apart from ticket money (separate line item,
`lib/donations.js` + `donations.json` **registered in backups**, own dashboard row, totals split
alone-vs-with-ticket) because a $60 dinner ticket is a quid pro quo and a $20 gift is not — only the org
can say what each means on a receipt. **The donation surface stays DARK until the organizer has connected
Stripe** (enforced in code): otherwise a charitable gift lands in Ticklore's account with the donor's
receipt naming the wrong entity. Platform fee is computed from the ticket price alone; **no fee ever
attaches to a gift.** The thank-you email makes **no deductibility claim** — that letter is the
treasurer's. Alex env when persistence matters: `DONATION_STORE=/var/data/donations.json`.

**Rehearsal script written: `docs/stripe-rehearsal.md` (557ca02).** Every click and expected value for the
sandbox dress rehearsal, grounded in the code. Two things it exists to prevent: (1) rehearse on a
**THROWAWAY event** — `/admin` create writes on-chain and we are still on Sepolia with the mainnet
decision open, so the REAL Gala event waits (and the two `#` buy buttons on /gala stay parked until it
exists); (2) register **BOTH** webhook destinations — a connected-account sale fires on the connected
account, so without that scope Stripe never sends the event, the payment succeeds, and no claim email
arrives. That failure impersonates a broken email pipeline and will cost an hour in Resend for nothing.

## 🎟️ THE BRAND LOCKUP — REBUILT (2026-08-13, a6208b6 + 323b6a5 + 22b6f0e, both sites live)
New mark from Alex (gold notched ticket, dark green field, four-point star, gold-and-sage heart) ships as
**vector** and the words are **live type** — the old logo was one baked PNG carrying mark, wordmark and
tagline together. `TICK` in the sage sampled from the heart, `LORE` in the gold from the frame.
Marketing site went **893KB → 19KB** (index) and **891KB → 17KB** (about): the bulk was a base64 picture
of the word "Ticklore", pasted inline twice per file. Icons all regenerated from the same vector.

**⚠️ THE LOCKUP LIVES IN TWO PLACES — a font or colour change means BOTH branches.** They are not shared:
- **App** (`feature/ticket-contract`): `brandLockup()` in `mint-service/lib/ui.js` is the single source for
  all five surfaces (site nav, shop nav, organizer, wallet header, payment gate). `LOCKUP_CSS` and
  `LOCKUP_FONT_LINK` are exported because the wallet, payment gate and organizer carry their own
  stylesheets and don't get `BASE_CSS`.
- **Marketing** (`main`): the same CSS is **inlined** in `index.html` and `about.html`. No build step, no
  shared lib — it is a copy, and it will drift the first time only one side is edited.

**CURRENT (2026-08-13, settled after three iterations in one evening):** symbol = the **green-and-gold**
ticket (`logo-mark.svg`, 72,123 bytes — a finer-stroked gold-on-teal alternative was tried and reverted
because it dissolved at nav and favicon size; **a logo that only works large fails in a browser tab**).
Wordmark = **Outfit Light** (Option 5 of six explored), `TICK` in ivory `#F1E9DD`, `LORE` in `#F1C765`
**sampled from the mark itself** — retune this whenever the symbol changes or the word and the ticket end
up as two nearly-identical golds. Tagline = Outfit 300, uppercase, `rgba(241,233,221,.5)`.

**The tagline centring, because it will look like a nudge and isn't:** letter-spacing adds its gap AFTER
the final letter, so every line's box is wider than its ink. Centring boxes of unequal overhang puts the
lines out of true — and an earlier `text-indent` patch failed precisely because the word and tagline
track differently and so compensated by different amounts. Each line now cancels its own trailing space
with a **negative margin equal to its letter-spacing**, so boxes match ink and `align-items:center` on
`.lockup__words` is honest. Keep that pairing if you change tracking.

**To change the wordmark font:** the family in `LOCKUP_FONT_LINK` *and* `.lockup__word`'s `font-family`.
**To change colours:** `.lockup__tick` / `.lockup__lore` / `.lockup__tag` — plus the same rules in main's
inlined copy. Icons only need regenerating when the **symbol** changes, never the wordmark
(`scratchpad/icons.ps1` does all six from one SVG; re-create it if gone — Chrome headless at each size,
transparent for tab/PWA-any, opaque for Apple and the Android maskable safe zone).

**⚠️ THE KEEPSAKE DOES NOT SHARE ANY OF THIS.** `TickloreTicketV5.sol` renders its own wordmark on-chain —
`<text font-family="monospace" letter-spacing="7">TICKLORE</text>` plus `EVERY TICKET HAS A STORY` — so
the site says Outfit Light and the keepsake in someone's wallet says monospace. That is Solidity, frozen
at deploy, permanent for every keepsake that contract ever mints. **Today it costs nothing (testnet, no
real holders). It becomes unfixable at the mainnet deploy, which is queued right before the Gala.** If the
two should agree, that edit rides along with the mainnet contract at no extra cost — but only if it
happens BEFORE. Alex has been offered a side-by-side render of on-chain art vs the new brand; not yet done.

Sizing scales off one `--lk` variable per placement. **Gotcha, learned the hard way:** the markup sets
`--lk` INLINE, so a stylesheet rule like `.hero-card .lockup{--lk:52px}` silently loses to it — change the
markup's size, not a CSS rule. (There is a now-inert `.wal__brand .lockup{--lk:38px}` in `wallet.js` for
the same reason; harmless, the inline 44px wins.)

Three traps handled rather than discovered later: the wordmark clips a gradient to text, which paints
**nothing** where unsupported and would erase the name — solid-colour fallback added. Screen greens wash
out on parchment, so `lockup--light` carries deeper ink for the **printed QR sheet**. And the PWA manifest
served one transparent file as both `any` and `maskable`; Android crops maskable icons to a shape, so
there is now a separate `icon-512-maskable.png` with an opaque field and the mark inside the safe zone
(Apple's is opaque too — iOS composites transparency onto black). `favicon.ico` is a real ICO
(PNG-in-ICO), verified by parsing it back as a 32×32 icon.

Left alone deliberately: `ticklore_logo_oncard.png` on `main` is now unreferenced (240KB) but not deleted;
and the marketing nav links render underlined, which predates this work.

**Alex intends to change the wordmark font and colour later** — that is now a text/CSS edit in the two
places above, not a re-export of artwork. That was the point of doing it this way.

**WORDMARK SETTLED (2026-08-14):** six options were rendered against the symbol; Alex chose **Outfit
Light**, `TICK` ivory + `LORE` in the mark's own gold. The tagline centring is typographic, not a nudge —
letter-spacing puts its gap AFTER the last letter, so each line cancels its own trailing space with a
negative margin equal to its tracking, and only then is `align-items:center` honest (a `text-indent`
patch failed first because the two lines track differently). Also tried and REVERTED: a finer-stroked
gold-on-teal symbol — it dissolved at nav and favicon size. **A logo that only works large fails in a
browser tab.**

## 🚪 DOOR PIN — BUILT (2026-08-14, 44cd4db). The Gala's hard blocker, cleared.
The door was gated by `ADMIN_PASSWORD` — the password that opens the console, every other event, the
claim codes, the custody ledger and the backups. On Dec 31 it would have been read aloud to a volunteer at
a folding table. Every event with redemption on now carries a **six-digit door PIN** (minted like the
seller PIN; shown on the create result and the `/admin` row). `events.ensureDoorPin()` mints on read, so
events created before this — and events that gain a door later — are covered, with no second step to
forget on the day. **The PIN is checked only AFTER the event is resolved**, because it is per-event: one
door's PIN must never open another. ADMIN_PASSWORD still works as a fallback so Alex is never locked out
of his own door. The door page remembers the PIN per event on the device (a door scans one guest per page
load; retyping a secret for every person is how a queue forms), forgets it instantly if refused, and never
admits automatically on load — a human should be looking at the person in front of them. **Verified live:
keepsake #6 carries the permanent ADMITTED stamp.**

## 6 V6 — DEPLOYED + WIRED + FLIPPED (2026-08-14, e4033af / e79ab9b / d8d4abb)
`TickloreTicketV6.sol` at **`0xf37b6564c64a13ace20c8227fc71f5d058fe221e`** (Base Sepolia, owner = minter),
**29 forge tests** (V5's 27 plus two pinning the art). V6 = V5 + TYPOGRAPHY: ABI, storage and behaviour
are byte-for-byte V5's. It earns a version because **the keepsake renders its own wordmark in Solidity and
that freezes at deploy** — the site had moved to a light sans while the keepsake still said TICKLORE in
monospace, so the two things a guest sees wore different brands. Fixed while the art was open: the
tagline's baseline sat 4px from the frame (price/# now y=452, tagline y=472).
**An on-chain SVG can only NAME a font — the viewer's device supplies it.** V6 picks a CATEGORY, not a
typeface, and renders differently on Mac/PC/Android; embedding a font would cost more than the rest of the
contract. `TICKLORE_CONTRACT_V6` is set and `/health` reports `minting.version: 6`.
`lib/ticklore-v6.js` is thin (re-exports V5, own connect, `TICKLORE_RPC_V6`).
**Bug caught while wiring:** `/admin/overview` computed the newest chain then read `chainV5` for the
balance — with V6 alone that is a null dereference, and the casualty is the gas chip that warns the minter
is running dry. **Deploys need the `tickloreDeployer` keystore password (Alex's alone). July's was lost
and re-imported as `tickloreDeployer2` — WRITE THE MAINNET ONE DOWN.**

## 💳 CARD LANE — two fixes (2026-08-14, 72ada23 + de3a37e)
**It was invisible, not missing.** A block marked `online` always created a real Stripe page at
`/buy/<key>`, but the admin console linked to Codes/Vault/Roster/Live/Invite and never to it — so "the
organizer panel takes cards and the admin panel doesn't" was really "the feature exists and cannot be
found." Rows with an online block now carry a **Buy page** link; events without one say so, and say to
tick `online`.
**MULTI-TICKET (de3a37e):** people bring dates and families, and one seat per checkout sends a couple
through the card form twice. Quantity picker offers `min(10, remaining)`; the server clamps it (never
trust the browser with how many seats to sell); the fee scales per ticket.
`claims.allocateOnlineBatch()` takes N codes in ONE read/write — N separate calls would each re-read the
file, and two orders landing together could double-sell a code. **Each ticket stays its own keepsake**:
the email sends one link per ticket and says to forward one per guest, so a date holds a keepsake in their
own name rather than a screenshot of someone else's. A **partial fill** still delivers the real tickets
and logs the shortfall as loudly as a total failure, because a human has to refund it.

**OTP errors stopped blaming the guest (90d1577).** "That code did not verify" was one catch wrapped
around the whole sign-in — the code check, the wallet, the token, the claim request — so any downstream
failure told the guest their code was wrong. Verification now stands alone: a genuinely bad code names the
two real causes (use the NEWEST email, since another send voids the last; try a private window, because
stale Privy localStorage returns 422 on a good code — a dev-machine problem real guests do not have), and
anything failing after sign-in says so and says the code was fine.

## 🗓️ THE RUN-IN (Alex, 2026-08-14): ~6 WEEKS UNTIL TICKETS GO ON SALE
Critical path in dependency order. **Mainnet must precede the real Gala event** — the first keepsake a
real person keeps is the freeze trigger, and that is Alex's own rule.
1. **Mainnet bundle** — V6 to Base mainnet · fresh minter key (`0x668e62D9…ecf3`, funded) · the July key
   rotation finally closes · Privy production · `TICKLORE_CONTRACT_V6` + `TICKLORE_RPC_V6` = mainnet while
   `RPC_URL` stays Sepolia so every earlier keepsake keeps rendering · raise `MIN_GAS_ETH` above a
   150-mint runway.
2. **Stripe live migration** — live keys, live Connect client id + redirect URI, BOTH live webhook
   destinations. Then rung 2 of `docs/stripe-rehearsal.md`: a $1 event on a second Stripe account, real
   card, real payout, so Alex walks the treasurer's onboarding before asking her to.
3. **Create the real Gala event** → wire the THREE placeholder links on `/gala` (two buy, one donate).
4. **Manual code-entry page** — `/gala` promises "enter it here" and no such box exists; a guest with a
   dead camera or a torn stub has no way in. Same build as the door kit's "manual lookup".
5. **Door kit polish** — big green/red result, running check-in count, lookup by name/label, printable
   fallback for saturated venue wifi.
6. Claim-on-behalf at the door, reserve blocks (~10 held back).

**Env still outstanding: `DONATION_STORE=/var/data/donations.json`** (gifts otherwise sit on ephemeral
disk and vanish on redeploy) and **`MIN_GAS_ETH`**.

## 🌐 MAINNET — LIVE (2026-08-17). Ticklore mints on a real chain.
`TickloreTicketV6` deployed to **Base mainnet** at **`0xA0925c3912e4dFddEAd6328778665D4074cd1A6E`**
(chain 8453, owner = minter). Deploy cost **$0.06**; the smoke run (an event + two keepsakes) cost under
half a cent. Base gas is ~0.006 gwei, so all 150 Gala mints together are roughly **$0.50** — the wallet
holds ~$30 and that is years of runway.

**Fresh minter `0x87455A2927f8cEc6641b78fEb598D862E1Ff6584`.** The July key rotation finally closes: the
old exposed `0xE6Bc4936F…` is retired from the write path. Keystore is `tickloreMainnet` — **its password
is Alex's alone and there is no recovery; write it down somewhere findable on December 30.** (July's
`tickloreDeployer` password was lost and had to be re-imported as `tickloreDeployer2`. On mainnet that
loss would be a different kind of day.)

**Env shape (deliberate):** `TICKLORE_CONTRACT_V6` + `TICKLORE_RPC_V6` point at mainnet while `RPC_URL`
stays on **Sepolia** — so `/health` stays green and every earlier keepsake keeps rendering. Per-version
RPC was built for exactly this. `/health` reports `minting.chainId: 8453`.

**`legacyGas: "EMPTY — mints will fail"` is CORRECT and not an alarm:** the new minter holds no *Sepolia*
ETH. The headline `gas` reads the chain that actually mints. This is the 2026-08-14 /health fix earning
its keep on day one — before it, the top-level gas indicator would have screamed EMPTY while the real
wallet sat funded.

**Consequence, by design:** Sepolia events are now **read-only**. They render forever; they cannot be
claimed or door-redeemed, because those contracts are owned by the retired key. Every one of them is a test.

## 🛑 NEVER CHARGE FOR AN UNMINTABLE KEEPSAKE (7aca0d0)
Found the hard way: a test purchase returned "issuing the ticket hit a snag." The page was honest — the
shop held only seed events, seeds mint on V1/Sepolia, and the minter had moved to mainnet that morning.
In sandbox that costs nothing; **in live mode a stranger is charged real money for a keepsake that cannot
exist**, on the first weekend cards work. Two fixes: seeds left the storefront (`SHOW_SEED_EVENTS=true`
restores them; their data stays so old seed tickets render), and **both** card lanes now ask the CHAIN —
`organizerOf(eventId)` vs the signing wallet — before creating a Stripe session. Fails closed on any
error. The `/buy` lane needed it just as badly: a stranded event there fails at CLAIM, after the buyer
walked away believing they held a ticket.

## 🖼️ THE VAULT OPENS ON A PHOTOGRAPH (4e00382)
It was a headline followed by a wall of grey slabs — every feature already present (header, lightbox,
chronological order), no rhythm. Now: the cover photo is a full-bleed darkened hero (curator's `cover`
flag, else the first photo; it stays in the gallery too), three columns instead of two on a 1040px frame
with prose re-narrowed to 64ch, the lightbox became a real gallery (arrows, keyboard, swipe, counter,
wrap-around), and the section says how many photographs there are. **Not built:** a "make this the cover"
button in the curator console — wait until real photos are in there.

## 💳 STRIPE: TICKLORE LLC, AND OAUTH IS GONE (ad75ee9)
**The platform account moved off VBRE.** Alex registered Ticklore, LLC (EIN in hand, business bank
pending) and wants **zero** connection to VBRE. Guests never saw VBRE — with direct charges the buyer's
statement shows the CONNECTED account — but the **treasurer** would have, on the authorization screen.
New Stripe account created under Ticklore, LLC, signed up with a ticklore.com address (not alex@vbre.org).
Sandbox for now; live waits on the bank, which only gates payouts. **Hard rule: the treasurer must connect
to the FINAL platform** — Connect authorizations are granted to one account, so connecting her to VBRE
would mean asking her to disconnect and redo it.

**Stripe no longer offers OAuth to new platforms.** The new account's Connect settings have no Integration
section, no redirect list, no client id — the hand-built authorize URL would have dead-ended on the
treasurer's first click. Rewritten to **Account Links**: we create the account object, Stripe hosts every
screen, an existing Stripe account can be signed into and attached, and an abandoned form resumes. The
return URL is passed in the API call, so **`STRIPE_CONNECT_CLIENT_ID` is no longer needed at all.**

**The subtle rule, and the one to not break:** onboarding creates the account BEFORE it can take money,
and `stripeAccountId` is read app-wide as "this event's money lands here" (routes checkout, unlocks
donations, lights the badge). So a new account parks in `stripePendingAccountId` and is promoted **only**
when Stripe reports `charges_enabled`. Submitted-but-under-review is common on a new nonprofit account
and gets its own page — not a failure, not finished. Old `/connect/callback` still answers with an
explanation so pre-change links don't 404.

**Also written: `docs/organizer-stripe-walkthrough.md`** — what to say to a committee treasurer, what to
gather first, and the two moments that alarm people (Stripe asks a real person for their SSN even on a
nonprofit account; the first payout takes 7–14 days, not two).

## ⏭️ WHERE IT STOPS (2026-08-17)
**Half-migrated on purpose, safe because it's sandbox and nothing is selling.** `STRIPE_SECRET_KEY` is
Ticklore's; the two webhook secrets still point at VBRE. **Next action: put the two `whsec_…` from the
Ticklore sandbox destinations (`ticklore-account`, `ticklore-connected`) into `STRIPE_WEBHOOK_SECRET` and
`STRIPE_WEBHOOK_SECRET_CONNECT`.** Order between them does not matter — the handler tries one, then the
other. Until then a purchase would charge and never issue a ticket, so **do not test a purchase yet.**

Then: the mainnet test event end-to-end (create in /admin with redemption on → /buy → 4242 → claim →
wallet → vault → door PIN), a test connected account through the new Account Links flow, Stripe live-mode
when the bank lands, and only then the REAL Gala event — because that one's keepsakes are forever.

**Still outstanding:** `DONATION_STORE=/var/data/donations.json`, `MIN_GAS_ETH` (raise above a 150-mint
runway), the manual code-entry page `/gala` already promises, and the Stage 2 door-kit polish.

## 🏦 THE LLC, THE BANK, AND ONE MISSING LETTER (2026-08-29)
**Ticklore, LLC is registered, the EIN is in hand, and a business bank account is open.** The
**Ticklore, LLC Stripe account exists in LIVE mode** under the login `alex@ticklore.com`. That is the
final platform. The treasurer connects to that account and no other.

**⚠️ THE TWO-LOGINS TRAP — the thing that cost an entire evening.** Stripe shows a login only the
accounts that login is a member of, and there is nothing anywhere saying "you also have an account under
a different email." `alex@ticklore.com` sees **only Ticklore, LLC**. `alex@vbre.org` sees **only VBRE**.
The phone app was signed in as `alex@vbre.org`, so it could never display Ticklore, and its VBRE
"complete your account" banner read as evidence that something had been set up on the wrong entity.
Nothing had. **The only reliable orientation check is the header: the account name, plus whether a
`sandbox` badge is present.** Sandbox and live wear the same name — a screenshot of the account name
alone does not tell you which world you are in.

**ROOT CAUSE: the Stripe account email was `alex@tickore.com`** — missing the `l`. Every verification
link Stripe "sent" went to a domain that does not exist. Confirmed by DNS: `tickore.com` returns
NXDOMAIN for A, MX and NS — never registered — so the mail bounced into nothing and **no third party
received anything**. Corrected to `alex@ticklore.com`. Stripe reported a green "we sent it" every time,
which is why this presented as an account/entity problem for hours instead of a typo.

**Ticklore's EIN was NEVER entered on VBRE.** VBRE's own outstanding-requirements list still names
**Tax ID** as missing — Stripe reporting the absence directly. The expensive mistake (Ticklore's tax
identity on VBRE, with 1099-K consequences) did not happen. The license photo + selfie that *was*
submitted verifies the **natural person**, who is the representative of both entities — harmless
wherever it landed.

**Rule, permanent:** VBRE's banner asks for **VBRE's own** EIN. Never feed it Ticklore's to silence it.

**ticklore.com mail = Microsoft 365, provisioned through GoDaddy.** MX →
`ticklore-com.mail.protection.outlook.com`; NS → `ns75/ns76.domaincontrol.com`; tenant
`NETORGFT20987801.onmicrosoft.com`. **If Stripe mail goes missing again, check the M365 quarantine**
(`security.microsoft.com/quarantine`) before anything else — it holds mail that appears in neither Inbox
nor Junk.

**⚠️ SPF, unverified, check before the Gala:** the record is `v=spf1 include:secureserver.net -all` while
mail runs on M365. That *may* be correct for a GoDaddy-sold tenant, but it was not confirmed. A wrong
`-all` hard fail sends **guest ticket emails to spam** — verify deliberately, not on Gala night.

**Open from this session:** (1) which account the bank account landed on — inert either way, a payout
account only receives, and the same bank can attach to multiple Stripe accounts; (2) whether Ticklore
business details were also entered on VBRE (read `settings/business` on the VBRE login: legal name +
tax ID) — worth doing before VBRE's review completes, since entity details harden afterward;
(3) whether to close VBRE's Stripe account outright, which would delete this whole class of confusion.

**Unchanged blocker:** still two webhook secrets short of a working card lane. See WHERE IT STOPS above.

## ✅ THE ENTITY TRACK IS CLOSED (2026-08-29)
**Ticklore, LLC is fully activated in Stripe live mode** — Account status shows **no active tasks**.
Completed: tax ID (verified), business address, account representative (George Winfield), and the
representative's ID number. The license-and-selfie verification landed **on Ticklore, not VBRE**,
answering the open question from the night before.

**Legal name on file is the IRS single-member-LLC form: `TICKLORE GEORGE ALEX WINFIELD SOLE MBR`.**
That field must match the SS-4 / 147C letter exactly, capitalization and punctuation included — it is
not the same string as the Stripe account's display name ("Ticklore, LLC"), and that is correct.

**Bank: Mercury** (partner bank Column N.A.), USD, attached as the **default** payout account for the
payments balance and also listed under Treasury. Stripe does not gate activation on it — a bank gates
**payouts, not charges**.

**Consequence, and worth staying deliberate about:** this account can take **real money now**. The only
thing holding the app in sandbox is which keys sit in Render. Going live is a smaller and more
accidental-feeling step than it ought to be.

**Note:** business details are **live-mode only**. A blank tax ID in the sandbox business settings is
correct and expected, not a missing step — sandbox has a fictional, pre-activated profile.

## 💳 THE CARD LANE IS ALIVE (2026-08-29)
Both sandbox webhook secrets are in Render. Destination `ticklore-account` is Active, endpoint
`https://app.ticklore.com/webhook`, listening to `checkout.session.completed` — which is the only event
type the app handles (`stripe-routes.js:126`). Connected-account promotion is **not** webhook-driven;
`connect.js:109` polls Stripe for `charges_enabled` on demand.

**⚠️ THE MANAGED PAYMENTS TRAP (fixed in `1a02be7`).** The new Ticklore account has **Managed Payments
enabled by default** — the old VBRE platform predates it — and Managed Payments **rejects
`payment_method_types` outright**. Every checkout session died with "Unsupported parameter" before a card
could be entered. This had nothing to do with the webhook secrets and would have surfaced on the first
real sale. **Deleting the parameter is the obvious fix and the wrong one:** naming the type explicitly is
what keeps **Stripe Link** out of the buy flow, a deliberate "no wallet, no fuss" decision, and Link also
blocks testing. All three sessions (demo buy, Gala block lane, donation lane) now pass
`managed_payments: { enabled: false }` per request and keep card-only.

**FIRST REAL CARD PURCHASE → MAINNET MINT.** The mainnet minter balance moved
`0.015471346765226053` → `0.015467774606715619`: **~0.0000036 ETH, about a penny, for one keepsake.**
That is the real per-mint gas number to plan the Gala against.

## ⏭️ GOING LIVE — the part that will bite
**Nothing wired so far carries over.** Sandbox and live are separate worlds of credentials:
- `STRIPE_SECRET_KEY` is a sandbox key; live needs the `sk_live_…` one.
- The two `whsec_…` are **sandbox** secrets. Live mode needs **two new destinations created from
  scratch** (`ticklore-account`, `ticklore-connected` do not exist there), each with its own secret.
- **One set of env vars means one mode at a time** — flipping to live ends sandbox testing.
- Managed Payments is per-account **and per-mode**: verify the opt-out holds in live rather than assuming.

**Order:** finish the walk (claim → wallet → vault → door PIN) → live wiring in one deliberate pass →
a small live test with a real card on an obviously disposable event, then refund → only then the Gala.

**Deferred:** Stripe **custom domains** (paid, needs GoDaddy DNS work alongside the unresolved SPF
question, and it is unclear the platform's domain even applies to a direct-charge checkout on a connected
account). The **Branding** tab is the free version of that win — logo and colors on the checkout page —
and should be done instead.

## ✅ THE WALK IS PROVEN (2026-08-29)
**Card → mint → claim → wallet → vault → door, end to end, on a real Base mainnet keepsake under the
Ticklore, LLC entity.** Wallet shows the right event, buyer name and inscription; the vault opens on its
cover photograph with the gallery working; the door flipped to **Admitted ✓** and re-rendered the ticket
art with the on-chain stamp; and **a second redemption of the same code was refused.** Redemption is a
flag, never a burn, so the keepsake survives being used.

**⚠️ DOOR-KIT NOTE, learned by tripping over it.** `/door/:code` takes the **CLAIM CODE**. The **door PIN
is also a 6-digit number** (`events.js:88` — `crypto.randomInt(100000, 1000000)`), so it looks exactly
like something that belongs in that URL, and typing it there returns a dead page with no useful error.
**Staff should always reach the door through the keepsake's own "Door check-in →" link**, which carries
the correct code — never by typing a URL. Put this in the door-kit instructions before handing a folding
table to a volunteer.

**Next milestone: a test connected account through the Account Links flow.** It has never been exercised,
and the treasurer effectively gets one shot — Connect authorizations are granted to a single account, so
she must connect to the final platform the first time. After that, the live wiring pass.

## 📅 START HERE — SATURDAY 2026-09-05
Work paused the evening of 2026-08-29 with everything pushed and both branches level with origin.
Nothing is time-critical; the Gala is roughly six weeks out and the product spine is proven.

**Do these in order. The first two are the ones that must not be done tired.**

1. **Test connected account through Account Links.** Never exercised, and it is the path the Gala's
   treasurer walks exactly once — Connect authorizations bind to a single account, so she must land on
   the final platform the first time. Watch the promotion rule specifically: a new account parks in
   `stripePendingAccountId` and is promoted to `stripeAccountId` **only** when Stripe reports
   `charges_enabled` (`connect.js:109`, polled on demand — this is NOT webhook-driven). Confirm that
   submitted-but-under-review gets its own page and is not treated as an account that can take money.
2. **Verify SPF before any guest email goes out.** `ticklore.com` publishes
   `v=spf1 include:secureserver.net -all` while mail runs on Microsoft 365 (GoDaddy-provisioned tenant).
   That may be correct for a GoDaddy M365 setup — it was never confirmed. A wrong `-all` hard fail puts
   **guest ticket emails in spam**, which is a Gala-night failure discovered at the worst moment.
3. **The live wiring pass**, in one sitting. See GOING LIVE above — new `sk_live_` key, two brand-new
   live webhook destinations with their own secrets, and re-verify the Managed Payments opt-out holds in
   live. Remember: one set of env vars means one mode at a time, so this ends sandbox testing.
4. **Then a small live test** — real card, smallest amount, obviously disposable event, refund after.
   Only then the real Gala event, because those keepsakes are permanent.

**Leftovers, none blocking:** `DONATION_STORE=/var/data/donations.json`, `MIN_GAS_ETH` raised above a
150-mint runway, the manual code-entry page `/gala` already promises, and Stage 2 door-kit polish.
Also worth adding to the door kit: staff reach the door through the keepsake's own link, never by
typing a URL (see the door-kit note above).

**Do NOT redo:** the entity track is closed (EIN verified, Mercury attached, no outstanding Stripe
tasks), the card lane works, and the full walk — card → mint → claim → wallet → vault → door — is proven
on Base mainnet. The marketing site's hero is fixed and its text encoding is repaired.

## ✉️ EMAIL IS SOUND — VERIFIED BY DNS (2026-09-04). Do not re-open this.
**The root SPF is CORRECT. Do not "fix" it.** `ticklore.com` publishes `v=spf1 include:secureserver.net
-all`, which looked wrong against Microsoft 365 but resolves correctly: `secureserver.net` →
`include:spf-0.secureserver.net` → that record ends with `include:spf.protection.outlook.com -all`.
GoDaddy chains their include to Microsoft's. Three lookups deep, well inside SPF's limit of ten. Alex's
own mail from the M365 mailbox passes. **The earlier flag in this doc is resolved — no change needed.**

**Guest ticket email does not go through M365 at all — it goes through Resend** (`lib/email.js`, which
falls back to `Ticklore <onboarding@resend.dev>` if `FROM_EMAIL` is unset). That fallback never fires:
**`FROM_EMAIL` is set on Render and the domain is verified in Resend.** The verification records are all
live — `send.ticklore.com` TXT `v=spf1 include:amazonses.com ~all`, `send.ticklore.com` MX
`feedback-smtp.us-east-1.amazonses.com`, and DKIM at `resend._domainkey.ticklore.com`. Guests receive
their keepsake from **`tickets@ticklore.com`**.

Note the shape, because it is why the root SPF never needed touching: Resend puts its SPF and bounce MX
on the **`send.` subdomain** even when the root domain is the verified sender. The root's M365 records
are untouched by design.

**DMARC is present and passing on both counts:** `p=quarantine; adkim=r; aspf=r`. DKIM signs as
`d=ticklore.com` so it aligns exactly; the envelope sender at `send.ticklore.com` aligns with the root
under relaxed policy. Deliverability posture is better than most production setups.

**Only loose thread, optional:** `rua=mailto:dmarc_rua@onsecureserver.net` is GoDaddy's default, so DMARC
aggregate reports go to GoDaddy and Alex never sees them. Point it at a real mailbox if visibility into
authentication failures is ever wanted. Not a blocker.

## 🔌 CONNECT WORKS — AND ACCOUNTS V1 IS A DASHBOARD TOGGLE (2026-09-04)
The Account Links flow was exercised end to end for the first time, on a sandbox test account
(`the-clay-birds-magical-extravaganza-pjnho`).

**⚠️ THE BLOCKER, AND THE THING MOST LIKELY TO BITE AGAIN.** `stripe.accounts.create` failed with
*"Stripe no longer recommends Accounts v1 for new Connect integrations."* **New platform accounts are
Accounts v2 by default**, and this code creates accounts the v1 way — as every existing Stripe platform
does. Fixed with **one dashboard toggle, no code change**:
`dashboard.stripe.com/settings/features/feat_accounts_v1_support`.

**BEFORE THE TREASURER ONBOARDS, CHECK WHETHER THAT TOGGLE IS PER-MODE.** If live mode needs it enabled
separately, her onboarding fails at the first click and she is left holding a broken link. Verify during
the live wiring pass, not in front of her.

**Decision: stay on Accounts v1 through the Gala.** The whole Connect flow — Account Links, the
pending-vs-promoted rule, the return page, abandonment reuse — is written and reasoned against v1 and it
works. Migrating to `POST /v2/core/accounts` five weeks out buys nothing that is needed. **Accounts v2 is
a post-Gala project.**

**THE PENDING PAGE IS CORRECT — verified, not assumed.** Stripe returned `details_submitted=true` with
`charges_enabled=false`, and the app showed *"Almost there — Stripe has your details and is reviewing
them… card sales switch on by themselves once they're satisfied"* with a Check again button. It did
**not** show a Connect button implying she never finished. That is the single screen most likely to make
a volunteer treasurer redo completed work, and it holds.

**Still unverified (the flag simply had not flipped yet):** promotion of `stripePendingAccountId` →
`stripeAccountId` on `charges_enabled`, that card sales are genuinely off while pending, and that a
purchase on a connected event routes to the connected account rather than the platform balance.

**PATTERN — the fresh Ticklore account keeps differing from VBRE.** Four so far: OAuth not offered
(→ Account Links), webhook secrets did not carry, Managed Payments on by default, Accounts v1 off by
default. **Expect at least one more during the live wiring pass.** Each surfaces only on first contact.

**Before the real onboarding:** `/gala` (`public/gala.html`) is a valid business URL for her Stripe
form — it already states what is sold, the price, the date and the venue. It lacks the two other things
reviewers look for: **contact information** and a **refund / ticket policy** line. Adding both is a small
edit that removes the most common reason a connected account sticks in review.

**Housekeeping:** `render.yaml` is stale. It describes a showroom with no Stripe, no Resend and a
throwaway testnet wallet, explicitly listing `STRIPE_SECRET_KEY` and `RESEND_API_KEY` as deliberately
unset. Production diverged long ago and lives in the Render dashboard (service `ticklore-site`). A future
session reading that file would form a badly wrong picture.

---

# 🚨 ACCOUNT MIGRATION — 2026-09-25/26
## Everything earlier in this document that says `weldingcrypto` is STALE. Read this section first.

**What happened.** The founder's email `alex@vbre.org` was handed to another party at short notice,
with no grace period. GitHub had force-enabled 2FA on the account `weldingcrypto` on 2026-09-01 using
an authenticator that could not be produced, and GitHub's recovery runs through that dying mailbox.
So **the GitHub account `weldingcrypto` is presumed permanently lost.** Everything was migrated.

## Where the code lives now
- **Canonical remote: `https://github.com/ticklore/ticklore-site.git` (private).**
  Branches `main` and `feature/ticket-contract`, complete 206-commit history, nothing rewritten.
- Local clone unchanged: `C:\Users\bigow\OneDrive\Documents\GitHub\ticklore-site`.
- **Bare mirrors of all three repos** at `C:\Users\bigow\OneDrive\Documents\GitHub\_backups\*.git`
  (`ticklore-site` 206 commits, `made-in-recovery` 63, `Monkeynomics-site` 13). OneDrive syncs them,
  so they exist in two places. **`Monkeynomics-site` and `made-in-recovery` have NOT been pushed to
  the new GitHub account yet** — they exist only as those mirrors plus their working clones.

## Render — the service that actually runs app.ticklore.com
- Service `ticklore-site`, project "Production". Now deploys from **`ticklore/ticklore-site`**,
  branch **`feature/ticket-contract`**, Root Directory **`mint-service`**, start `node server.js`.
- **Login moved to `bigowl70@gmail.com` with a real password** (it was `alex@vbre.org` with
  *no password set* — a single point of failure). Verified by logging in from a private window.
- **⚠️ TRAP, hit once: changing the Source RESETS Branch to `main`.** `main` is the marketing site and
  has no `mint-service/` directory, so the build fails with "Cause of failure could not be determined."
  After any Source change, re-check **Branch** and **Root Directory** before walking away.
- A failed deploy never replaces the running one. app.ticklore.com stayed up throughout.

## Netlify — LOCKED, but serving
- Account email is `bigowl70@gmail.com`, but **Password was "Not set" and login is GitHub OAuth to
  `weldingcrypto`** — so the login died with GitHub.
- **A password reset created a SECOND, EMPTY Netlify account** rather than recovering the real one.
  Do not repeat that; the empty account is junk.
- **ticklore.com keeps serving normally** — Netlify serves the last deploy regardless of dashboard access.
  What is lost is the ability to change the marketing site or its settings.
- **Escape hatch if never recovered:** the marketing site is just `index.html` + `about.html` in this
  repo. Rebuild it on Render (or a fresh Netlify account) and repoint DNS at GoDaddy, which IS controlled.

## Which address owns what (as of 2026-09-26)
| Asset | Account | State |
|---|---|---|
| Domain + DNS (GoDaddy) | `bigowl70@gmail.com` | SAFE |
| ticklore.com email (M365, GoDaddy-provisioned tenant `NETORGFT20987801`) | via GoDaddy | SAFE |
| Stripe (live, EIN, Managed Payments opt-out) | `alex@ticklore.com` | SAFE |
| Mercury bank (Column N.A.) | `alex@ticklore.com` | SAFE |
| Render | `bigowl70@gmail.com` + password | SAFE |
| GitHub (code) | account `ticklore` | SAFE |
| Netlify | GitHub OAuth → `weldingcrypto` | LOCKED |
| GitHub `weldingcrypto`, Cloudflare | `alex@vbre.org` | LOST/LOSING |

## The lesson, stated plainly so it is not relearned
**Ask "how do I log in" before "what is the account email."** Netlify's account email was already safe
and it still died, because the *login* was OAuth to a dead GitHub account. Render survived the identical
event untouched because it had its own email and password. Any service that can only be entered through
another service's identity is one outage away from being unreachable. Give every important account a
native password, and save the recovery codes somewhere findable.

## Verified live at the time of writing (2026-09-26)
`/health` returns `status: ok`; minting on **chain 8453 (Base mainnet)**, contract
`0xA0925c3912e4dFddEAd6328778665D4074cd1A6E`, minter `0x87455A2927f8cEc6641b78fEb598D862E1Ff6584`,
balance ~`0.01546 ETH`, gas ok. ticklore.com serving. app.ticklore.com serving.
The startup log's `chain 84532` / `balance 0.0 ETH` lines are the **legacy Sepolia lane** and are
expected — see the mainnet section earlier in this document.

## Still outstanding for the Gala (unchanged by the migration)
1. **The treasurer's Stripe connect link** — `/organizer/new-year-s-eve-gala-qbuo6?t=<orgToken>`, pulled
   from `/admin`. Until she connects, ticket money lands in Ticklore LLC's account rather than the
   committee's, and both donation buttons stay dark by the `giftsOpen` guard. **This is the last thing
   between the site and selling tickets.**
2. **Confirm what the printed tickets say** — `app.ticklore.com/gala` works; `ticklore.com/gala` 404s.
   A `_redirects` line on the marketing site would make both work, but that needs Netlify access.
3. Push `Monkeynomics-site` and `made-in-recovery` to the `ticklore` account.
4. The older leftovers: `DONATION_STORE`, `MIN_GAS_ETH`, the `/gala` manual code-entry page,
   Stage 2 door-kit polish, and the stale `render.yaml`.
