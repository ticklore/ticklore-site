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
const store = require("./store");
const events = require("./events");

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

/** All events, seeds first then organizer-created, newest organizer events last. */
function listEvents() {
  const seeded = Object.entries(SEED_EVENTS).map(([key, e]) => ({ key, ...e }));
  const created = events.list();
  return [...seeded, ...created];
}

function mountStripeRoutes(app, { chain, stripe, chainV2 }) {
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
      const details = getEvent(eventKey);
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
        sponsorLabel: details.sponsorLabel,
        sponsorName: details.sponsorName,
        palette: details.palette,
        style: details.style,
      });

      store.completeSession(session.id, {
        ticketId: result.ticketId,
        txHash: result.txHash,
        recipient,
        custodial: !session.metadata?.wallet,
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
    res.json(order);
  });

  app.get("/success", async (req, res) => {
    // Demo path: no Stripe session to poll, so mint on the spot and reveal.
    if (req.query.demo && process.env.ALLOW_DEMO_BUY === "true") {
      try {
        const details = getEvent(req.query.demo);
        if (!details) return res.status(404).type("html").send(successPage({ error: "Unknown event." }));
        // Only honor a buyer inscription when the organizer enabled it — the
        // fields aren't shown otherwise, and a hand-crafted URL shouldn't slip past.
        const holderName = details.allowInscription ? (req.query.holder || "") : "";
        const message = details.allowInscription ? (req.query.msg || "") : "";

        // V2 path: the event lives on-chain → mint the event-model ticket.
        if (chainV2 && details.onChainEventId) {
          const r = await ticklorev2.mintTicket(chainV2.contract, {
            eventId: details.onChainEventId,
            to: chainV2.signer.address,
            price: details.priceCents,
            buyerName: holderName,
            inscription: message,
          });
          return res.type("html").send(successPage({ ticketId: r.tokenId, eventName: details.name, custodial: true, immediate: true }));
        }

        // V1 path (current demo).
        const result = await ticklore.mintTicket(chain.contract, {
          to: chain.signer.address,
          eventName: details.name, tier: details.tier,
          price: details.priceCents, date: details.date,
          sponsorLabel: details.sponsorLabel, sponsorName: details.sponsorName,
          palette: details.palette, style: details.style,
          holderName, message,
        });
        return res.type("html").send(successPage({ ticketId: result.ticketId, eventName: details.name, custodial: true, immediate: true }));
      } catch (err) {
        return res.type("html").send(successPage({ error: err.message }));
      }
    }
    // Stripe path: poll the order store until the webhook mints.
    res.type("html").send(successPage({ sessionId: req.query.session_id || "" }));
  });
}

function successPage(opts) {
  const { esc: E, head: H, ticketSvg: TS } = require("./ui");
  const sessionId = opts.sessionId || "";
  const immediate = opts.immediate ? { ticketId: opts.ticketId, eventName: opts.eventName, custodial: opts.custodial } : null;
  const errored = opts.error || "";

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
  var sid = ${JSON.stringify(sessionId)};

  function reveal(ticketId, custodial){
    document.getElementById('spin').style.display='none';
    document.getElementById('s').textContent='';
    var h=document.getElementById('h'); h.textContent='Chapter One is written.';
    h.classList.add('show');
    var tw=document.getElementById('tw');
    var img=new Image(); img.src='/ticket/'+ticketId+'/image';
    img.onload=function(){ tw.appendChild(img); requestAnimationFrame(function(){tw.classList.add('show')}); };
    document.getElementById('n').textContent='Ticket #'+ticketId+(custodial?' — held for you. No wallet required.':' — sent to your wallet.');
    document.getElementById('cta').innerHTML='<a href="/shop" class="btn btn--ghost">Browse more events</a>';
  }
  function fail(msg){
    document.getElementById('spin').style.display='none';
    document.getElementById('s').textContent=msg;
    document.getElementById('cta').innerHTML='<a href="/shop" class="btn btn--ghost">Back to events</a>';
  }

  if (ERRORED){ fail('Something went wrong: '+ERRORED); }
  else if (IMMEDIATE){ document.getElementById('s').textContent='Writing your chapter…'; setTimeout(function(){reveal(IMMEDIATE.ticketId, IMMEDIATE.custodial)}, 700); }
  else if (sid){
    document.getElementById('s').textContent='Confirming your payment…';
    var tries=0;
    (function poll(){
      tries++;
      fetch('/order/'+sid).then(function(r){return r.json()}).then(function(d){
        if(d.status==='minted'){ reveal(d.ticketId, d.custodial); return; }
        if(d.status==='failed'){ fail('Your payment went through, but issuing the ticket hit a snag. Nothing is lost — we are on it.'); return; }
        if(tries>40){ document.getElementById('s').textContent='Still working. Your payment is safe; the ticket will appear shortly.'; return; }
        setTimeout(poll, 1500);
      }).catch(function(){ setTimeout(poll, 2000); });
    })();
  } else { fail('No order reference found.'); }
</script>
</body></html>`;
}

module.exports = { mountStripeRoutes, getEvent, listEvents };
