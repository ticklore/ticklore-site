/**
 * lib/stripe-routes.js — checkout and the webhook that mints.
 *
 * THE FLOW
 * --------
 *   1. Buyer clicks Buy            → POST /checkout
 *   2. We create a Stripe session  → redirect to Stripe's hosted page
 *   3. Buyer pays on Stripe        → we never see a card number
 *   4. Stripe calls POST /webhook  → "checkout.session.completed"
 *   5. We mint the ticket
 *   6. Buyer lands on /success     → sees their ticket
 *
 * THE PART THAT MATTERS MOST
 * --------------------------
 * The mint is triggered by the WEBHOOK, not by the buyer's browser landing on
 * the success page. Those feel equivalent and are not.
 *
 * A browser redirect is a suggestion. The buyer can close the tab, lose signal
 * in a parking lot, or hit the success URL directly without paying a cent. If
 * minting hung off the redirect, we would mint tickets nobody paid for and
 * fail to mint tickets people did.
 *
 * The webhook is Stripe's own server telling ours, with a cryptographic
 * signature, that money actually moved. That is the only statement worth
 * trusting, so that is the only one we act on.
 */

const express = require("express");
const ticklore = require("./ticklore");
const ticklorev2 = require("./ticklore-v2");
const ticklorev3 = require("./ticklore-v3");
const ticklorev4 = require("./ticklore-v4");
const ticklorev5 = require("./ticklore-v5");
const store = require("./store");
const events = require("./events");
const claims = require("./claims");
const mintCap = require("./mint-cap");
const moderation = require("./moderation");

// Seed events — the two demo events, available on a fresh install so /shop is
// never empty. Organizer-created events (in the event store) are merged on top.
const SEED_EVENTS = {
  "sullivan-reunion": {
    name: "The Sullivan Family Reunion",
    tier: "General Admission",
    venue: "Lynchburg, VA",
    priceCents: 2500,
    date: "2026-07-22",
    blurb: "Forty-two Sullivans, one warm July afternoon in Lynchburg.",
  },
  "riverbend-gala": {
    name: "The Riverbend Recovery Gala",
    tier: "Patron",
    venue: "Riverbend Hall",
    priceCents: 15000,
    date: "2026-09-14",
    blurb: "Two hundred donors gathered for one night.",
  },
};

/** One event by key — organizer events win over seeds if keys ever collide. */
function getEvent(key) {
  return events.get(key) || SEED_EVENTS[key] || null;
}

/** All PUBLIC events, seeds first then organizer-created, newest last. Sponsor
 *  (Lane B) events are concierge/claim-only, so they never appear in the shop. */
function listEvents() {
  const seeded = Object.entries(SEED_EVENTS).map(([key, e]) => ({ key, ...e }));
  const created = events.list().filter((e) => e.mode !== "sponsor");
  return [...seeded, ...created];
}

function mountStripeRoutes(app, { chain, stripe, chainV2, chainV3, chainV4, chainV5 }) {
  const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;
  const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

  // -------------------------------------------------------------------------
  // Webhook — MUST be registered before express.json()
  //
  // Stripe signs the raw bytes of the request body. If any middleware parses
  // the JSON first, the bytes are reassembled slightly differently and the
  // signature no longer matches. This is the single most common reason a
  // Stripe integration fails, and it fails with a confusing error.
  // -------------------------------------------------------------------------
  app.post("/webhook", express.raw({ type: "application/json" }), async (req, res) => {
    if (!stripe) {
      return res.status(503).send("Stripe is not configured on this deployment");
    }
    if (!WEBHOOK_SECRET) {
      console.error("  ✗ webhook received but STRIPE_WEBHOOK_SECRET is not set");
      return res.status(500).send("Webhook secret not configured");
    }

    let event;
    try {
      // Verifies that this really came from Stripe and was not altered.
      // Without this check, anyone who found the URL could post a fake
      // "payment succeeded" and mint themselves free tickets.
      // Connect note: Stripe signs "events on your account" and "events on
      // connected accounts" with DIFFERENT endpoint secrets — try the account
      // secret first, then the Connect one (STRIPE_WEBHOOK_SECRET_CONNECT).
      const sig = req.get("stripe-signature");
      try {
        event = stripe.webhooks.constructEvent(req.body, sig, WEBHOOK_SECRET);
      } catch (first) {
        const CONNECT_SECRET = process.env.STRIPE_WEBHOOK_SECRET_CONNECT;
        if (!CONNECT_SECRET) throw first;
        event = stripe.webhooks.constructEvent(req.body, sig, CONNECT_SECRET);
      }
    } catch (err) {
      console.error("  ✗ webhook signature verification failed:", err.message);
      return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    if (event.type !== "checkout.session.completed") {
      // Acknowledge everything else so Stripe stops retrying it.
      return res.json({ received: true, ignored: event.type });
    }

    const session = event.data.object;

    // Answer Stripe quickly. Their delivery times out in seconds, and a mint
    // can take longer than that. Acknowledging first and minting after avoids
    // a timeout that would trigger a retry for an order already in progress.
    res.json({ received: true });

    // Claim before fulfilling. If two deliveries land at once, only one wins —
    // this is also what makes Stripe's webhook retries idempotent.
    const claimed = store.claimSession(session.id, {
      email: session.customer_details?.email || null,
      eventKey: session.metadata?.eventKey || null,
      wallet: session.metadata?.wallet || null,
      amountTotal: session.amount_total,
    });

    if (!claimed) {
      const existing = store.findBySession(session.id);
      console.log(`  ↺ duplicate webhook for ${session.id} — already ${existing?.status}, ticket #${existing?.ticketId ?? "?"}`);
      return;
    }

    // ------------------------------------------------------------------
    // Code sale (the Gala lane): the payment buys a CLAIM CODE, not a mint.
    // Allocate an unsold online code and email the claim link — from there
    // the buyer walks the same claim flow as every cash buyer. No mint here;
    // the mint happens at claim, on the newest contract, possibly straight
    // into the buyer's own wallet.
    // ------------------------------------------------------------------
    if (session.metadata?.codeSale === "true") {
      try {
        const eventKey = session.metadata.eventKey;
        const details = getEvent(eventKey);
        if (!details) throw new Error(`Unknown event: ${eventKey}`);
        const buyerEmail = session.customer_details?.email || null;

        const rec = claims.allocateOnline(eventKey, buyerEmail);
        if (!rec) {
          // Paid but sold out — the race window is tiny (availability is checked
          // at checkout creation) but money is involved, so shout loudly.
          store.releaseSession(session.id, "online codes sold out — REFUND NEEDED");
          console.error(`  ✗✗ PAID BUT SOLD OUT: ${session.id} (${buyerEmail}) — refund in the Stripe dashboard`);
          return;
        }

        const claimUrl = `${PUBLIC_URL}/claim/${rec.code}`;
        const emailResult = await require("./email").sendCodeEmail({
          to: buyerEmail, eventName: details.name, claimUrl, priceCents: session.amount_total,
        });
        store.completeSession(session.id, { code: rec.code, recipient: buyerEmail, custodial: true });
        console.log(`  ✓ code sale ${session.id} → ${rec.code} → ${buyerEmail} ${emailResult.sent ? `(✉ ${emailResult.id})` : `(⚠ email: ${emailResult.reason})`}`);
      } catch (err) {
        console.error(`  ✗ code sale failed for ${session.id}: ${err.message}`);
        store.releaseSession(session.id, err.message);
      }
      return;
    }

    try {
      const eventKey = session.metadata?.eventKey;
      const details = getEvent(eventKey);
      if (!details) throw new Error(`Unknown event: ${eventKey}`);

      // Where does the ticket go? If the buyer supplied a wallet, straight to
      // them. If not, it goes to platform custody and the email is the real
      // record of ownership — which is the "no wallet needed" promise, held
      // together with tape until Privy replaces this properly.
      const recipient = session.metadata?.wallet || chain.signer.address;

      // Mint on the contract the EVENT lives on — token ids collide across
      // versions, so minting and display must agree on the universe. Events
      // with an on-chain id use their own generation; seeds fall back to V1.
      const vmap = {
        5: chainV5 && [chainV5, ticklorev5],
        4: chainV4 && [chainV4, ticklorev4],
        3: chainV3 && [chainV3, ticklorev3],
      };
      let result, mintedVersion;
      const pair = details.onChainEventId ? vmap[details.onChainVersion] : null;
      if (pair) {
        const [mc, ml] = pair;
        const hasSponsor = !!(details.sponsorName || (Array.isArray(details.sponsors) && details.sponsors.length));
        const r = await ml.mintTicket(mc.contract, {
          eventId: details.onChainEventId,
          to: recipient,
          price: session.amount_total,
          buyerName: "",
          inscription: "",
          sponsorRef: hasSponsor ? 1 : 0,
          sectionRef: 0,
        });
        result = { ticketId: r.tokenId, txHash: r.txHash };
        mintedVersion = details.onChainVersion;
      } else {
      result = await ticklore.mintTicket(chain.contract, {
        to: recipient,
        eventName: details.name,
        tier: details.tier,
        price: session.amount_total,
        date: details.date,
        sponsorLabel: details.sponsorLabel,
        sponsorName: details.sponsorName,
        palette: details.palette,
        style: details.style,
      });
      mintedVersion = 1;
      }

      store.completeSession(session.id, {
        ticketId: result.ticketId,
        txHash: result.txHash,
        recipient,
        custodial: !session.metadata?.wallet,
        // The token's home contract — the success page pins its art with ?v=
        // so a V1 seed ticket never wears a V5 token's face (id collision).
        version: mintedVersion,
      });

      console.log(`  ✓ paid ${session.id} → ticket #${result.ticketId} → ${recipient}`);

      // Deliver by email. This is AFTER the mint on purpose: the ticket already
      // exists on-chain, so a mail failure costs a notification, not a ticket.
      const buyerEmail = session.customer_details?.email || null;
      const emailResult = await require("./email").sendTicketEmail({
        to: buyerEmail,
        eventName: details.name,
        ticketId: result.ticketId,
        viewUrl: `${PUBLIC_URL}/success?session_id=${session.id}`,
        custodial: !session.metadata?.wallet,
      });
      console.log(emailResult.sent
        ? `  ✉ emailed ${buyerEmail} (${emailResult.id})`
        : `  ⚠ email not sent: ${emailResult.reason}`);
    } catch (err) {
      console.error(`  ✗ mint failed for ${session.id}: ${err.message}`);
      // Mark failed rather than minted, so a Stripe retry can pick it up.
      store.releaseSession(session.id, err.message);
    }
  });

  // -------------------------------------------------------------------------
  // Everything below can use parsed JSON.
  // -------------------------------------------------------------------------

  /** Start a checkout. Returns a Stripe URL for the browser to go to. */
  app.post("/checkout", express.json(), async (req, res) => {
    if (!stripe) {
      return res.status(503).json({ error: "Card checkout isn't configured on this demo." });
    }
    try {
      const { eventKey, wallet } = req.body;
      const details = getEvent(eventKey);
      if (!details) return res.status(400).json({ error: `Unknown event: ${eventKey}` });

      // If a wallet was supplied, sanity-check it now. Discovering it is
      // malformed after taking someone's money is a bad time to find out.
      if (wallet && !require("ethers").isAddress(wallet)) {
        return res.status(400).json({ error: "That does not look like a wallet address" });
      }

      const session = await stripe.checkout.sessions.create({
        mode: "payment",
        // Card only. Stripe Link (the "save my info" / phone-verification flow)
        // adds friction that does not fit a "no wallet, no fuss" ticket buy,
        // and it blocks testing. Naming the type explicitly disables Link.
        payment_method_types: ["card"],
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: details.priceCents,
            product_data: {
              name: details.name,
              description: `${details.tier} — ${details.blurb}`,
            },
          },
        }],
        // Metadata rides along with the payment and comes back on the webhook.
        // This is how the payment knows which ticket to become.
        metadata: { eventKey, wallet: wallet || "" },
        success_url: `${PUBLIC_URL}/success?session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${PUBLIC_URL}/`,
      });

      res.json({ url: session.url, sessionId: session.id });
    } catch (err) {
      console.error("  ✗ checkout failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /**
   * Where the buyer lands after paying.
   *
   * The ticket may not exist yet — the webhook could still be working. So
   * this reports status honestly and lets the page poll, rather than
   * pretending or, worse, minting here.
   */
  app.get("/order/:sessionId", (req, res) => {
    const order = store.findBySession(req.params.sessionId);
    if (!order) return res.json({ status: "pending" });
    // Whitelisted response: the success page needs status + ticket, nothing
    // more. The raw record carries the buyer's email and wallet — personal
    // data that has no business on an unauthenticated poll (S5 audit).
    res.json({
      status: order.status,
      ticketId: order.ticketId ?? null,
      custodial: order.custodial ?? true,
    });
  });

  app.get("/success", async (req, res) => {
    // Demo path: no Stripe session to poll, so mint on the spot and reveal.
    if (req.query.demo && process.env.ALLOW_DEMO_BUY === "true") {
      const details = getEvent(req.query.demo);
      if (!details) return res.status(404).type("html").send(successPage({ error: "Unknown event." }));
      // Sponsor (Lane B) events aren't bought here — they're claimed via a code.
      if (details.mode === "sponsor") {
        return res.status(404).type("html").send(successPage({ error: "This is a sponsor keepsake event — it's distributed by claim code, not bought here." }));
      }
      // Daily ceiling: every demo buy leads to a real testnet mint from one
      // throwaway wallet over a public link.
      const slot = mintCap.tryReserveMint();
      if (!slot.ok) {
        return res.status(429).type("html").send(successPage({ capped: true, cap: slot.cap }));
      }

      // Published (on-chain) events walk the REAL road: the "purchase" buys a
      // claim code — exactly what a card payment buys — and the buyer lands on
      // the claim page: email (or sign-in), mint at claim, possibly straight
      // into their own wallet, receipt in their inbox. Everything a paying
      // customer experiences except the card swipe itself.
      if (details.onChainEventId && (details.onChainVersion === 3 || details.onChainVersion === 4)) {
        // If the organizer set a sponsor credit on this event, every ticket
        // carries it — the event's on-chain sponsor list has it at index 1.
        const hasSponsor = !!(details.sponsorName || (Array.isArray(details.sponsors) && details.sponsors.length));
        const [rec] = claims.generate(req.query.demo, [{
          sponsorRef: hasSponsor ? 1 : 0, count: 1,
          sponsorName: details.sponsorName || (details.sponsors && details.sponsors[0] && details.sponsors[0].name) || "",
          priceCents: details.priceCents || 0, sectionRef: 0, section: "",
        }]);
        // Personalization typed on the shop form rides along as a PREFILL —
        // the claim page is where it's confirmed, and the claim POST is the
        // moderated source of truth.
        const qs = [];
        if (details.allowInscription && req.query.holder) qs.push("name=" + encodeURIComponent(String(req.query.holder).slice(0, 32)));
        if (details.allowInscription && req.query.msg) qs.push("msg=" + encodeURIComponent(String(req.query.msg).slice(0, 42)));
        return res.redirect(`/claim/${rec.code}${qs.length ? "?" + qs.join("&") : ""}`);
      }

      // Seed events exist only in code (no on-chain event), so they keep the
      // legacy instant showcase mint — display-only, V1, no buyer identity.
      const holderName = details.allowInscription ? (req.query.holder || "") : "";
      const message = details.allowInscription ? (req.query.msg || "") : "";
      const mod = moderation.checkInscription({ buyerName: holderName, inscription: message });
      if (!mod.ok) {
        mintCap.releaseMint();
        return res.status(400).type("html").send(successPage({ error: mod.reason }));
      }
      try {
        const result = await ticklore.mintTicket(chain.contract, {
          to: chain.signer.address,
          eventName: details.name, tier: details.tier,
          price: details.priceCents, date: details.date,
          sponsorLabel: details.sponsorLabel, sponsorName: details.sponsorName,
          palette: details.palette, style: details.style,
          holderName, message,
        });
        return res.type("html").send(successPage({ ticketId: result.ticketId, eventName: details.name, custodial: true, immediate: true, version: 1 }));
      } catch (err) {
        mintCap.releaseMint(); // the mint never landed — don't burn the slot
        return res.type("html").send(successPage({ error: err.message }));
      }
    }
    // Stripe path: poll the order store until the webhook mints.
    res.type("html").send(successPage({ sessionId: req.query.session_id || "" }));
  });

  // -------------------------------------------------------------------------
  // The card payment gate for concierge events (the "poster QR"): buys a claim
  // code from the event's ONLINE block. Cash buyers get printed cards; card
  // buyers get this page — same keepsake either way.
  // -------------------------------------------------------------------------

  /** What an event's online lane looks like right now. */
  function onlineLane(key) {
    const details = getEvent(key);
    if (!details) return null;
    const block = (details.blocks || []).find((b) => b.online);
    if (!block) return null;
    return { details, block, remaining: claims.onlineRemaining(key) };
  }

  app.get("/buy/:key", (req, res) => {
    const lane = onlineLane(req.params.key);
    res.type("html").send(buyPage({ key: req.params.key, lane, stripeReady: !!stripe }));
  });

  app.post("/buy/:key/checkout", express.json(), async (req, res) => {
    if (!stripe) return res.status(503).json({ error: "Card payments aren't configured yet." });
    try {
      const lane = onlineLane(req.params.key);
      if (!lane) return res.status(404).json({ error: "This event doesn't sell tickets online." });
      if (lane.remaining < 1) return res.status(409).json({ error: "Online tickets are sold out — cards may still be available at the door." });
      if (!lane.block.priceCents) return res.status(400).json({ error: "This event's online tickets aren't priced." });

      const params = {
        mode: "payment",
        payment_method_types: ["card"],
        line_items: [{
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: lane.block.priceCents,
            product_data: {
              name: `${lane.details.name} — keepsake ticket`,
              description: lane.details.venue ? `${lane.details.venue}` : "A one-of-one keepsake ticket.",
            },
          },
        }],
        metadata: { codeSale: "true", eventKey: req.params.key },
        success_url: `${PUBLIC_URL}/bought?key=${encodeURIComponent(req.params.key)}`,
        cancel_url: `${PUBLIC_URL}/buy/${encodeURIComponent(req.params.key)}`,
      };
      const opts = {};
      // Connect: when the organizer has linked their Stripe, the charge runs
      // ON THEIR ACCOUNT (they are merchant of record; the money is theirs the
      // moment it's paid) and the platform fee peels off at the source.
      if (lane.details.stripeAccountId) {
        // A zero fee is sent as NO fee at all, not as a fee of zero — on a
        // no-cut pilot the whole ticket price is theirs and the charge should
        // say so plainly.
        const feeCents = require("./connect").platformFeeCents(lane.block.priceCents, lane.details);
        if (feeCents > 0) params.payment_intent_data = { application_fee_amount: feeCents };
        opts.stripeAccount = lane.details.stripeAccountId;
      }
      const session = await stripe.checkout.sessions.create(params, opts);
      res.json({ url: session.url });
    } catch (err) {
      console.error("  ✗ code-sale checkout failed:", err.message);
      res.status(500).json({ error: err.message });
    }
  });

  /** Where the buyer lands after paying: the ticket is in their email. */
  app.get("/bought", (req, res) => {
    const details = getEvent(String(req.query.key || ""));
    res.type("html").send(boughtPage(details));
  });
}

function successPage(opts) {
  const { esc: E, head: H, ticketSvg: TS } = require("./ui");
  const sessionId = opts.sessionId || "";
  const immediate = opts.immediate ? { ticketId: opts.ticketId, eventName: opts.eventName, custodial: opts.custodial, version: opts.version || 0 } : null;
  const errored = opts.error || "";
  const capped = opts.capped ? { cap: opts.cap || 20 } : null;

  return `<!doctype html>
<html lang="en"><head>${H("Your ticket — Ticklore")}
<style>
  main{position:relative;z-index:1;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:40px 24px}
  .box{text-align:center;max-width:640px;width:100%}
  .brand{font-family:'Fraunces',serif;font-size:1.6rem;font-weight:600;margin-bottom:2px}
  .brand em{font-style:italic;color:var(--gold-bright)}
  .tag{font-family:'Fraunces',serif;font-style:italic;color:var(--gold-bright);font-size:.98rem;margin-bottom:30px}
  .status{color:rgba(241,233,221,.72);min-height:1.4em;margin-bottom:8px;font-size:1.05rem}
  .headline{font-family:'Fraunces',serif;font-weight:600;font-size:1.9rem;margin-bottom:20px;
    opacity:0;transform:translateY(8px);transition:opacity .6s,transform .6s}
  .headline.show{opacity:1;transform:none}
  .ticket-wrap{opacity:0;transform:translateY(20px) scale(.96);transition:opacity .8s,transform .8s}
  .ticket-wrap.show{opacity:1;transform:none}
  .ticket-wrap svg,.ticket-wrap img{width:100%;max-width:520px;height:auto;border-radius:12px;
    box-shadow:0 34px 80px -28px rgba(0,0,0,.85)}
  .sub{margin-top:20px;font-size:.92rem;color:rgba(241,233,221,.6)}
  .cta{margin-top:26px}
  .spinner{width:34px;height:34px;border:2px solid var(--line);border-top-color:var(--gold);
    border-radius:50%;margin:0 auto 20px;animation:spin 1s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}
</style></head>
<body>
  <main><div class="box">
    <img src="/logo.png" alt="Ticklore — every ticket has a story" style="height:104px;width:auto;display:inline-block;margin-bottom:26px">
    <div class="spinner" id="spin"></div>
    <div class="status" id="s"></div>
    <div class="headline" id="h"></div>
    <div class="ticket-wrap" id="tw"></div>
    <div class="sub" id="n"></div>
    <div class="cta" id="cta"></div>
  </div></main>
<script>
  var IMMEDIATE = ${immediate ? JSON.stringify(immediate) : "null"};
  var ERRORED = ${JSON.stringify(errored)};
  var CAPPED = ${capped ? JSON.stringify(capped) : "null"};
  var sid = ${JSON.stringify(sessionId)};

  function reveal(ticketId, custodial, version){
    document.getElementById('spin').style.display='none';
    document.getElementById('s').textContent='';
    var h=document.getElementById('h'); h.textContent='Chapter One is written.';
    h.classList.add('show');
    var tw=document.getElementById('tw');
    var img=new Image(); img.src='/ticket/'+ticketId+'/image'+(version?'?v='+version:'');
    img.onload=function(){ tw.appendChild(img); requestAnimationFrame(function(){tw.classList.add('show')}); };
    document.getElementById('n').textContent='Ticket #'+ticketId+(custodial?' — held for you. No wallet required.':' — sent to your wallet.');
    document.getElementById('cta').innerHTML='<a href="/shop" class="btn btn--ghost">Browse more events</a>';
  }
  function fail(msg){
    document.getElementById('spin').style.display='none';
    document.getElementById('s').textContent=msg;
    document.getElementById('cta').innerHTML='<a href="/shop" class="btn btn--ghost">Back to events</a>';
  }
  function capNotice(cap){
    document.getElementById('spin').style.display='none';
    document.getElementById('s').textContent='';
    var h=document.getElementById('h'); h.textContent="Today's batch is full.";
    h.classList.add('show');
    document.getElementById('n').textContent='This showroom mints real keepsakes on-chain, so we release a limited number each day ('+cap+'). They reset tomorrow — come write your chapter then.';
    document.getElementById('cta').innerHTML='<a href="/shop" class="btn btn--ghost">Back to events</a>';
  }

  if (CAPPED){ capNotice(CAPPED.cap); }
  else if (ERRORED){ fail('Something went wrong: '+ERRORED); }
  else if (IMMEDIATE){ document.getElementById('s').textContent='Writing your chapter…'; setTimeout(function(){reveal(IMMEDIATE.ticketId, IMMEDIATE.custodial, IMMEDIATE.version)}, 700); }
  else if (sid){
    document.getElementById('s').textContent='Confirming your payment…';
    var tries=0;
    (function poll(){
      tries++;
      fetch('/order/'+sid).then(function(r){return r.json()}).then(function(d){
        if(d.status==='minted'){ reveal(d.ticketId, d.custodial, d.version); return; }
        if(d.status==='failed'){ fail('Your payment went through, but issuing the ticket hit a snag. Nothing is lost — we are on it.'); return; }
        if(tries>40){ document.getElementById('s').textContent='Still working. Your payment is safe; the ticket will appear shortly.'; return; }
        setTimeout(poll, 1500);
      }).catch(function(){ setTimeout(poll, 2000); });
    })();
  } else { fail('No order reference found.'); }
</script>
</body></html>`;
}

// ---------------------------------------------------------------------------
// The payment-gate pages (shared minimal styling with the claim pages).
// ---------------------------------------------------------------------------

function gateHead(title) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>
  :root{--ink:#0E262B;--ink-deep:#081619;--parchment:#F1E9DD;--gold:#C9A227;--gold-bright:#E3C25E;--sage:#7FB3A6;--line:rgba(241,233,221,.14)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--ink);color:var(--parchment);font-family:system-ui,'Segoe UI',sans-serif;line-height:1.5;
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px}
  .box{max-width:480px;width:100%;text-align:center}
  .brand{font-family:Georgia,serif;font-size:1.5rem;font-weight:600}
  .brand em{font-style:italic;color:var(--gold-bright)}
  .tag{font-style:italic;color:var(--gold-bright);font-size:.95rem;margin:2px 0 26px}
  h1{font-family:Georgia,serif;font-weight:600;font-size:1.8rem;margin-bottom:6px}
  .venue{color:var(--sage);font-size:.95rem;margin-bottom:20px}
  .price{font-family:Georgia,serif;font-size:2.2rem;color:var(--gold-bright);margin:10px 0 4px}
  .left{font-family:ui-monospace,monospace;font-size:.78rem;color:var(--sage);margin-bottom:24px}
  button{width:100%;background:var(--gold);color:var(--ink-deep);border:0;border-radius:8px;padding:15px;font-weight:600;font-size:1.05rem;cursor:pointer}
  button:disabled{opacity:.6;cursor:wait}
  .err{color:#E38A8A;font-size:.9rem;min-height:1.2em;margin-top:10px}
  .hint{color:rgba(241,233,221,.55);font-size:.85rem;margin-top:16px;line-height:1.6}
</style></head><body><div class="box">
<div class="brand">Tick<em>lore</em></div><div class="tag">Every ticket has a story.</div>`;
}
const gateFoot = `</div></body></html>`;

function buyPage({ key, lane, stripeReady }) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  if (!lane) {
    return gateHead("Ticklore") + `<h1>Not available</h1><div class="hint">This event doesn't sell tickets online. If you have a printed card, scan its QR instead.</div>` + gateFoot;
  }
  const { details, block, remaining } = lane;
  const price = `$${(block.priceCents / 100).toFixed(2).replace(/\.00$/, "")}`;
  if (!stripeReady) {
    return gateHead("Ticklore") + `<h1>${esc(details.name)}</h1><div class="venue">${esc(details.venue || "")}</div>
<div class="hint">Card payments aren't switched on yet — tickets are available for cash at the desk.</div>` + gateFoot;
  }
  if (remaining < 1) {
    return gateHead("Ticklore") + `<h1>${esc(details.name)}</h1><div class="venue">${esc(details.venue || "")}</div>
<div class="hint">Online tickets are <b>sold out</b> — printed tickets may still be available at the door.</div>` + gateFoot;
  }
  return gateHead("Buy a ticket — " + esc(details.name)) + `<h1>${esc(details.name)}</h1>
<div class="venue">${esc(details.venue || "")}</div>
<div class="price">${price}</div>
<div class="left">${remaining} available online</div>
<button id="go" onclick="pay()">Pay by card &rarr;</button>
<div class="err" id="err"></div>
<div class="hint">Secure payment by Stripe. Your ticket arrives by email the moment payment lands —
it becomes a permanent keepsake when you claim it. No wallet, no app, no crypto anything.</div>
<script>
  function pay(){
    var btn=document.getElementById('go'), err=document.getElementById('err');
    err.textContent=''; btn.disabled=true; btn.textContent='Opening secure checkout…';
    fetch('/buy/${encodeURIComponent(key)}/checkout',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})
      .then(function(r){return r.json()}).then(function(d){
        if(d.url){ location.href=d.url; }
        else { btn.disabled=false; btn.textContent='Pay by card \\u2192'; err.textContent=d.error||'Could not start checkout.'; }
      }).catch(function(){ btn.disabled=false; btn.textContent='Pay by card \\u2192'; err.textContent='Could not reach the server.'; });
  }
</script>` + gateFoot;
}

function boughtPage(details) {
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const name = details ? esc(details.name) : "your event";
  return gateHead("Payment received — Ticklore") + `<h1>You're in. 🎉</h1>
<div class="venue">${name}</div>
<div class="hint" style="font-size:1rem;color:rgba(241,233,221,.8);margin-top:18px">
Your ticket is on its way to your email right now — open the message and tap
<b>“Claim my keepsake.”</b></div>
<div class="hint">Nothing in your inbox after a minute? Check spam, then find us at the ticket desk — your payment is safe either way.</div>` + gateFoot;
}

module.exports = { mountStripeRoutes, getEvent, listEvents };
