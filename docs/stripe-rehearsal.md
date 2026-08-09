# The Stripe Connect dress rehearsal — step by step

**Purpose:** prove the whole card lane end to end in sandbox, before a single real
dollar or a single real guest touches it. Every click, every value, and what
"correct" looks like at each stop.

**Written against the code as of 2026-08-09:** `lib/connect.js`, the Connect branch
of `lib/stripe-routes.js` (`/buy/:key/checkout`, line ~419), the webhook's code-sale
branch (~line 150), and the dashboard's Connect card (`lib/organizer-dash.js` ~143).

---

## ⚠️ Rehearse on a THROWAWAY event — not the real Gala

Creating an event in `/admin` writes `createEvent` **on-chain**, and the live app is
still on **Base Sepolia**. The rule stands: *never run a real pilot on a contract
slated for replacement.* So:

- **Now:** a disposable test event ("Rehearsal Dinner", 3 tickets, $60) — throw it away after.
- **After the mainnet decision + production bundle:** create the real NYE Gala event,
  and only then wire the two `#` buy buttons on `/gala` to `/buy/<key>`.

Sales don't open until November. There is no cost to waiting, and a real cost to not.

---

## Before you start — three preconditions

Confirm these first; each one has a distinct failure signature later.

| # | Check | Where | Why it bites |
|---|---|---|---|
| 1 | `STRIPE_CONNECT_CLIENT_ID` (`ca_…`) is set **and finished verifying** | Render env + Stripe → Connect settings | Unverified `ca_` = the "Connect with Stripe" button 503s at `/connect/:key/start` |
| 2 | Redirect URI `https://app.ticklore.com/connect/callback` registered in the **sandbox** Connect OAuth settings | Stripe sandbox → Connect → Settings | Wrong/missing = Stripe refuses the authorize URL before you ever see our page |
| 3 | **BOTH** webhook destinations exist: one **account**, one **connected accounts** | Stripe sandbox → Event destinations | This is the one that will bite. See below. |

### Why both webhook destinations, in one paragraph

When the organizer has connected, checkout runs **on their account**
(`opts.stripeAccount = …`, `stripe-routes.js:453`). So `checkout.session.completed`
fires on the *connected* account, and Stripe only delivers that to a destination
whose scope is **connected accounts**. Our handler tries `STRIPE_WEBHOOK_SECRET`
first, then falls back to `STRIPE_WEBHOOK_SECRET_CONNECT` — but a secret can't help
with an event Stripe never sent. **Symptom if you skip it:** the payment succeeds,
money moves, and *no claim email ever arrives.* Looks like a broken email pipeline;
isn't.

Stripe UI vocabulary (it moved): webhooks are now **"Event destinations"** → *Add
destination*; the account-vs-connected choice is called **"Event destination scope."**
Black banner = you're inside the sandbox, which is where the `sk_test` keys live.
Sandbox fingerprint: `acct_1T852XPeeGIX4sbJ` (VBRE).

---

## Step 1 — Create the throwaway event

`https://app.ticklore.com/admin` → your `ADMIN_PASSWORD`.

Create an event with **one ticket block** carrying:

- **count:** `3` (small — every mint spends real testnet gas)
- **price:** `60`
- **online:** ☑ **checked** — this is the whole rehearsal. `onlineLane()` finds the
  block via `.find(b => b.online)`; with no online block, `/buy/:key` renders "doesn't
  sell tickets online" and checkout 404s.
- **sponsor lead-in / name:** leave blank (rehearsing the money, not the sponsors)
- **label prefix:** optional

**Correct looks like:** the event appears in the `/admin` list; the tally under the
block rows reads *"3 sold online"*; the create confirmation mentions codes reserved
for online sale.

**Write down the event key** — every URL below needs it.

---

## Step 2 — Open the organizer dashboard

In the `/admin` event row, click **Invite 📋**. That copies the bearer link:
`https://app.ticklore.com/organizer/<key>?t=<orgToken>`

Open it. You're now seeing exactly what the Gala treasurer will see.

**Correct looks like:** the dashboard renders counts, and a **Card sales → "Connect
your Stripe →"** row is present. If that row is missing, the event already has a
`stripeAccountId`, or `stripe`/`CLIENT_ID` isn't configured.

---

## Step 3 — Connect a sandbox Stripe account

Click **Connect your Stripe →**. That's `/connect/<key>?t=<token>` — org-token gated
and existence-hiding (a wrong token renders "There's nothing at this address," never
a 403 that would confirm the event exists).

Click **Connect with Stripe →** → you land on Stripe's own OAuth (`connect.stripe.com/oauth/authorize`,
`scope=read_write`). In sandbox, fill Stripe's test onboarding — use their prefill
where offered; **no real SSN or bank details are needed in sandbox.**

Stripe returns you to `/connect/callback`, which trades the code for the account id
and stores it on the event (`events.setStripeAccount`).

**Correct looks like:**
- The page reads **"Connected ✓"** with *"Card sales for &lt;event&gt; now deposit
  directly into your Stripe account."*
- Render logs show: `  💳 connected <key> → acct_…`
- The dashboard's Card-sales row has flipped from a link to connected.

**If it fails:** `Stripe connection failed — try the link again…` means the token
exchange threw — check Render logs for `✗ connect callback failed:` and the reason.
An `error=access_denied` in the URL just means you clicked cancel on Stripe's side;
our page re-renders with the reason inline.

---

## Step 4 — Buy a ticket with the test card

Open `https://app.ticklore.com/buy/<key>` (public — no token; this is the URL that
goes on a poster QR).

Click through to checkout and pay with:

```
4242 4242 4242 4242   ·   any future expiry   ·   any CVC   ·   any ZIP
```

Use a **real email address you can open** — the claim link goes there.

### The money math to verify ($60 ticket)

| Line | Amount | Where it's set |
|---|---|---|
| Ticket | **$60.00** | the block's price |
| Ticklore platform fee | **$3.99** | `platformFeeCents()` = 5% + $0.99 → `300 + 99` |
| Stripe's own processing | ~$2.04 | 2.9% + 30¢, borne by the connected account |
| **Organizer nets** | **~$53.97** | direct charge on their account |

**Correct looks like:** in the **connected account's** payments view, a $60 payment
with an **application fee of $3.99**. In the platform account, that $3.99 shows as
application-fee revenue. The $60 never appears as Ticklore's money anywhere — that's
the money architecture proving itself.

---

## Step 5 — The webhook, the code, the email

The payment does **not** mint. It allocates a claim code and emails the claim link;
the mint happens at claim, on the event's own contract version. That's deliberate
(`stripe-routes.js` ~150).

**Correct looks like, in order:**

1. Browser lands on `/bought`.
2. Render logs: `  ✓ code sale cs_… → <CODE> → <your email> (✉ <resend-id>)`
3. The claim email arrives from **Ticklore &lt;tickets@ticklore.com&gt;**.

**Failure signatures worth knowing:**

| Log line | Means |
|---|---|
| `✗ webhook received but STRIPE_WEBHOOK_SECRET is not set` | env missing |
| *(nothing at all after payment)* | the connected-accounts destination isn't registered — precondition 3 |
| `✗✗ PAID BUT SOLD OUT: … — refund in the Stripe dashboard` | codes exhausted between checkout and webhook; refund by hand |
| `(⚠ email: …)` instead of `(✉ …)` | code allocated fine, Resend refused — read the reason |
| `↺ duplicate webhook for cs_…` | Stripe retried; idempotency held. **This is correct behavior**, not an error |

---

## Step 6 — Walk the claim like an attendee

Open the claim link from the email → enter an email → OTP → the keepsake mints.

**Correct looks like:** the keepsake renders its on-chain art; if you signed in with
Privy it's **owned** (in your own embedded wallet), otherwise **held for you**
(custodial). It then shows up at `/wallet` under the same email.

*Field note:* a **422** from Privy on a correct fresh code = stale Privy session
debris in browser localStorage on a dev machine. Try incognito; if that works, clear
site data for app.ticklore.com. Real attendees arrive with clean storage. Also:
every "Send my code" voids the previous one — always use the newest email.

---

## Step 7 — Clean up

Delete the throwaway event in `/admin`. The on-chain event stays forever (that's the
point of the chain) but it's testnet and nobody's keepsake depends on it.

---

## When this all passes, what's actually proven

The organizer's own Stripe holds the money · the fee peels at the source · the
webhook is idempotent · a code is allocated exactly once · the email sends from the
real domain · the claim mints · the wallet finds it.

**What is still NOT proven, and needs its own pass before real sales:** live-mode
keys, a live Connect client id + redirect URI, live webhook destinations, and the
mainnet contract. Sandbox proves the wiring, never the wiring's production twin.
