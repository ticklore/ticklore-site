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

### Remaining Solidity punch-list

- **Deploy script** + deploy to **Base Sepolia testnet** — the "it's alive" milestone. ← NEXT
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
- **Credentials:** GitHub tokens are fine-grained, single-repo, Contents-only, short expiry,
  and revoked at end of session. Private keys never go in chat — deploy keys live in an
  environment variable on the local machine.
- **Update this file at the end of each session**, then commit it.

---

## Next session

Write the deploy script → deploy to **Base Sepolia** → then the app layer
(scaffold → Stripe checkout → Privy wallet → email → wire the POC end-to-end).

Open questions for deployment: which wallet address owns the contract, and which RPC provider.

---

## Founder profile

Alex Winfield, founder. Learning Solidity from the ground up — build line-by-line, explain
everything, analogies welcome, patient pace. High energy, likes momentum. Sharp product
instincts (coined the "keepsake vault"; strong on the pay-once ethics). Prefers straight
answers over hedging.
