# Ticklore — Website & Contract Build Log

_Living record of the dev work. Lives in the repo so it can't be lost with a chat window._

---

## Repo & environment

- **GitHub:** `weldingcrypto/ticklore-site`
- **Live site:** ticklore.com (Netlify, password-gated via `_headers`: `ticklore:story2026`)
- **Working branch:** `feature/ticket-contract` — `main` is the untouched live site
- **Sandbox setup:** run `bash setup-sandbox.sh` from the repo root. Rebuilds Foundry + solc
  and verifies by running the test suite. The sandbox is wiped between sessions; the code
  never is.

### Environment gotchas (hard-won, don't relearn these)

- `$HOME` is `/root`, not `/home/claude`. Adding `$HOME/.foundry/bin` to PATH silently fails.
  Call forge by absolute path: `/home/claude/.foundry/bin/forge`.
- The official solc host (`binaries.soliditylang.org`) is **blocked**. Use GitHub's release
  mirror instead — `github.com/ethereum/solidity/releases/download/v0.8.28/solc-static-linux`.
  This is proven to work.
- `contracts/foundry.toml` hard-codes `solc = "/home/claude/.solc/solc"`. If that path moves,
  update foundry.toml or the build breaks.
- OpenZeppelin + forge-std come down inside the clone. No separate install needed.

---

## Current state of the site

Two hand-written static pages, `index.html` + `about.html`. No framework, no build step,
no backend — a concept preview. Design system: teal/gold; Fraunces + IBM Plex Mono + Work Sans;
"book/chapter" metaphor throughout.

**Known issue — page weight.** Measured 2026-07-24:

| | index.html | about.html |
|---|---|---|
| Real markup/CSS | 16.5 KB | 14.8 KB |
| Total file size | 1.07 MB | 2.11 MB |
| Images as % of file | 98.5% | 99.3% |

There is **one unique image** (403 KB decoded), inlined **six times** across the two pages.
Inlined images can't be cached or reused, so visitors download the same logo six times.

*Fix (not yet done):* extract to `assets/logo.png`, reference it six times. Site drops from
~3.2 MB to ~435 KB first visit, ~31 KB thereafter. Optimizing the PNG would likely land the
whole site under 100 KB — roughly a 35× reduction, zero visual change. Do this on a branch
off `main`, not on the contract branch.

---

## Goal

Evolve the preview into the real product. First target = proof-of-concept flow:
**card payment → ticket minted → delivered by email.**

---

## Key decisions locked in

- **Chain:** Base (Ethereum L2).
- **Tooling:** Foundry + OpenZeppelin 5.6.1, solc 0.8.28 pinned.
- **Money lives in the payment layer (Stripe), NOT the contract.** Contract = "deed office"
  (records + rules); Stripe = "cash register." Buyers never touch crypto.
- **Revenue = per-ticket fee at checkout.** Primary = direct-to-attendee. Secondary = organizer
  buys a batch. One contract supports both (`mintTicket` takes a recipient address).
- **No secondary-market royalty** — deliberate.
- **Minting is owner-only.** Mint fires only after Stripe confirms payment; backend wallet
  = contract owner.
- **Price baked into each ticket** (permanent provenance), stored as whole cents. `0` = free;
  the front-end chooses the word. Contract stores numbers, website chooses words.
- **Donation optional**, default `0`.
- **Names:** collection "Ticklore Ticket", symbol "TCKL".
- **Event data lives per-ticket (self-contained), not in a shared registry** — fits the keepsake
  thesis, and Base gas is cheap. Conscious fork; revisit only with strong reason.

---

## Contract — `contracts/src/TickloreTicket.sol`

ERC-721 (OpenZeppelin) + Ownable. Per-ticket `TicketData`:
`eventName, eventDate (unix), tier, pricePaid (cents), donationAmount (cents), used (bool),
transferUnlock (unix), nonTransferable (bool), originalHolder (address)`.

**17 tests passing** (`forge test`).

### Built and tested

- `mintTicket(to, eventName, eventDate, tier, pricePaid, donationAmount, transferUnlock, nonTransferable)`
  — onlyOwner, returns id, emits `TicketMinted`.
- `checkIn(ticketId)` — onlyOwner door scan; reverts on unknown/already-used; sets `used=true`;
  emits `TicketCheckedIn`.
- Transfer lock in `_update` override: mints always allowed; transfers blocked until
  `block.timestamp >= transferUnlock`; `nonTransferable` tickets blocked forever.
- `tokenURI(ticketId)` — fully on-chain metadata JSON **and** an on-chain SVG card (teal/gold,
  event/tier/price/#id, "ADMITTED" stamp when used), base64 data URIs, no server dependency.
  Palette matches the website exactly.
- `_formatMoney` renders cents → "$X.YZ".
- `_escapeJSON` / `_escapeXML` — **escaping fix, completed 2026-07-24.** Organizer text was
  being pasted raw into both documents. A name like `Mom & Dad's "50th"` broke the JSON at the
  stray quote; angle brackets could inject elements into the SVG. Because tokenURI is generated
  on-chain, such a ticket would be permanently malformed. Now escaped at all five emission
  points. Clean names pass through byte-for-byte unchanged. 6 new tests, each verified to fail
  when the escaping is removed.
  - Cost: **minting gas unchanged** (196,932 → 196,912). Read gas +9%, and reads are free.
  - Note: JSON and XML need *different* rulebooks — JSON cares about `"` `\` and control chars;
    XML cares about `&` `<` `>` `"` `'`. An earlier note said "one fix covers both"; that was
    only true of the reject-on-input approach, which we rejected because `Fundraisers & Galas`
    appears on our own landing page.
- `tickets(id)` getter; `nextTicketId` counter (starts at 1).

### Deployment (added 2026-07-24, separate session)

- `contracts/script/Deploy.s.sol` — creates the contract, assigns the box-office owner.
- `contracts/script/MintDemo.s.sol` — mints ticket #1 so the artwork can be seen on a real network.
- `contracts/DEPLOY.md` — step-by-step Base Sepolia walkthrough.
- Uses an **encrypted keystore** (`cast wallet import`), not a plaintext key in `.env`.
  A committed key cannot be un-leaked; git history keeps it forever.
- Root `.gitignore` added — blocks `.env`, `*.key`, `*.pem`, `.git-credentials`, `.tl_token`.
- Verified clean: no secrets in any project-authored file; `.env.example` holds placeholders only.

### Remaining Solidity punch-list

- **Actually deploy to Base Sepolia** — scripts are written and rehearsed against local Anvil,
  but nothing is on a public network yet. This is the "it's alive" milestone. ← NEXT
  - Needs: an owner wallet address, and a Base Sepolia RPC endpoint (Alchemy or similar).
- Before real money: **security audit**, **Pausable** (emergency stop), **staff/minter roles**
  (AccessControl) so door staff can scan without the master key.
- Optional: batch minting; refactor `mintTicket`'s 8-arg signature to a struct input.
- NOT needed: any withdraw/treasury function — the contract never holds funds.

---

## Product & monetization — the "Living Ticket" / Keepsake Vault

The ticket is the **key**; the vault (event history — photos, video, written memories) is
**token-gated** content unlocked by proving ticket ownership. Chain stores tamper-proof
fingerprints + rules; heavy content lives off-chain. Phase 5 of the plan, but the contract
foundation already supports it (`originalHolder` governs who keeps access).

- **Pay-once, never subscription.** Avoid the "pay or lose your memories" hostage trap.
- **Permanent by default for photos + written memories**, funded up front from the event's
  base price (endowment model — pay-once permanent storage).
- **Video + heavy storage = paid upgrade** (passes real cost + fair margin).
- **Organizer controls contributions:** locked (organizer only) or open (attendees contribute,
  subject to organizer approval).
- **Guiding principle:** charge the *organizer* for capability, up front; **never toll the
  *attendee* at the emotional moment.** Money enters through the organizer's front door only.
- **Strategic framing:** the vault — not the ticket fee — is the real moat and margin.
  Ticketing is a fee race to the bottom vs. giants; memories have no competitor and create
  attachment. Acquire with the ticket, retain and monetize with the vault.

---

## Working practices

- **Push before closing anything.** Sessions end; commits don't.
- **One session at a time.** Two Claude chats open at once share the same sandbox and the same
  branch. On 2026-07-24 a phone session committed deploy scripts into the same working
  directory a desktop session was using. Nothing broke, but concurrent uncommitted edits to
  the same file would collide, and neither session can see the other's reasoning. Finish and
  push in one before starting the next.
- **Credentials:** GitHub tokens are fine-grained, single-repo, Contents-only, short expiry,
  and revoked at end of session. Private keys never go in chat — deploy keys live in an
  encrypted keystore or an environment variable on the local machine.
- **Update this file at the end of each session**, then commit it.

---

## Status — 2026-07-25

**The full proof-of-concept works end to end, including email.** A card payment
mints a real ticket on Base Sepolia, renders it, and emails the buyer a link —
the buyer never touches crypto.

Verified live this session:

    card → Stripe Checkout → webhook → mintTicket → on-chain SVG → email

The original project goal — card payment, ticket minted, delivered by email —
is fully met.

### Email (Resend)

- Sends after the mint via Resend, branded teal/gold, "View your ticket" button.
- Fails safe: email can never break a mint. Verified against no key, no
  recipient, and a bad key — none throw.
- From `onboarding@resend.dev` for now. Free tier only delivers to the account's
  own signup address (`ticklorenft@gmail.com`) until a domain is verified.
- **Pilot task:** verify `ticklore.com` in Resend (add DNS records), then send
  from `tickets@ticklore.com` to any buyer. FROM_EMAIL switches with no code
  change.

- Contract deployed to Base Sepolia (`0xFA63…96ed`) and verified on BaseScan.
- **32 tests passing** — escaping fix, minter/staff/pauser roles separated from
  ownership, emergency pause with deliberate door/read exceptions.
- Mint service (`mint-service/`): HTTP API, storefront at `/shop`, Stripe
  checkout + webhook, double-mint protection, custodial (no-wallet) path.
- Storefront renders each event as a book chapter; on purchase it shows the
  actual on-chain art.

### The webhook saga, so it is never repeated

Two days of intermittent `400 signature verification failed`. It was NOT the
code and NOT (as first assumed) the CLI secret rotating — Stripe's CLI secret
is stable between restarts. It was a hand-introduced mismatch: a stray
character on paste, a duplicated `STRIPE_WEBHOOK_SECRET` line, or the server
reading `.env` before the value was saved.

Fix that finally worked: set the secret mechanically, never by hand.

```bash
SECRET=$(stripe listen --print-secret)
sed -i '/^STRIPE_WEBHOOK_SECRET/d' .env
echo "STRIPE_WEBHOOK_SECRET=$SECRET" >> .env
grep -c STRIPE_WEBHOOK_SECRET .env   # must be 1
```

Full runbook in `mint-service/RUNNING.md`.

### Next up

- **Sponsor name on ticket card** (from the strategy session): a `TicketData`
  field + SVG render + escaping. The escaping helper already covers it.
- **Confirm Legacy Vault needs no contract change** — backdated `eventDate`,
  past `transferUnlock`. Likely works with the existing `mintTicket`.
- **Roster-CSV minting** — the mint service already takes recipient + event
  data; a CSV loop on top is small.
- Before real money: security audit, and move the owner key off the laptop.

---

## Archived — original deployment notes (2026-07-24)

**Deploy to Base Sepolia.** Scripts are written; nothing is on a public network yet.
Then the app layer (scaffold → Stripe checkout → Privy wallet → email → wire the POC
end-to-end).

### Exactly where we stopped (2026-07-24, end of session)

Alex's **desktop is fully set up and independent**:

- WSL (Ubuntu) installed on Windows.
- Foundry **1.7.1** installed inside WSL.
- `gh auth login` completed.
- Repo cloned to `~/ticklore-site`, on branch `feature/ticket-contract`.
- **`forge test` → 17 passed, 0 failed, on his own machine.** No sandbox required.

Remaining steps to the "it's alive" milestone, in order:

1. Create a **fresh MetaMask account** named e.g. `Ticklore Deployer` — must NOT be a wallet
   holding real crypto, since its private key gets exported into the keystore. Alex holds
   real positions; keep them entirely separate.
2. Add Base Sepolia to MetaMask: RPC `https://sepolia.base.org`, chain ID **84532**,
   explorer `https://sepolia.basescan.org`.
3. Get test ETH from a Base Sepolia faucet (Coinbase Developer Platform or Alchemy).
4. `cast wallet import tickloreDeployer --interactive` — encrypted keystore, password-protected.
5. `cp .env.example .env`, set `BASE_SEPOLIA_RPC`.
6. Run `script/Deploy.s.sol`, save the contract address into `.env` as `TICKLORE_CONTRACT`.
7. Run `script/MintDemo.s.sol`, then view the ticket on sepolia.basescan.org.

**Shortcut agreed:** skip the Alchemy signup for the first deploy and use Base's public
endpoint `https://sepolia.base.org`. Swap to Alchemy only if it proves flaky.

Full walkthrough is in `contracts/DEPLOY.md`.

---

## Session log — 2026-07-24

Started with Alex believing an entire night's work had been lost after closing a chat
window. Nothing had been: every commit was already on GitHub. The recovery took minutes;
the rest of the day was spent making that failure mode impossible to repeat.

**Completed:**

- **Escaping fix** — organizer text was pasted raw into both the metadata JSON and the
  on-chain SVG. `_escapeJSON` and `_escapeXML` added at all five emission points. 6 new
  tests, each verified to fail when the escaping is removed. **17 tests passing.**
- **`setup-sandbox.sh`** — one-command toolchain rebuild for the sandbox.
- **`foundry.toml` portability bug fixed** — the default profile hardcoded
  `solc = /home/claude/.solc/solc`, a sandbox-only path. Any clone on any other machine
  failed with "solc does not exist," which is exactly what happened on Alex's desktop.
  Default now uses `solc_version = "0.8.28"`; the absolute path is quarantined in
  `[profile.sandbox]`. **First real test of whether the repo works outside its author's
  machine — and it had been failing.**
- **`BUILD-LOG.md` and `DEPLOY.md` moved into the repo**, including a WSL setup section
  and the Sepolia-vs-Base-Sepolia distinction (they are separate chains; test ETH does
  not cross between them).
- **Website reviewed.** Page weight problem documented (one 403 KB logo inlined six
  times; 3.2 MB total for ~31 KB of real content). Fix not yet applied.
- **Business plan v2 rebuilt** as a branded PDF — `docs/business-plan-v2.pdf`, source
  HTML committed alongside so it can be regenerated. Royalty revenue stream removed
  (it contradicted the plan's own securities risk mitigation), keepsake vault section
  added, Ownership & Transferability and Technical Approach sections added, Appendix A
  primer restored, stale facts corrected.
- **Founder bio strengthened** in both the plan and on the site — from "currently learning
  Solidity" to the operator-turned-builder framing, written to remain accurate under
  diligence questioning about AI-assisted development.
- **Co-founders removed** from the site (merged) and unnamed in the plan. Ozzy has not
  committed; Allison is employed elsewhere and undecided. Naming her as co-founder of
  another venture in a circulating investor document would create a real conflict for her.
  Plan now carries a "Founding Team in Formation" section describing the two roles without
  naming individuals. Stat band changed from "3 founding team members" to
  "$0 outside capital to date."

**Lessons that cost real time today:**

- Two Claude sessions (phone + desktop) shared one sandbox and one branch. Deploy scripts
  appeared mid-session from the other chat. Nothing broke, but neither session could see
  the other's reasoning. **One session at a time.**
- Anything that lives only in a chat window is at risk. Everything material now lives in
  the repo.

---

## Founder profile

Alex Winfield, founder. Learning Solidity from the ground up — build line-by-line, explain
everything, analogies welcome, patient pace. High energy, likes momentum. Sharp product
instincts (coined the "keepsake vault"; strong on the pay-once ethics). Prefers straight
answers over hedging.
