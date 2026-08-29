# Stripe map — where everything actually lives

Written 2026-08-29, after an evening lost to Stripe's navigation. The dashboard scatters settings across
a gear menu, a Balances tab and product corners, and labels sandbox and live identically. **Don't
navigate. Use the URLs below.**

## Orientation — check this BEFORE typing anything

Two things, every time, top-left of the dashboard:

1. **Which account?** `Ticklore, LLC` or `VBRE`.
2. **Which world?** A `sandbox` badge means test mode. **No badge means LIVE.**

Sandbox and live wear the same account name. That badge is the only difference visible on screen, and
missing it is how real details end up in test mode and vice versa.

## The two logins — they see different accounts

| Login | Sees | Role |
|---|---|---|
| `alex@ticklore.com` | **Ticklore, LLC** only | The real platform. All Ticklore work happens here. |
| `alex@vbre.org` | **VBRE** only | Dormant. Do not put Ticklore anything in it. |

Stripe never tells you the other account exists. If something looks missing, you are probably signed in
as the other user — check `settings/user` before concluding anything is wrong.

## Direct URLs (live mode)

| What | URL |
|---|---|
| Which email am I signed in as | `dashboard.stripe.com/settings/user` |
| Legal name, EIN, representative | `dashboard.stripe.com/settings/business` |
| Bank account + payout schedule | `dashboard.stripe.com/settings/payouts` |
| Webhook endpoints and their `whsec_…` | `dashboard.stripe.com/webhooks` |
| API keys (`sk_…`) | `dashboard.stripe.com/apikeys` |
| Connected accounts (organizers) | `dashboard.stripe.com/connect/accounts/overview` |
| Team members / invites | `dashboard.stripe.com/settings/team` |

These are **live-mode** paths and were used successfully. The sandbox equivalents use a different URL
scheme that was not verified — navigate to sandbox from the account switcher rather than guessing a URL.

## What this project needs from Stripe

- **`STRIPE_SECRET_KEY`** — from `apikeys`, on the Ticklore account.
- **`STRIPE_WEBHOOK_SECRET`** and **`STRIPE_WEBHOOK_SECRET_CONNECT`** — the two `whsec_…` from the
  `ticklore-account` and `ticklore-connected` destinations. Order between them does not matter; the
  handler tries one then the other. **Until both are set, a purchase charges and never issues a ticket —
  do not test a purchase.**
- Connect onboarding is **Account Links**, not OAuth. `STRIPE_CONNECT_CLIENT_ID` is no longer needed.

All of these live as environment variables on **Render** (the app service), not in the repo.

## When email from Stripe doesn't arrive

`ticklore.com` mail is **Microsoft 365 provisioned through GoDaddy**. In order:

1. **Read the address one character at a time.** `t-i-c-k-l-o-r-e`. A missing letter cost an entire
   evening once; Stripe still shows a green "we sent it" when the domain does not exist.
2. **M365 quarantine** — `security.microsoft.com/quarantine`. Holds mail that appears in neither Inbox
   nor Junk. This is the one people miss.
3. **Junk**, then search the whole mailbox for `stripe` — not just the Inbox.
4. **Wrong account?** A link requested while inside VBRE goes to `alex@vbre.org`.

**Workaround if a mailbox is ever unreachable:** invite a known-good address as a team member at
`settings/team`, and use that login instead. Never let the only recovery path for a live account run
through an address you cannot read.
