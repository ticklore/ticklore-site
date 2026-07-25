/**
 * lib/storefront.js — the public buying surface.
 *
 * Serves the event listing page at "/shop" and, for local demos that don't
 * want the Stripe tunnel running, a "/demo-buy" route that mints directly.
 *
 * The real path is still Stripe: the Buy button posts to /checkout when Stripe
 * is configured. /demo-buy exists so the storefront is never dead just because
 * a webhook secret drifted — which, after today, is a real concern.
 */

const express = require("express");
const ticklore = require("./ticklore");
const { getEvent, listEvents } = require("./stripe-routes");
const { esc, money, formatDate, formatDateShort, chapter, ticketSvg, head, BASE_CSS } = require("./ui");
const { rateLimit } = require("./ratelimit");

function mountStorefront(app, { chain, stripeEnabled }) {
  /** Public list of buyable events. Lives here (not in the Stripe module) so it
   *  works whether or not Stripe is configured. */
  app.get("/events", (req, res) => {
    res.json(listEvents());
  });

  /**
   * Demo purchase — mints straight away, no payment.
   *
   * Gated behind ALLOW_DEMO_BUY so it can never be left on in front of real
   * money. It is a showroom, not a checkout.
   */
  app.post("/demo-buy", rateLimit({ windowMs: 60_000, max: 5 }), express.json(), async (req, res) => {
    if (process.env.ALLOW_DEMO_BUY !== "true") {
      return res.status(403).json({ error: "Demo buying is off. Set ALLOW_DEMO_BUY=true to enable it." });
    }
    try {
      const { eventKey, wallet } = req.body;
      const details = getEvent(eventKey);
      if (!details) return res.status(400).json({ error: `Unknown event: ${eventKey}` });

      const recipient = wallet && require("ethers").isAddress(wallet)
        ? wallet
        : chain.signer.address;

      const result = await ticklore.mintTicket(chain.contract, {
        to: recipient,
        eventName: details.name,
        tier: details.tier,
        price: details.priceCents,
        date: details.date,
      });

      res.json({ ok: true, ticketId: result.ticketId, txHash: result.txHash, custodial: !wallet });
    } catch (err) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  /** The storefront itself. */
  app.get("/shop", (req, res) => {
    const events = listEvents();
    res.type("html").send(shopPage(events, stripeEnabled, process.env.ALLOW_DEMO_BUY === "true"));
  });

  /** An individual event's page — the story, the ticket, then buy. */
  app.get("/event/:key", (req, res) => {
    const details = getEvent(req.params.key);
    if (!details) {
      return res.status(404).type("html").send(notFoundPage());
    }
    const idx = listEvents().findIndex((e) => e.key === req.params.key);
    res.type("html").send(eventPage(
      { key: req.params.key, ...details },
      Math.max(idx, 0),
      stripeEnabled,
      process.env.ALLOW_DEMO_BUY === "true"
    ));
  });

  /** The hero landing page. */
  app.get("/", (req, res) => {
    const events = listEvents();
    res.type("html").send(landingPage(events));
  });
}


// ===========================================================================
// Shared purchase script — used by the event page and the shop.
// Prefers real Stripe checkout; falls back to the gated demo mint.
// ===========================================================================
function purchaseScript(stripeEnabled, demoEnabled) {
  return `
  var STRIPE = ${stripeEnabled ? "true" : "false"};
  var DEMO = ${demoEnabled ? "true" : "false"};

  function buy(key, name, btn){
    if (STRIPE){
      btn.disabled = true; btn.textContent = 'Opening checkout…';
      fetch('/checkout',{method:'POST',headers:{'Content-Type':'application/json'},
        body:JSON.stringify({eventKey:key})})
        .then(function(r){return r.json()})
        .then(function(d){ if(d.url){window.location=d.url;}
          else{btn.disabled=false;btn.textContent='Begin this chapter';alert(d.error||'Could not start checkout');} })
        .catch(function(){btn.disabled=false;btn.textContent='Begin this chapter';});
      return;
    }
    if (DEMO){ window.location = '/success?demo=' + encodeURIComponent(key); return; }
    alert('Buying is not configured yet.');
  }`;
}

// ===========================================================================
// Landing page — the hero. First thing an investor sees.
// ===========================================================================
function landingPage(events) {
  const featured = events[0];
  const heroTicket = featured
    ? ticketSvg({ name: featured.name, tier: featured.tier, priceCents: featured.priceCents, number: "001", chapterLabel: "I" })
    : ticketSvg({ name: "The Sullivan Family Reunion", tier: "General Admission", priceCents: 2500, number: "001" });

  return `<!doctype html>
<html lang="en"><head>${head("Ticklore — Every ticket has a story")}
<style>
  .hero{position:relative;z-index:1;max-width:1080px;margin:0 auto;padding:40px 24px 20px;
    display:grid;grid-template-columns:1.05fr .95fr;gap:56px;align-items:center;min-height:70vh}
  @media (max-width:860px){.hero{grid-template-columns:1fr;gap:36px;text-align:center;padding-top:20px}}
  .hero__eyebrow{font-family:'IBM Plex Mono',monospace;font-size:.74rem;letter-spacing:.22em;
    text-transform:uppercase;color:var(--gold);margin-bottom:20px}
  .hero__title{font-family:'Fraunces',serif;font-weight:600;font-size:3.4rem;line-height:1.04;
    letter-spacing:-.02em;color:var(--parchment)}
  .hero__title em{font-style:italic;color:var(--gold-bright)}
  @media (max-width:860px){.hero__title{font-size:2.5rem}}
  .hero__lede{margin-top:22px;max-width:30ch;font-size:1.12rem;line-height:1.6;color:rgba(241,233,221,.72)}
  @media (max-width:860px){.hero__lede{margin-left:auto;margin-right:auto}}
  .hero__cta{margin-top:34px;display:flex;gap:14px;flex-wrap:wrap}
  @media (max-width:860px){.hero__cta{justify-content:center}}
  .hero__art{position:relative}
  .hero__art svg{width:100%;height:auto;border-radius:14px;
    box-shadow:0 40px 90px -30px rgba(0,0,0,.85);
    animation:float 6s ease-in-out infinite}
  @keyframes float{0%,100%{transform:translateY(0) rotate(-1.2deg)}50%{transform:translateY(-12px) rotate(-1.2deg)}}
  .hero__art::after{content:'';position:absolute;inset:-30px;z-index:-1;border-radius:24px;
    background:radial-gradient(closest-side,rgba(201,162,39,.16),transparent 70%)}

  .promise{position:relative;z-index:1;max-width:960px;margin:20px auto 0;padding:60px 24px;
    display:grid;grid-template-columns:repeat(3,1fr);gap:36px;border-top:1px solid var(--line)}
  @media (max-width:760px){.promise{grid-template-columns:1fr;gap:28px;text-align:center}}
  .promise__num{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:.2em;color:var(--gold);margin-bottom:10px}
  .promise h3{font-family:'Fraunces',serif;font-weight:600;font-size:1.25rem;margin-bottom:8px}
  .promise p{color:rgba(241,233,221,.62);font-size:.96rem;line-height:1.55}

  .closer{position:relative;z-index:1;text-align:center;padding:70px 24px 90px;max-width:640px;margin:0 auto}
  .closer h2{font-family:'Fraunces',serif;font-weight:600;font-size:2rem;line-height:1.15;margin-bottom:18px}
  .closer p{color:rgba(241,233,221,.66);margin-bottom:28px;font-size:1.05rem}
  footer{position:relative;z-index:1;text-align:center;padding:0 24px 50px;color:rgba(241,233,221,.4);font-size:.82rem}
</style></head>
<body>
  <nav class="nav">
    <a href="/" class="brand" style="text-decoration:none;display:flex;align-items:center">
      <img src="/logo.png" alt="Ticklore — every ticket has a story" style="height:58px;width:auto;display:block">
    </a>
    <span style="display:flex;gap:22px;align-items:center">
      <a href="/organize">Organizer demo</a>
      <a href="/shop">Browse events →</a>
    </span>
  </nav>

  <section class="hero">
    <div class="hero__copy">
      <div class="hero__eyebrow">Keepsake ticketing</div>
      <h1 class="hero__title">Every ticket<br>has a <em>story.</em></h1>
      <p class="hero__lede">A ticket that outlasts the night — a permanent keepsake your guests keep long after the last song, the last toast, the last goodbye.</p>
      <div class="hero__cta">
        <a href="/shop" class="btn">Browse events</a>
        <a href="#how" class="btn btn--ghost">How it works</a>
      </div>
    </div>
    <div class="hero__art">${heroTicket}</div>
  </section>

  <section class="promise" id="how">
    <div>
      <div class="promise__num">01</div>
      <h3>Buy in a tap</h3>
      <p>Pay with a card, like any ticket. No wallet, no crypto, no accounts to create. The complexity stays invisible.</p>
    </div>
    <div>
      <div class="promise__num">02</div>
      <h3>Yours to keep</h3>
      <p>Your ticket is a one-of-one keepsake, permanently yours. It can't be faked, and it never disappears.</p>
    </div>
    <div>
      <div class="promise__num">03</div>
      <h3>The story grows</h3>
      <p>After the event, photos and memories gather around your ticket — a chapter that keeps being written.</p>
    </div>
  </section>

  <section class="closer">
    <h2>Find your next chapter.</h2>
    <p>Reunions, galas, benefits, shows — every gathering worth remembering.</p>
    <a href="/shop" class="btn">Browse events</a>
  </section>

  <footer>A concept preview. Every ticket has a story.</footer>
</body></html>`;
}

// ===========================================================================
// Shop — the grid of events, each linking to its own page.
// ===========================================================================
function shopPage(events, stripeEnabled, demoEnabled) {
  const cards = events.map((e, i) => `
      <a class="chapter" href="/event/${esc(e.key)}" style="--stagger:${i}">
        <div class="chapter__spine"></div>
        <div class="chapter__body">
          <div class="chapter__eyebrow mono">CHAPTER ${chapter(i)} · ${formatDateShort(e.date)}</div>
          <h2 class="chapter__title">${esc(e.name)}</h2>
          <p class="chapter__blurb">${esc(e.blurb || "")}</p>
          <div class="chapter__foot">
            <div class="chapter__meta">
              <span class="chapter__tier mono">${esc(e.tier)}</span>
              <span class="chapter__price">${money(e.priceCents)}</span>
            </div>
            <span class="chapter__go mono">View →</span>
          </div>
        </div>
      </a>`).join("");

  return `<!doctype html>
<html lang="en"><head>${head("Ticklore — Browse events")}
<style>
  main{position:relative;z-index:1;padding:8px 0 100px}
  .head{text-align:center;padding:20px 24px 8px;max-width:640px;margin:0 auto}
  .head h1{font-family:'Fraunces',serif;font-weight:600;font-size:2.2rem;letter-spacing:-.01em}
  .head p{color:rgba(241,233,221,.62);margin-top:8px}
  .rule{height:1px;max-width:840px;margin:34px auto 8px;
    background:repeating-linear-gradient(to right,var(--line) 0 7px,transparent 7px 15px)}
  .grid{max-width:840px;margin:0 auto;padding:16px 24px}
  .chapter{display:flex;text-decoration:none;color:inherit;
    background:linear-gradient(135deg,#123138 0%,#0d262c 60%,#0a1e23 100%);
    border:1px solid rgba(227,194,94,.16);border-radius:10px;overflow:hidden;margin:20px 0;
    box-shadow:0 24px 50px -28px rgba(0,0,0,.75);opacity:0;transform:translateY(16px);
    animation:rise .7s cubic-bezier(.2,.8,.2,1) forwards;animation-delay:calc(var(--stagger)*.1s + .05s);
    transition:border-color .2s,transform .2s}
  .chapter:hover{border-color:rgba(227,194,94,.4);transform:translateY(-2px)}
  @keyframes rise{to{opacity:1;transform:translateY(0)}}
  .chapter__spine{width:6px;flex:0 0 6px;background:linear-gradient(to bottom,var(--teal),var(--gold))}
  .chapter__body{padding:28px 32px;flex:1}
  .chapter__eyebrow{font-size:.7rem;letter-spacing:.16em;color:var(--gold);margin-bottom:12px}
  .chapter__title{font-family:'Fraunces',serif;font-weight:600;font-size:1.7rem;line-height:1.1;letter-spacing:-.015em}
  .chapter__blurb{color:rgba(241,233,221,.6);margin-top:10px;max-width:46ch;font-size:.96rem}
  .chapter__foot{display:flex;align-items:flex-end;justify-content:space-between;gap:20px;margin-top:24px;flex-wrap:wrap}
  .chapter__meta{display:flex;align-items:baseline;gap:16px}
  .chapter__tier{font-size:.72rem;letter-spacing:.09em;color:var(--sage)}
  .chapter__price{font-family:'Fraunces',serif;font-size:1.4rem;color:var(--gold-bright)}
  .chapter__go{font-size:.8rem;color:var(--gold);letter-spacing:.06em}
  .empty{text-align:center;color:rgba(241,233,221,.5);padding:60px 24px}
</style></head>
<body>
  <nav class="nav">
    <a href="/" class="brand" style="text-decoration:none;display:flex;align-items:center"><img src="/logo.png" alt="Ticklore — every ticket has a story" style="height:58px;width:auto;display:block"></a>
    <a href="/shop">All events</a>
  </nav>
  <main>
    <div class="head">
      <h1>Choose your chapter</h1>
      <p>Every gathering worth remembering.</p>
    </div>
    <div class="rule"></div>
    <div class="grid">
      ${cards || '<div class="empty">No events yet. Check back soon.</div>'}
    </div>
  </main>
</body></html>`;
}

// ===========================================================================
// Event page — the story, the full ticket, then buy.
// ===========================================================================
function eventPage(e, idx, stripeEnabled, demoEnabled) {
  const art = ticketSvg({ name: e.name, tier: e.tier, priceCents: e.priceCents, number: "001", chapterLabel: chapter(idx) });
  return `<!doctype html>
<html lang="en"><head>${head("Ticklore — " + e.name)}
<style>
  main{position:relative;z-index:1;max-width:1000px;margin:0 auto;padding:20px 24px 90px;
    display:grid;grid-template-columns:1fr 1fr;gap:56px;align-items:start}
  @media (max-width:820px){main{grid-template-columns:1fr;gap:34px}}
  .art{position:sticky;top:24px}
  .art svg{width:100%;height:auto;border-radius:12px;box-shadow:0 30px 70px -28px rgba(0,0,0,.8)}
  @media (max-width:820px){.art{position:static}}
  .detail__eyebrow{font-family:'IBM Plex Mono',monospace;font-size:.74rem;letter-spacing:.18em;
    text-transform:uppercase;color:var(--gold);margin-bottom:14px}
  .detail h1{font-family:'Fraunces',serif;font-weight:600;font-size:2.4rem;line-height:1.08;letter-spacing:-.02em}
  .detail__blurb{color:rgba(241,233,221,.72);font-size:1.08rem;line-height:1.65;margin-top:18px}
  .facts{margin:28px 0;border-top:1px solid var(--line);border-bottom:1px solid var(--line)}
  .fact{display:flex;justify-content:space-between;padding:13px 0;border-bottom:1px solid var(--line)}
  .fact:last-child{border-bottom:0}
  .fact__k{font-family:'IBM Plex Mono',monospace;font-size:.78rem;letter-spacing:.06em;text-transform:uppercase;color:var(--sage)}
  .fact__v{color:var(--parchment);font-size:.98rem}
  .price-row{display:flex;align-items:baseline;gap:14px;margin:26px 0 18px}
  .price-row .amt{font-family:'Fraunces',serif;font-size:2.2rem;color:var(--gold-bright)}
  .price-row .per{color:rgba(241,233,221,.5);font-size:.9rem}
  .buy-big{width:100%;font-size:1.05rem;padding:16px}
  .assure{margin-top:14px;font-size:.85rem;color:rgba(241,233,221,.5);text-align:center}
  .back{display:inline-block;margin-bottom:8px;font-size:.85rem;color:rgba(241,233,221,.6);text-decoration:none}
  .back:hover{color:var(--parchment)}
</style></head>
<body>
  <nav class="nav">
    <a href="/" class="brand" style="text-decoration:none;display:flex;align-items:center"><img src="/logo.png" alt="Ticklore — every ticket has a story" style="height:58px;width:auto;display:block"></a>
    <a href="/shop">← All events</a>
  </nav>
  <main>
    <div class="art">${art}</div>
    <div class="detail">
      <a href="/shop" class="back">← Back to events</a>
      <div class="detail__eyebrow">Chapter ${chapter(idx)} · ${formatDate(e.date)}</div>
      <h1>${esc(e.name)}</h1>
      ${e.blurb ? `<p class="detail__blurb">${esc(e.blurb)}</p>` : ""}
      <div class="facts">
        <div class="fact"><span class="fact__k">Date</span><span class="fact__v">${formatDate(e.date)}</span></div>
        <div class="fact"><span class="fact__k">Admission</span><span class="fact__v">${esc(e.tier)}</span></div>
        <div class="fact"><span class="fact__k">Keepsake</span><span class="fact__v">One-of-one, yours forever</span></div>
        ${e.nonTransferable ? `<div class="fact"><span class="fact__k">Transfer</span><span class="fact__v">Non-transferable</span></div>` : ""}
      </div>
      <div class="price-row">
        <span class="amt">${money(e.priceCents)}</span>
        <span class="per">per keepsake ticket</span>
      </div>
      <button class="btn buy-big" id="buy" onclick="buy(${esc(JSON.stringify(e.key))}, ${esc(JSON.stringify(e.name))}, this)">Begin this chapter</button>
      <div class="assure">Pay by card. No wallet or crypto required — your ticket is held for you.</div>
    </div>
  </main>
  <script>${purchaseScript(stripeEnabled, demoEnabled)}</script>
</body></html>`;
}

// ===========================================================================
// 404
// ===========================================================================
function notFoundPage() {
  return `<!doctype html>
<html lang="en"><head>${head("Ticklore — Not found")}</head>
<body>
  <nav class="nav"><a href="/" class="brand" style="text-decoration:none;display:flex;align-items:center"><img src="/logo.png" alt="Ticklore — every ticket has a story" style="height:58px;width:auto;display:block"></a><a href="/shop">All events</a></nav>
  <div style="position:relative;z-index:1;text-align:center;padding:120px 24px">
    <div style="font-family:'Fraunces',serif;font-style:italic;font-size:1.6rem;color:var(--gold-bright);margin-bottom:12px">This chapter hasn't been written.</div>
    <p style="color:rgba(241,233,221,.6);margin-bottom:26px">We couldn't find that event.</p>
    <a href="/shop" class="btn">Browse events</a>
  </div>
</body></html>`;
}

module.exports = { mountStorefront };
