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
 * Env: STRIPE_CONNECT_CLIENT_ID (the platform's ca_… id from Stripe's Connect
 * settings). Degrades gracefully when absent — the card simply doesn't show.
 */

const crypto = require("crypto");
const events = require("./events");

function mountConnect(app, { stripe }) {
  const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  const CLIENT_ID = process.env.STRIPE_CONNECT_CLIENT_ID || "";

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
    if (!stripe || !CLIENT_ID) {
      return res.type("html").send(connectPage(e, { ready: false, token: String(req.query.t || "") }));
    }
    res.type("html").send(connectPage(e, { ready: true, token: String(req.query.t || "") }));
  });

  /** Kick off Stripe's OAuth. State carries key + token, verified on return. */
  app.get("/connect/:key/start", (req, res) => {
    const e = events.get(req.params.key);
    const t = String(req.query.t || "");
    if (!e || !tokenOk(e, t)) return res.status(404).type("html").send(minimalPage("There's nothing at this address."));
    if (!stripe || !CLIENT_ID) return res.status(503).type("html").send(minimalPage("Card payments aren't configured yet — check back soon."));
    const state = `${encodeURIComponent(e.key)}.${t}`;
    const url = "https://connect.stripe.com/oauth/authorize" +
      `?response_type=code&client_id=${encodeURIComponent(CLIENT_ID)}` +
      `&scope=read_write&state=${encodeURIComponent(state)}` +
      `&redirect_uri=${encodeURIComponent(PUBLIC_URL + "/connect/callback")}`;
    res.redirect(url);
  });

  /** Stripe sends the organizer back here; we trade the code for their
   *  connected account id and remember it on the event. */
  app.get("/connect/callback", async (req, res) => {
    try {
      const state = String(req.query.state || "");
      const dot = state.indexOf(".");
      const key = decodeURIComponent(dot > 0 ? state.slice(0, dot) : "");
      const t = dot > 0 ? state.slice(dot + 1) : "";
      const e = events.get(key);
      if (!e || !tokenOk(e, t)) return res.status(404).type("html").send(minimalPage("There's nothing at this address."));

      if (req.query.error) {
        return res.type("html").send(connectPage(e, { ready: true, token: t, error: String(req.query.error_description || req.query.error) }));
      }
      const code = String(req.query.code || "");
      if (!code) return res.status(400).type("html").send(minimalPage("That link didn't carry a Stripe authorization."));

      const resp = await stripe.oauth.token({ grant_type: "authorization_code", code });
      events.setStripeAccount(key, resp.stripe_user_id);
      console.log(`  💳 connected ${key} → ${resp.stripe_user_id}`);
      res.type("html").send(connectPage(events.get(key), { ready: true, token: t, justConnected: true }));
    } catch (err) {
      console.error("  ✗ connect callback failed:", err.message);
      res.status(500).type("html").send(minimalPage("Stripe connection failed — try the link again, or contact your Ticklore concierge."));
    }
  });
}

/** The platform fee on a price, per the decided model: 5% + $0.99, env-tunable. */
function platformFeeCents(priceCents) {
  const pct = Number(process.env.TICKLORE_FEE_PCT || 5);
  const flat = Number(process.env.TICKLORE_FEE_FLAT_CENTS || 99);
  return Math.min(priceCents, Math.round(priceCents * (pct / 100)) + flat);
}

function minimalPage(text) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticklore</title><meta name="robots" content="noindex, nofollow">
<style>body{background:#081619;color:rgba(241,233,221,.6);font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;text-align:center}</style>
</head><body><div>${text}</div></body></html>`;
}

function connectPage(e, { ready, token, error, justConnected } = {}) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const connected = !!e.stripeAccountId;
  const body = connected
      ? `<div class="big">${justConnected ? "Connected ✓" : "Stripe connected ✓"}</div>
         <div class="line">Card sales for <b>${esc(e.name)}</b> now deposit <b>directly into your Stripe account</b>.
         You are the merchant of record — your dashboard, your payouts, your refunds.</div>
         <div class="hint">Ticklore's platform fee comes out of each sale automatically. Ticket money never passes through Ticklore.</div>`
    : !ready
      ? `<div class="line">Card payments aren't switched on for this event yet — your Ticklore concierge will let you know when they are.</div>`
      : `<div class="line">Connect your Stripe account and card sales for <b>${esc(e.name)}</b> deposit
         <b>directly to you</b> — your account, your payouts, your dashboard. Ticklore's platform fee
         comes out of each sale automatically; your ticket money never touches Ticklore.</div>
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
