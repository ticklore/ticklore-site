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
const store = require("./store");

// Demo catalogue. A real product reads this from a database of organizer
// events; the shape is what matters for now.
const EVENTS = {
  "sullivan-reunion": {
    name: "The Sullivan Family Reunion",
    tier: "General Admission",
    priceCents: 2500,
    date: "2026-07-22",
    blurb: "Forty-two Sullivans, one warm July afternoon in Lynchburg.",
  },
  "riverbend-gala": {
    name: "The Riverbend Recovery Gala",
    tier: "Patron",
    priceCents: 15000,
    date: "2026-09-14",
    blurb: "Two hundred donors gathered for one night.",
  },
};

function mountStripeRoutes(app, { chain, stripe }) {
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
    if (!WEBHOOK_SECRET) {
      console.error("  ✗ webhook received but STRIPE_WEBHOOK_SECRET is not set");
      return res.status(500).send("Webhook secret not configured");
    }

    let event;
    try {
      // Verifies that this really came from Stripe and was not altered.
      // Without this check, anyone who found the URL could post a fake
      // "payment succeeded" and mint themselves free tickets.
      event = stripe.webhooks.constructEvent(
        req.body,
        req.get("stripe-signature"),
        WEBHOOK_SECRET
      );
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

    // Claim before minting. If two deliveries land at once, only one wins.
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

    try {
      const eventKey = session.metadata?.eventKey;
      const details = EVENTS[eventKey];
      if (!details) throw new Error(`Unknown event: ${eventKey}`);

      // Where does the ticket go? If the buyer supplied a wallet, straight to
      // them. If not, it goes to platform custody and the email is the real
      // record of ownership — which is the "no wallet needed" promise, held
      // together with tape until Privy replaces this properly.
      const recipient = session.metadata?.wallet || chain.signer.address;

      const result = await ticklore.mintTicket(chain.contract, {
        to: recipient,
        eventName: details.name,
        tier: details.tier,
        price: session.amount_total,
        date: details.date,
      });

      store.completeSession(session.id, {
        ticketId: result.ticketId,
        txHash: result.txHash,
        recipient,
        custodial: !session.metadata?.wallet,
      });

      console.log(`  ✓ paid ${session.id} → ticket #${result.ticketId} → ${recipient}`);
    } catch (err) {
      console.error(`  ✗ mint failed for ${session.id}: ${err.message}`);
      // Mark failed rather than minted, so a Stripe retry can pick it up.
      store.releaseSession(session.id, err.message);
    }
  });

  // -------------------------------------------------------------------------
  // Everything below can use parsed JSON.
  // -------------------------------------------------------------------------

  /** The events available to buy. */
  app.get("/events", (req, res) => {
    res.json(Object.entries(EVENTS).map(([key, e]) => ({ key, ...e })));
  });

  /** Start a checkout. Returns a Stripe URL for the browser to go to. */
  app.post("/checkout", express.json(), async (req, res) => {
    try {
      const { eventKey, wallet } = req.body;
      const details = EVENTS[eventKey];
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
    res.json(order);
  });

  app.get("/success", (req, res) => {
    res.type("html").send(successPage(req.query.session_id || ""));
  });
}

function successPage(sessionId) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Your ticket — Ticklore</title>
<style>
  body{background:#0E262B;color:#F1E9DD;font-family:system-ui,sans-serif;margin:0;
       min-height:100vh;display:flex;align-items:center;justify-content:center}
  .box{text-align:center;padding:32px;max-width:900px}
  h1{font-family:Georgia,serif;margin:0 0 6px}
  .t{font-style:italic;color:#E3C25E;margin-bottom:26px}
  .status{color:rgba(241,233,221,.7);min-height:1.4em;margin-bottom:20px}
  img{max-width:100%;border-radius:10px;box-shadow:0 24px 50px -18px rgba(0,0,0,.7)}
  .note{margin-top:22px;font-size:.9rem;color:rgba(241,233,221,.55)}
</style></head><body><div class="box">
<h1>Ticklore</h1><div class="t">Every ticket has a story.</div>
<div class="status" id="s">Confirming your payment…</div>
<div id="o"></div>
<div class="note" id="n"></div>
<script>
var sid = ${JSON.stringify(sessionId)};
var tries = 0;
function poll(){
  tries++;
  fetch('/order/'+sid).then(function(r){return r.json()}).then(function(d){
    if(d.status==='minted'){
      document.getElementById('s').textContent='Chapter One is written.';
      var i=new Image(); i.src='/ticket/'+d.ticketId+'/image';
      document.getElementById('o').appendChild(i);
      document.getElementById('n').textContent =
        'Ticket #'+d.ticketId+(d.custodial?' — held for you. No wallet required.':' — sent to your wallet.');
      return;
    }
    if(d.status==='failed'){
      document.getElementById('s').textContent='Your payment went through, but we hit a snag issuing the ticket. We are on it — nothing is lost.';
      return;
    }
    if(tries>40){
      document.getElementById('s').textContent='Still working. Your payment is safe; the ticket will appear shortly.';
      return;
    }
    setTimeout(poll, 1500);
  }).catch(function(){ setTimeout(poll, 2000) });
}
if(sid) poll(); else document.getElementById('s').textContent='No order reference found.';
</script>
</div></body></html>`;
}

module.exports = { mountStripeRoutes, EVENTS };
