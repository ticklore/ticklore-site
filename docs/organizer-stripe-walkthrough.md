# Connecting an organizer's Stripe — the guide for the person holding their hand

Written for Alex to walk a committee treasurer through Stripe Connect over the
phone or at a kitchen table. Plain language on purpose; nothing here assumes they
know what Stripe is.

---

## The one-sentence version, for when they ask what this is

> "Card payments for your gala go into your organization's own account, not mine.
> Stripe is the company that processes the cards. This is you opening your own
> account with them, which takes about ten minutes, and after that the ticket
> money lands in your bank."

**What it is NOT**, because these are the fears people actually have:

- It is **not** a bank visit, and nobody signs anything at a branch.
- It is **not** giving Ticklore access to their bank account.
- It is **not** a credit application, and there's no credit check on the org.
- Ticklore never sees their bank details — that form is on Stripe's own site.

---

## Before the call: what they should have in front of them

Have the treasurer gather these **first**. The form times out with people hunting
through drawers, and restarting is where frustration comes from.

**About the organization**
- [ ] Legal name **exactly as it appears on the IRS paperwork** — not the name on
      the flyer. "Oceanfront 12 & 12 Inc." not "the New Year's Eve Gala."
- [ ] **EIN** (the organization's tax ID)
- [ ] Business address and phone
- [ ] A one-line description of what they're selling — "tickets to an annual
      fundraising dinner" is fine
- [ ] Roughly what they expect to collect (an estimate is fine — $9,000 for 150
      seats at $60)

**About the person doing it — the "representative"**
- [ ] Their **full legal name, date of birth, home address**
- [ ] Their **SSN** (Stripe may ask for the last 4, or the full number)
- [ ] Their role — Treasurer, President, Board Member

**The bank**
- [ ] **Routing number and account number** for the organization's account —
      readable off a check or from their banking app

> **Say this out loud before they start, because it's the part that alarms
> people:** Stripe asks for a real person's SSN even though the account belongs to
> a nonprofit. That is identity verification on the human authorizing the account,
> required by federal law for anyone moving money. It is **not** a personal
> liability for the gala's funds, and it does not put the money in their name.

**Who should do it:** the **treasurer**, using the **organization's** bank
account. A volunteer's personal account works technically and creates a mess at
tax time — mingled funds, and money that legally arrived in a private individual's
name. Push toward the org account.

---

## The walkthrough

### 1. Alex sends one link

In `/admin`, on the event's row, click **Invite 📋**. That copies the organizer
dashboard link. Send it however they actually read things — text, email, whatever.

*(The event has to exist before this link does.)*

### 2. They open it and click "Connect your Stripe"

The dashboard shows their event's numbers — sold, claimed, checked in. Under
**Card sales** there's a **Connect your Stripe →** link.

**No account, no password, no app to install.** The link itself is the key, which
is why it shouldn't be posted anywhere public.

### 3. Stripe takes over

They land on Stripe's own site. Two paths:

- **Already have a Stripe account:** sign in, click authorize, done in a minute.
- **No account (most likely):** Stripe walks them through creating one, asking for
  everything on the checklist above.

**When Stripe asks for business type, they want "Nonprofit organization"** — that
path asks for the EIN rather than treating the treasurer as a sole proprietor.

Ticklore is not in the middle of any of this. We never see the SSN, the bank
numbers, or the password.

### 4. They come back to a page that says "Connected ✓"

Stripe returns them to Ticklore and we store **one thing**: their Stripe account
id. From that moment, every card sale for the event is a charge on their own
account.

Alex can confirm it from `/admin` — the row shows 💳 connected.

---

## What happens after, so nobody panics

**Where the money goes.** Buyer's card → the organization's Stripe → the
organization's bank. It never passes through Ticklore. They are the merchant of
record, which means their name is on the buyer's card statement and refunds run
under their name.

**When the money arrives.** Stripe pays out to the bank on a rolling schedule,
usually about two business days after a sale. **The first payout on a brand-new
account commonly takes 7–14 days** while Stripe finishes verification. Tell them
this up front — otherwise the first week feels like the money vanished.

**What Stripe charges them.** Standard card processing, roughly 2.9% + 30¢ per
transaction, taken out automatically. On a $60 ticket that's about $2.04.

**What Ticklore charges them.** For this pilot, **nothing** — the platform fee is
set to zero. Say that plainly; it's unusual and it's worth the goodwill.

**A nonprofit rate exists but is not automatic.** Stripe offers discounted
processing to eligible 501(c)(3) organizations, applied for separately. Worth the
treasurer asking Stripe directly. Don't promise it — terms change, and eligibility
is Stripe's call.

**Documents may be requested later.** Stripe sometimes asks for verification
paperwork after the fact — commonly the IRS determination letter. That's normal,
comes by email, and doesn't stop sales in the meantime.

---

## Snags, and what to say

| What they hit | What it means | What to say |
|---|---|---|
| "It's asking for my Social Security number" | Identity check on the human authorizing the account | Required by law for anyone moving money. Not personal liability. |
| "It wants a website" | Stripe wants to see what's being sold | The gala page URL works. |
| "Which bank account?" | — | The organization's, with its EIN. Not a personal one. |
| "It says my account is under review" | Routine for new nonprofits | Sales still work; payouts wait for verification. |
| Link says "There's nothing at this address" | Wrong or truncated link | Resend it — it's long and breaks across lines in text messages. |
| They clicked cancel on Stripe | Nothing broke | Open the same link again and restart. |

---

## What Alex should check when they say they're done

1. `/admin` → the event row shows **💳 connected**
2. Buy one ticket yourself with a real card, then **refund it from their Stripe
   dashboard** — proves the whole path including the refund route
3. Confirm with the treasurer that the payout schedule shows their bank account

**Do not consider it done because they said they finished.** Stripe's onboarding
can end at a "submitted for review" state that looks complete and isn't yet
charging. The 💳 connected badge is the real signal.

---

## The honest boundary

Ticklore doesn't hold their money, can't move their money, and can't see their
banking details. What we can do is create charges on their account for their
event, which is the permission they grant by connecting — and they can revoke it
from their own Stripe dashboard at any time.

Any question about taxes, deductibility, or what a donor's receipt should say
belongs with **their** treasurer or accountant, not with Ticklore. A gala ticket
is generally not fully deductible because a dinner has fair market value — but
that sentence is theirs to write, not ours.
