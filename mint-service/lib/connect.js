/**
 * lib/connect.js — Stripe Connect onboarding: card money lands with the
 * ORGANIZER, never with Ticklore.
 *
 * The moment an organizer needs card sales in their own account, this is the
 * bridge: Alex sends them their dashboard link; a "Connect your Stripe" card
 * on it walks them through Stripe's own OAuth onboarding (Standard account —
 * they keep their full Stripe, their dashboard, their merchant-of-record
 * status, exactly per the money architecture). We store ONLY the connected
 * account id on the event. From then on, checkout runs on THEIR account and
 * the platform fee (5% + $0.99, env-tunable) peels off automatically at the
 * source. No organizer accounts on our side — a link, not a login.
 *
 * Onboarding is ACCOUNT LINKS, not OAuth. Stripe no longer offers OAuth to new
 * platforms, and there is nothing to register: the return URL is passed in the
 * API call, so STRIPE_CONNECT_CLIENT_ID is no longer needed at all.
 */

const crypto = require("crypto");
const events = require("./events");

function mountConnect(app, { stripe }) {
  const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

  /** Bearer check: the organizer proves themselves the same way their
   *  dashboard does — by holding the event's unguessable org token. */
  function tokenOk(e, given) {
    const token = e && (e.orgToken || events.ensureOrgToken(e.key));
    return !!(token && given && given.length === token.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token)));
  }

  /** The connect page: status + the button. Org-token gated, existence-hiding. */
  app.get("/connect/:key", (req, res) => {
    const e = events.get(req.params.key);
    if (!e || !tokenOk(e, String(req.query.t || ""))) {
      return res.status(404).type("html").send(minimalPage("There's nothing at this address."));
    }
    if (!stripe) {
      return res.type("html").send(connectPage(e, { ready: false, token: String(req.query.t || "") }));
    }
    res.type("html").send(connectPage(e, { ready: true, token: String(req.query.t || "") }));
  });

  /**
   * Start onboarding.
   *
   * Stripe no longer offers OAuth to new platforms, so instead of sending the
   * organizer to authorize an account they already have, we create the account
   * object and hand them a hosted link to fill it in. Same destination, and a
   * kinder road: Stripe hosts every screen, someone who already has a Stripe
   * account can sign in and attach it, and an abandoned form resumes instead of
   * restarting.
   *
   * The account id is parked in PENDING. Writing it to stripeAccountId here
   * would tell the rest of the app that this event's money lands there — and
   * every charge would fail, because the account cannot take money until she
   * finishes. Promotion happens on return, and only if Stripe says so.
   */
  app.get("/connect/:key/start", async (req, res) => {
    const e = events.get(req.params.key);
    const t = String(req.query.t || "");
    if (!e || !tokenOk(e, t)) return res.status(404).type("html").send(minimalPage("There's nothing at this address."));
    if (!stripe) return res.status(503).type("html").send(minimalPage("Card payments aren't configured yet — check back soon."));

    try {
      // Reuse the account from an abandoned attempt rather than stranding an
      // empty one on Stripe every time she closes the tab.
      let acct = e.stripePendingAccountId || e.stripeAccountId;
      if (!acct) {
        const created = await stripe.accounts.create({ type: "standard" });
        acct = created.id;
        events.setStripePending(e.key, acct);
        console.log(`  💳 created connect account for ${e.key} → ${acct}`);
      }

      const back = `${PUBLIC_URL}/connect/${encodeURIComponent(e.key)}`;
      const link = await stripe.accountLinks.create({
        account: acct,
        // Expired or already-used links land back on start, which mints a fresh
        // one — a dead link should cost a redirect, not a support conversation.
        refresh_url: `${back}/start?t=${encodeURIComponent(t)}`,
        return_url: `${back}/done?t=${encodeURIComponent(t)}`,
        type: "account_onboarding",
      });
      res.redirect(link.url);
    } catch (err) {
      console.error(`  ✗ connect start failed for ${req.params.key}: ${err.message}`);
      res.status(500).type("html").send(minimalPage("Stripe couldn't start the connection — try the link again, or contact your Ticklore concierge."));
    }
  });

  /**
   * Where Stripe returns her. Landing here means she finished the form, NOT
   * that the account works — Stripe may still be verifying, and some accounts
   * come back needing documents. So we ask the account itself.
   */
  app.get("/connect/:key/done", async (req, res) => {
    const e = events.get(req.params.key);
    const t = String(req.query.t || "");
    if (!e || !tokenOk(e, t)) return res.status(404).type("html").send(minimalPage("There's nothing at this address."));
    if (!stripe) return res.status(503).type("html").send(minimalPage("Card payments aren't configured yet — check back soon."));

    const acct = e.stripePendingAccountId || e.stripeAccountId;
    if (!acct) return res.redirect(`/connect/${encodeURIComponent(e.key)}?t=${encodeURIComponent(t)}`);

    try {
      const a = await stripe.accounts.retrieve(acct);
      if (a.charges_enabled) {
        events.setStripeAccount(e.key, a.id);
        console.log(`  💳 connected ${e.key} → ${a.id}`);
        return res.type("html").send(connectPage(events.get(e.key), { ready: true, token: t, justConnected: true }));
      }
      // Submitted but not yet cleared: real, common, and not a failure. Say so
      // plainly rather than showing a "connect" button that implies she didn't.
      console.log(`  … ${e.key} onboarding pending (submitted=${a.details_submitted}) → ${a.id}`);
      return res.type("html").send(connectPage(e, { ready: true, token: t, pending: a.details_submitted }));
    } catch (err) {
      console.error(`  ✗ connect return failed for ${e.key}: ${err.message}`);
      return res.status(500).type("html").send(minimalPage("Stripe couldn't confirm the connection — open your dashboard link again in a moment."));
    }
  });

  /** Kept so links sent before the Account Links change still land somewhere
   *  sensible instead of a blank 404. */
  app.get("/connect/callback", (req, res) => {
    res.type("html").send(minimalPage("This link is out of date — open your dashboard link again to connect Stripe."));
  });
}

/** The platform fee on a price, per the decided model: 5% + $0.99.
 *
 *  Tunable per event first, then by env, and ZERO IS A LEGITIMATE ANSWER —
 *  a pilot run where Ticklore takes no cut is a real business decision, not a
 *  misconfiguration. Note `??` rather than `||` throughout: a configured 0 must
 *  survive, where `||` would silently fall back to 5% and quietly bill an
 *  organizer who was promised free.
 *
 *  When this returns 0 the caller omits application_fee_amount entirely rather
 *  than sending a zero — an unambiguous "no fee" instead of a fee of nothing. */
function platformFeeCents(priceCents, event) {
  const pct = Number(event?.feePct ?? process.env.TICKLORE_FEE_PCT ?? 5);
  const flat = Number(event?.feeFlatCents ?? process.env.TICKLORE_FEE_FLAT_CENTS ?? 99);
  if (!(pct > 0) && !(flat > 0)) return 0;
  return Math.min(priceCents, Math.round(priceCents * (pct / 100)) + flat);
}

function minimalPage(text) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticklore</title><meta name="robots" content="noindex, nofollow">
<style>body{background:#081619;color:rgba(241,233,221,.6);font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}</style>
</head><body><div>${text}</div></body></html>`;
}

function connectPage(e, { ready, token, error, justConnected, pending } = {}) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const connected = !!e.stripeAccountId;
  // Never promise a fee that isn't charged. On a no-cut event the page has to
  // say so — the treasurer reads this before she trusts us with a bank form.
  const feeFree = platformFeeCents(10000, e) === 0;
  const feeLine = feeFree
    ? "Ticklore takes no fee on this event — every dollar of it is yours. Ticket money never passes through Ticklore."
    : "Ticklore's platform fee comes out of each sale automatically. Ticket money never passes through Ticklore.";
  const body = connected
      ? `<div class="big">${justConnected ? "Connected ✓" : "Stripe connected ✓"}</div>
         <div class="line">Card sales for <b>${esc(e.name)}</b> now deposit <b>directly into your Stripe account</b>.
         You are the merchant of record — your dashboard, your payouts, your refunds.</div>
         <div class="hint">${feeLine}</div>`
    : pending
      // Submitted, not yet cleared. Common on a new nonprofit account, and not
      // a failure — but it must not look finished either, because card sales
      // genuinely cannot run until Stripe is satisfied.
      ? `<div class="big">Almost there</div>
         <div class="line">Stripe has your details for <b>${esc(e.name)}</b> and is reviewing them. That's normal for a
         new account — usually quick, occasionally a day or two if they ask for a document.</div>
         <div class="hint">Nothing more to do right now. Stripe emails you if they need anything, and card sales
         switch on by themselves once they're satisfied.</div>
         <a class="btn" href="/connect/${encodeURIComponent(e.key)}/done?t=${encodeURIComponent(token || "")}">Check again</a>`
    : !ready
      ? `<div class="line">Card payments aren't switched on for this event yet — your Ticklore concierge will let you know when they are.</div>`
      : `<div class="line">Connect your Stripe account and card sales for <b>${esc(e.name)}</b> deposit
         <b>directly to you</b> — your account, your payouts, your dashboard. ${feeFree
           ? "Ticklore takes no fee on this event; your ticket money never touches Ticklore."
           : "Ticklore's platform fee comes out of each sale automatically; your ticket money never touches Ticklore."}</div>
         ${error ? `<div class="err">${esc(error)}</div>` : ""}
         <a class="btn" href="/connect/${encodeURIComponent(e.key)}/start?t=${encodeURIComponent(token)}">Connect with Stripe &rarr;</a>
         <div class="hint">You'll sign in (or sign up) on Stripe's own site — Ticklore never sees your banking details.</div>`;

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Connect Stripe — Ticklore</title><meta name="robots" content="noindex, nofollow">
<style>
  :root{--ink:#0E262B;--ink-deep:#081619;--parchment:#F1E9DD;--gold:#C9A227;--gold-bright:#E3C25E;--sage:#7FB3A6;--line:rgba(241,233,221,.14)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--ink-deep);color:var(--parchment);font-family:system-ui,'Segoe UI',sans-serif;line-height:1.6;
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px}
  .box{max-width:480px;width:100%;text-align:center}
  .tag{font-family:ui-monospace,monospace;font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);margin-bottom:18px}
  .big{font-family:Georgia,serif;font-weight:600;font-size:1.8rem;color:var(--gold-bright);margin-bottom:14px}
  .line{color:rgba(241,233,221,.85);margin-bottom:18px}
  .err{color:#E38A8A;margin-bottom:14px}
  .btn{display:inline-block;background:#635BFF;color:#fff;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:600}
  .hint{color:rgba(241,233,221,.5);font-size:.84rem;margin-top:18px}
</style></head>
<body><div class="box">
  <div class="tag">Ticklore · Payments</div>
  ${body}
</div></body></html>`;
}

module.exports = { mountConnect, platformFeeCents };
