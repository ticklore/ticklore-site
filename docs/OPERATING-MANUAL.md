# Ticklore — the operating manual

How to actually run an event. Written for the person holding the admin password.
Current as of 2026-08-09, against the live app at `https://app.ticklore.com`.

---

## 0. The one thing to understand first

**A claim code is not a payment. It is a delivery mechanism.**

Nothing in the claim flow ever asks for money, and that is correct. Money is
collected in one of exactly two places, and neither of them is the claim page:

| Lane | Who takes the money | How the guest gets their code |
|---|---|---|
| **Printed stubs** | a volunteer, in cash, at the desk | it's printed on the stub they were handed |
| **Online (card)** | Stripe, at `/buy/<key>`, **before** anything is issued | emailed to them after payment lands |

Both lanes end at the same claim page. By the time anyone reaches it, the money
question is already settled.

**So if you create an event and every claim comes out free, that is the printed-stub
lane working as designed.** The card lane is a *separate block on the same event*
with the **online** box ticked. Those codes are never printed — they are held back
and handed out one at a time by the Stripe webhook as people pay.

---

## 1. Creating an event

`https://app.ticklore.com/admin` → your `ADMIN_PASSWORD`.

### The fields, and which ones are forever

| Field | What it does | Permanent? |
|---|---|---|
| Name, venue, date | printed on the keepsake art | **frozen at first claim** |
| **Color** | the keepsake's palette | **frozen at first claim** |
| Sponsors (per block) | lead-in + name, engraved on that block's tickets | **frozen at first claim** |
| Section (per block) | e.g. "Table 7", engraved | **frozen at first claim** |
| Price (per block) | what the buyer pays; engraved unless price is hidden | per-block, off-chain |
| Show price | off = the keepsake shows no price at all | **frozen at first claim** |
| Discreet event | soulbound + holders-only vault. For anonymity-sensitive events | **soulbound is permanent** |
| Require activation | stubs are born dormant until a seller activates them | off-chain, changeable |
| Redemption | turns on the door check-in page | off-chain, changeable |

**"Frozen at first claim" is literal.** The contract holds `require(!e.locked,
"event locked (tickets minted)")`, and the lock flips the instant the first ticket
mints. There is no admin screen to edit an event afterward, and there deliberately
never will be — a keepsake that changes under its holder isn't a keepsake.

> **So: check the colour, the name and the spelling BEFORE the first person claims.**
> After that the only fix is a new event.

### Blocks

A block is *a set of tickets that share something*. One block per sponsor, per
section, per price, or per channel. A plain event is one block.

**Tick "online" on the block you want sold by card.** Untick it for stubs you'll
print and sell for cash. You can have both on one event — that's the Gala shape:
a printed block for volunteer sellers, an online block for the website.

### What you get back

An event key, the number of claim codes, and — if you turned on activation — a
**seller PIN, shown once.** Write it down. Volunteers use the PIN; they never get
your admin password.

---

## 2. Codes: how they actually work

Codes are 12 characters of `crypto.randomBytes(9)` as base64url. That means:

- **Case-sensitive.** `aB3-xK_9Qp2m` ≠ `AB3-XK_9QP2M`.
- **Contains `-` and `_`**, and both upper and lower case letters.
- Matched **exactly**. No normalizing, no fuzzy matching, no forgiveness.

**There is currently no "type in your code" box anywhere in the app.** A code is
consumed only as a URL — `/claim/<code>` — reached by scanning the printed QR or
clicking the emailed link. Typing one by hand is not a supported path today.

*(Known gap: the gala page says "Enter it here with an email address," which
promises a box that does not exist. A guest with a dead camera or a torn stub has
no way in. Building that entry page is an open item, and it's also the "manual
lookup" line in the Stage 2 door kit.)*

### Code states

| State | What the guest sees |
|---|---|
| unknown / mistyped | "That claim code isn't valid." |
| dormant (activation on, not yet sold) | "Almost yours." — see the ticket desk |
| already claimed | "already claimed", with the token it became |
| good | the claim page |

---

## 2a. Claiming early is the point — it is not "using" the ticket

**Claiming and redeeming are two different acts, and confusing them is the easiest
mistake to make here.**

- **Claim** = the keepsake mints and becomes theirs. Can happen the moment they buy,
  months before the event. Opens their vault access.
- **Redeem** = staff scan them in at the door on the night. Separate, later, and
  done by staff.

A keepsake claimed in November still walks through the door on December 31. Nothing
about claiming early consumes the ticket, and everything about it is good: it gets
the "is this working?" moment out of the way while there's time to fix it, instead
of in a queue on New Year's Eve.

**So: encourage guests to claim as soon as they buy.** Then they have their keepsake,
their vault, and their door pass — all before the night.

### "Activated at purchase" vs seller activation

Leave **Require activation OFF** and codes are born active — bought is active,
confirmed at the door. That is the normal setup and almost certainly what you want.

Activation exists for one narrow case: **printed stubs handed to volunteers to sell
for cash.** Those cards are born dormant so a stolen or photographed stub is
worthless paper until the desk activates it with the seller PIN. If your sellers
aren't walking around with pre-printed stubs, you don't need it.

## 3. Claiming — what the guest does

1. Scan the stub's QR, or click the link in their email.
2. Enter an email address. If Privy is configured they get a 6-digit code to prove
   the address is theirs.
3. The keepsake **mints** — on the contract version that event was created on.

**Signed in with Privy → the keepsake is theirs**, in their own embedded wallet
(`owned`). **Not signed in → it's held custodially** and their email is the record.
Both are real; only the custody differs.

Claiming is free at this step in every case. See §0.

---

## 4. The door — how a ticket gets redeemed

**This is the question people get wrong, so plainly: the holder does not redeem
their own ticket. Staff do, at the door.**

There is no redeem button in the wallet and there shouldn't be — a ticket that
guests can mark "used" themselves is not a door check.

**What the guest presents:**

| How they bought | What they show at the door |
|---|---|
| printed stub | the QR printed on the stub |
| online / emailed | **the door pass in their wallet** — `/wallet` → **Show door pass** |

The door pass is a QR of that keepsake's door URL, added 2026-08-09. Before it,
an online buyer arrived with nothing to present, which is the same as not having a
ticket. It appears only on a claimed keepsake, only for the verified holder, and
only while the event has redemption on and the ticket hasn't been used. Handing the
holder their own code weakens nothing: `/door` is staff-gated, so scanning your own
pass cannot admit you — it is exactly what the printed stub already does.

**Steps:**

- Turn on **redemption** for the event.
- Staff open **`/door/<code>`** — by scanning the stub QR *or* the guest's door pass.
- The page calls the contract's `redeem`, and the keepsake gets a permanent
  **ADMITTED** stamp rendered into its art forever.
- Scanning a second time shows it's already been used.

**Today `/door` is gated by the admin password.** That's fine for a test and wrong
for a real door with volunteers — switching it to a door PIN is the top item in the
Stage 2 door kit, and it must be done before December 31.

---

## 5. The wallet and the vault

`/wallet` — the guest signs in with the same email and sees their keepsakes, with
**Yours / Held for you / Admitted** badges. Pressing one opens that event's **memory
vault**.

Vault visibility is **private by default** (fail closed). A private vault's page
needs an unguessable token in the link; without it, the address returns "nothing
here" — that is the privacy design working, not an error.

Curate the vault at **`/admin/vault/<key>`**: upload photos, add letters, publish
what guests submit. Guests add memories from the public vault page, and everything
they submit lands as **pending** until you publish it. Curation *is* the privacy
model — nothing appears because someone uploaded it.

---

## 6. Donations

Two ways to give, both landing in the organizer's own Stripe:

- **On the ticket page** — an optional donation, added as its own line item.
- **`/donate/<key>`** — a gift on its own, no ticket, no seat.

**Both stay invisible until the organizer has connected their Stripe.** A gift must
never land in Ticklore's account with the donor's receipt naming the wrong entity.

Gifts never allocate a code and never count against capacity. They're reported
separately on the organizer dashboard — split between *given on its own* and *added
to a ticket* — because a dinner ticket and a gift are different things on a
nonprofit's books.

---

## 7. Money

Card sales run on the **organizer's own Stripe** (Connect Standard, they are the
merchant of record). They connect once, from a link:

`/admin` row → **Invite 📋** → send them that dashboard link → they click **Connect
your Stripe** → 5–10 minutes on Stripe's own site → **Connected ✓**.

Ticklore's fee is `TICKLORE_FEE_PCT` + `TICKLORE_FEE_FLAT_CENTS`. **Both are zero
right now — the Gala is a no-cut pilot.** The fee is always computed from the ticket
price alone and never touches a donation.

Ticklore never holds ticket money at any point.

---

## 8. Keeping the event off the public shop

Already handled: everything created in `/admin` is stored as a **sponsor-mode**
event, and `listEvents()` excludes those from `/shop`. It's reachable only by its
own links — which is exactly the "only visible from /gala" posture.

---

## 9. Where everything lives

| Page | Who it's for | Gate |
|---|---|---|
| `/admin` | you | admin password |
| `/admin/overview` | you — Mission Control | admin password |
| `/admin/event/<key>/sheet` | printable QR stubs | admin password |
| `/admin/vault/<key>` | curating the vault | admin password |
| `/organizer/<key>?t=…` | the committee — counts, never names | the link itself |
| `/buy/<key>` | card buyers | public |
| `/donate/<key>` | givers | public |
| `/claim/<code>` | guests | the code itself |
| `/door/<code>` | door staff | admin password *(to become a door PIN)* |
| `/wallet` | guests | their own sign-in |
| `/health` | you | public |

---

## 10. When something looks wrong

**"Everything claims for free."** Working as designed — see §0. You want an
**online** block for card sales.

**"That claim code isn't valid."** Almost always a hand-typed code: they're
case-sensitive and contain `-` and `_`. Scan the QR or use the emailed link. Also
check you're not reading a *label* (`BLUE 07`) instead of the code.

**"The keepsake is the wrong colour."** The colour is set at event creation and
**frozen at the first claim.** The dropdown defaults to **Teal & Gold** — if you
didn't actively change it, that's what you got. Once a ticket is claimed, that
event's art can't be changed; make a new event.

**"The vault link is dead."** Fixed 2026-08-09 (`b244464`). The wallet was building
private-vault links without their token. If you see it again on an event created
*before* that fix, opening `/admin/vault/<key>` once mints the token and repairs
the link.

**"No claim email arrived after a card payment."** Check the **connected-accounts**
webhook destination exists in Stripe. Connected-account sales fire their completion
event on the connected account; without that scope Stripe never sends it, the
payment succeeds, and no email is ever generated. Looks like broken email; isn't.

**Check gas.** `/health` → `minting.gas`. Empty minter = every claim fails.

---

## 11. Before the Gala — the standing list

- [ ] Door kit: **door PIN instead of the admin password**, big green/red result,
      running count, manual lookup, printable fallback
- [ ] A manual code-entry page (§2 gap — the gala page already promises it)
- [ ] Raise `MIN_GAS_ETH`; the default warns with ~25 mints left, and you'll have 150
- [ ] `DONATION_STORE=/var/data/donations.json` so gifts survive a redeploy
- [ ] Mainnet decision → then create the real Gala event → then wire the three
      placeholder links on `/gala`
- [ ] Stripe: sandbox rehearsal, then live-mode migration
