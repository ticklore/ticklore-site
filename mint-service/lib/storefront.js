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
  app.post("/demo-buy", express.json(), async (req, res) => {
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
}

function money(cents) {
  return cents === 0 ? "Free" : "$" + (cents / 100).toFixed(2).replace(/\.00$/, "");
}

function formatDate(iso) {
  const d = new Date(iso + "T12:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
}

function shopPage(events, stripeEnabled, demoEnabled) {
  const cards = events.map((e, i) => {
    const chapter = ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][i] || String(i + 1);
    return `
      <article class="chapter" style="--stagger:${i}">
        <div class="chapter__spine"></div>
        <div class="chapter__body">
          <div class="chapter__eyebrow mono">CHAPTER ${chapter} · ${formatDate(e.date)}</div>
          <h2 class="chapter__title">${escapeHtml(e.name)}</h2>
          <p class="chapter__blurb">${escapeHtml(e.blurb)}</p>
          <div class="chapter__foot">
            <div class="chapter__meta">
              <span class="chapter__tier mono">${escapeHtml(e.tier)}</span>
              <span class="chapter__price">${money(e.priceCents)}</span>
            </div>
            <button class="buy" data-key="${e.key}" data-name="${escapeHtml(e.name)}">
              Begin this chapter
            </button>
          </div>
        </div>
      </article>`;
  }).join("");

  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticklore — Choose your chapter</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&family=IBM+Plex+Mono:wght@400;500&family=Work+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{
    --ink:#0E262B; --ink-deep:#081619; --parchment:#F1E9DD;
    --gold:#C9A227; --gold-bright:#E3C25E; --teal:#2FAF93; --sage:#7FB3A6;
    --line:rgba(241,233,221,.12);
  }
  *{margin:0;padding:0;box-sizing:border-box}
  html{scroll-behavior:smooth}
  body{
    background:var(--ink); color:var(--parchment);
    font-family:'Work Sans',sans-serif; line-height:1.55;
    -webkit-font-smoothing:antialiased;
  }
  .mono{font-family:'IBM Plex Mono',monospace}

  /* ambient: faint paper grain via layered radial glows */
  body::before{
    content:''; position:fixed; inset:0; pointer-events:none; z-index:0;
    background:
      radial-gradient(1200px 600px at 15% -10%, rgba(47,175,147,.06), transparent 60%),
      radial-gradient(900px 500px at 110% 10%, rgba(201,162,39,.05), transparent 55%);
  }
  .wrap{position:relative; z-index:1; max-width:840px; margin:0 auto; padding:0 24px}

  header{padding:80px 24px 40px; text-align:center; max-width:840px; margin:0 auto}
  .brand{font-family:'Fraunces',serif; font-size:2rem; font-weight:600; letter-spacing:-.01em}
  .brand em{font-style:italic; color:var(--gold-bright)}
  .tagline{font-family:'Fraunces',serif; font-style:italic; color:var(--gold-bright); font-size:1.05rem; margin-top:4px}
  .lede{max-width:520px; margin:26px auto 0; color:rgba(241,233,221,.66); font-size:1.02rem}

  .rule{height:1px; max-width:840px; margin:44px auto 8px;
    background:repeating-linear-gradient(to right,var(--line) 0 7px,transparent 7px 15px)}

  main{padding:16px 0 100px}

  /* the signature element: an actual book chapter, spine and all */
  .chapter{
    display:flex; background:linear-gradient(135deg,#123138 0%,#0d262c 60%,#0a1e23 100%);
    border:1px solid rgba(227,194,94,.16); border-radius:10px; overflow:hidden;
    margin:20px 0; box-shadow:0 24px 50px -28px rgba(0,0,0,.75);
    opacity:0; transform:translateY(16px);
    animation:rise .7s cubic-bezier(.2,.8,.2,1) forwards;
    animation-delay:calc(var(--stagger) * .12s + .1s);
  }
  @keyframes rise{to{opacity:1; transform:translateY(0)}}
  @media (prefers-reduced-motion:reduce){
    .chapter{animation:none; opacity:1; transform:none}
  }
  .chapter__spine{width:6px; flex:0 0 6px; background:linear-gradient(to bottom,var(--teal),var(--gold))}
  .chapter__body{padding:30px 34px; flex:1}
  .chapter__eyebrow{font-size:.7rem; letter-spacing:.16em; color:var(--gold); margin-bottom:12px}
  .chapter__title{font-family:'Fraunces',serif; font-weight:600; font-size:1.85rem; line-height:1.08; letter-spacing:-.015em}
  .chapter__blurb{color:rgba(241,233,221,.62); margin-top:10px; max-width:46ch; font-size:.98rem}
  .chapter__foot{display:flex; align-items:flex-end; justify-content:space-between; gap:20px; margin-top:26px; flex-wrap:wrap}
  .chapter__meta{display:flex; align-items:baseline; gap:16px}
  .chapter__tier{font-size:.72rem; letter-spacing:.09em; color:var(--sage)}
  .chapter__price{font-family:'Fraunces',serif; font-size:1.5rem; color:var(--gold-bright)}

  .buy{
    font-family:'Work Sans',sans-serif; font-size:.92rem; font-weight:500;
    background:var(--gold); color:var(--ink-deep); border:0; border-radius:4px;
    padding:12px 22px; cursor:pointer; transition:background .18s,transform .18s;
    white-space:nowrap;
  }
  .buy:hover{background:var(--gold-bright); transform:translateY(-1px)}
  .buy:focus-visible{outline:2px solid var(--gold-bright); outline-offset:3px}
  .buy:disabled{opacity:.6; cursor:wait; transform:none}

  footer{text-align:center; padding:0 24px 70px; color:rgba(241,233,221,.4); font-size:.82rem}

  /* purchase overlay */
  .overlay{
    position:fixed; inset:0; z-index:20; display:none;
    background:rgba(8,22,25,.86); backdrop-filter:blur(4px);
    align-items:center; justify-content:center; padding:24px;
  }
  .overlay.on{display:flex}
  .panel{
    background:linear-gradient(135deg,#123138,#0a1e23); border:1px solid rgba(227,194,94,.2);
    border-radius:12px; padding:40px; max-width:520px; width:100%; text-align:center;
    box-shadow:0 40px 80px -24px rgba(0,0,0,.8);
  }
  .panel h3{font-family:'Fraunces',serif; font-weight:600; font-size:1.5rem; margin-bottom:6px}
  .panel .status{color:var(--sage); min-height:1.4em; margin-bottom:18px; font-size:.95rem}
  .panel img{max-width:100%; border-radius:8px; box-shadow:0 20px 40px -16px rgba(0,0,0,.7)}
  .panel .sub{color:rgba(241,233,221,.55); font-size:.85rem; margin-top:16px}
  .panel .close{margin-top:22px; background:none; border:1px solid var(--line); color:var(--parchment);
    padding:9px 20px; border-radius:4px; cursor:pointer; font-family:'Work Sans',sans-serif; font-size:.85rem}
  .panel .close:hover{border-color:var(--gold)}
</style></head>
<body>
<header>
  <div class="brand">Tick<em>lore</em></div>
  <div class="tagline">Every ticket has a story.</div>
  <p class="lede">Choose a gathering below. Your ticket is minted the moment you begin — a permanent first chapter that stays yours long after the night is over.</p>
</header>

<div class="rule"></div>

<main class="wrap">
  ${cards}
</main>

<footer>
  A concept preview. ${demoEnabled ? "Demo mode — tickets mint instantly, no payment." : "Checkout is handled securely by Stripe."}
</footer>

<div class="overlay" id="overlay">
  <div class="panel">
    <h3 id="p-title">Writing your chapter…</h3>
    <div class="status" id="p-status">Minting on Base…</div>
    <div id="p-art"></div>
    <div class="sub" id="p-sub"></div>
    <button class="close" id="p-close" onclick="closeOverlay()" style="display:none">Close</button>
  </div>
</div>

<script>
  var STRIPE = ${stripeEnabled ? "true" : "false"};
  var DEMO = ${demoEnabled ? "true" : "false"};
  var overlay = document.getElementById('overlay');

  function openOverlay(name){
    document.getElementById('p-title').textContent = 'Writing your chapter…';
    document.getElementById('p-status').textContent = 'Minting “' + name + '” on Base…';
    document.getElementById('p-art').innerHTML = '';
    document.getElementById('p-sub').textContent = '';
    document.getElementById('p-close').style.display = 'none';
    overlay.classList.add('on');
  }
  function closeOverlay(){ overlay.classList.remove('on'); }

  document.querySelectorAll('.buy').forEach(function(btn){
    btn.addEventListener('click', function(){
      var key = btn.dataset.key, name = btn.dataset.name;

      // Prefer real Stripe checkout when it's configured.
      if (STRIPE) {
        btn.disabled = true; btn.textContent = 'Opening checkout…';
        fetch('/checkout', {method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({eventKey:key})})
          .then(function(r){return r.json()})
          .then(function(d){
            if (d.url) { window.location = d.url; }
            else { btn.disabled=false; btn.textContent='Begin this chapter'; alert(d.error||'Could not start checkout'); }
          })
          .catch(function(){ btn.disabled=false; btn.textContent='Begin this chapter'; });
        return;
      }

      // Demo fallback: mint directly, show the ticket.
      if (DEMO) {
        openOverlay(name);
        fetch('/demo-buy', {method:'POST', headers:{'Content-Type':'application/json'},
          body: JSON.stringify({eventKey:key})})
          .then(function(r){return r.json()})
          .then(function(d){
            if (!d.ok) throw new Error(d.error||'Mint failed');
            document.getElementById('p-title').textContent = 'Chapter One is written.';
            document.getElementById('p-status').textContent = '';
            var img = new Image(); img.src = '/ticket/'+d.ticketId+'/image';
            document.getElementById('p-art').appendChild(img);
            document.getElementById('p-sub').textContent =
              'Ticket #'+d.ticketId+' — held for you. No wallet required.';
            document.getElementById('p-close').style.display = 'inline-block';
          })
          .catch(function(err){
            document.getElementById('p-title').textContent = 'That chapter didn’t take.';
            document.getElementById('p-status').textContent = err.message;
            document.getElementById('p-close').style.display = 'inline-block';
          });
        return;
      }

      alert('Buying is not configured. Set up Stripe or enable demo mode.');
    });
  });

  overlay.addEventListener('click', function(e){ if(e.target===overlay) closeOverlay(); });
  document.addEventListener('keydown', function(e){ if(e.key==='Escape') closeOverlay(); });
</script>
</body></html>`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, function (c) {
    return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
  });
}

module.exports = { mountStorefront };
