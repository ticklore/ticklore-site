/**
 * lib/wallet.js — the attendee keepsake wallet (PWA).
 *
 * This is the app: a phone-first, installable wallet that holds a person's
 * tickets as keepsakes and presses open toward each event's memory vault.
 *
 * TWO MODES (2026-07-31):
 *   - Privy configured (lib/privy.js): /wallet is REAL. Sign in with the same
 *     email OTP used at claim time and see the keepsakes you actually hold —
 *     the ones minted into YOUR embedded wallet (owned) plus older custodial
 *     claims matched by email (held for you). Art comes straight off the
 *     contract via /ticket/:id/image.
 *   - Not configured: the original sample-data showcase, unchanged, so the
 *     page is never dead in a demo.
 *
 * The vault is still a "coming soon" placeholder (Phase 2, after the contract
 * freeze — see docs/HANDOFF.md).
 */

const { head, ticketSvg, formatDate, esc } = require("./ui");
const { listEvents } = require("./stripe-routes");
const events = require("./events");
const claims = require("./claims");
const privyLib = require("./privy");

function mountWallet(app, { chain }) {
  const express = require("express");

  app.get("/wallet", (req, res) => {
    if (privyLib.config) {
      res.type("html").send(walletPrivyPage(privyLib.config));
    } else {
      res.type("html").send(walletPage(listEvents()));
    }
  });

  /** The signed-in attendee's keepsakes. Token verified server-side; matching
   *  is by the wallet address Privy vouches for (owned) or the login email
   *  (custodial claims from before Privy). */
  app.post("/wallet/tickets", express.json(), async (req, res) => {
    try {
      if (!privyLib.config) return res.status(503).json({ ok: false, error: "Wallet sign-in isn't enabled." });
      const token = String((req.body && req.body.privyToken) || "");
      if (!token) return res.status(401).json({ ok: false, error: "Sign in to see your keepsakes." });
      const who = await privyLib.walletFromToken(token);

      const tickets = claims.listByOwner({ email: who.email, address: who.address }).map((t) => {
        const e = events.get(t.eventKey) || {};
        return {
          tokenId: t.tokenId,
          eventKey: t.eventKey,
          name: e.name || "Your event",
          date: e.date || "",
          venue: e.venue || "",
          sponsorName: t.sponsorName,
          owned: t.owned,
          redeemed: !!t.redeemedAt,
          // Which contract version this token lives on — token ids collide
          // across versions, so the art URL pins it (?v=N).
          version: e.onChainVersion || null,
        };
      });
      res.json({ ok: true, address: who.address, email: who.email, tickets });
    } catch (err) {
      res.status(401).json({ ok: false, error: "Could not verify your sign-in — try again." });
    }
  });

  app.get("/vault/:key", (req, res) => {
    // events.get first: sponsor events are hidden from the public listing but
    // their holders absolutely get a vault.
    const e = events.get(req.params.key) ||
      listEvents().find((x) => x.key === req.params.key) ||
      { name: "Your event", date: "" };
    res.type("html").send(vaultPage(e));
  });

  app.get("/manifest.webmanifest", (req, res) => {
    res.type("application/manifest+json").send(JSON.stringify(MANIFEST));
  });

  app.get("/sw.js", (req, res) => {
    res.type("application/javascript").send(SERVICE_WORKER);
  });
}

const MANIFEST = {
  name: "Ticklore — Your Keepsakes",
  short_name: "Ticklore",
  start_url: "/wallet",
  scope: "/",
  display: "standalone",
  background_color: "#0E262B",
  theme_color: "#0E262B",
  icons: [{ src: "/logo.png", sizes: "895x337", type: "image/png", purpose: "any" }],
};

// Network-first with an offline fallback to whatever's cached — enough to make
// the wallet installable and survive a dropped signal once it's been opened.
const SERVICE_WORKER = `
const CACHE = 'ticklore-wallet-v1';
self.addEventListener('install', function(e){ self.skipWaiting(); });
self.addEventListener('activate', function(e){ self.clients.claim(); });
self.addEventListener('fetch', function(e){
  if (e.request.method !== 'GET') return;
  e.respondWith(
    fetch(e.request).then(function(res){
      var copy = res.clone();
      caches.open(CACHE).then(function(c){ c.put(e.request, copy); });
      return res;
    }).catch(function(){ return caches.match(e.request); })
  );
});
`;

/** Shared wallet chrome (styles + header) for both modes. */
function walletShell({ title, headerRight, body, extraScript }) {
  return `<!doctype html>
<html lang="en"><head>${head(title)}
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0E262B">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>
  *{box-sizing:border-box}
  html,body{background:var(--ink);overflow-x:hidden;max-width:100%}
  .wal__head{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;
    padding:15px 20px;background:linear-gradient(var(--ink),rgba(14,38,43,.82));backdrop-filter:blur(8px);
    border-bottom:1px solid var(--line)}
  .wal__brand img{height:34px;width:auto;display:block}
  .wal__count{font-family:'IBM Plex Mono',monospace;font-size:.68rem;letter-spacing:.14em;
    text-transform:uppercase;color:var(--sage)}
  .wal{max-width:460px;margin:0 auto;padding:18px 16px 70px;display:flex;flex-direction:column;gap:22px}
  .wal__lede{font-family:'Fraunces',serif;font-style:italic;color:var(--gold-bright);font-size:1rem;
    text-align:center;margin:4px 0 6px}
  .keep{display:block;text-decoration:none;color:inherit;border-radius:16px;overflow:hidden;
    border:1px solid var(--line);background:rgba(241,233,221,.02);
    box-shadow:0 18px 40px -26px rgba(0,0,0,.8);transition:transform .14s ease}
  .keep:active{transform:scale(.985)}
  .keep__art{width:100%;aspect-ratio:800/500;overflow:hidden}
  .keep__art svg,.keep__art img{display:block;width:100%;height:100%}
  .keep__foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 16px 15px}
  .keep__name{font-family:'Fraunces',serif;font-weight:600;font-size:1.04rem;line-height:1.2}
  .keep__date{font-family:'IBM Plex Mono',monospace;font-size:.72rem;color:var(--sage);margin-top:4px}
  .keep__go{font-family:'IBM Plex Mono',monospace;font-size:.76rem;color:var(--gold-bright);white-space:nowrap}
  .badge{display:inline-block;font-family:'IBM Plex Mono',monospace;font-size:.62rem;letter-spacing:.1em;
    text-transform:uppercase;border-radius:4px;padding:2px 7px;margin-left:8px;vertical-align:middle}
  .badge--own{color:#0E262B;background:var(--gold-bright)}
  .badge--held{color:var(--sage);border:1px solid var(--line)}
  .badge--adm{color:var(--teal);border:1px solid rgba(47,175,147,.5)}
  .wal__foot{text-align:center;color:rgba(241,233,221,.4);font-size:.78rem;margin-top:6px}
  .gatebox{max-width:380px;margin:8vh auto 0;text-align:center;padding:0 20px}
  .gatebox h1{font-family:'Fraunces',serif;font-weight:600;font-size:1.6rem;margin-bottom:6px}
  .gatebox p{color:rgba(241,233,221,.6);font-size:.92rem;margin-bottom:22px}
  .gatebox input{width:100%;background:rgba(241,233,221,.05);border:1px solid var(--line);color:var(--parchment);
    padding:13px 15px;border-radius:6px;font-size:1rem;text-align:center;margin-bottom:12px}
  .gatebox button{width:100%;background:var(--gold);color:var(--ink-deep);border:0;border-radius:6px;
    padding:13px;font-weight:600;font-size:.95rem;cursor:pointer}
  .gatebox button:disabled{opacity:.6;cursor:wait}
  .gatebox .err{color:#E38A8A;font-size:.85rem;min-height:1.2em;margin-top:8px}
  .signout{background:none;border:none;color:rgba(241,233,221,.45);font-size:.72rem;cursor:pointer;
    font-family:'IBM Plex Mono',monospace;letter-spacing:.08em;text-transform:uppercase}
</style></head>
<body>
  <header class="wal__head">
    <div class="wal__brand"><img src="/logo.png" alt="Ticklore"></div>
    ${headerRight}
  </header>
  ${body}
  <script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(function(){});}</script>
  ${extraScript || ""}
</body></html>`;
}

/** The REAL wallet — Privy sign-in, then the keepsakes this person holds. */
function walletPrivyPage(privy) {
  const body = `
  <div class="gatebox" id="gate">
    <h1>Your keepsakes</h1>
    <p>Sign in with the email you claimed with — your keepsakes are waiting.</p>
    <div id="step-email">
      <input id="email" type="email" placeholder="you@email.com" autocomplete="email">
      <button id="send" onclick="sendCode()">Send my code</button>
    </div>
    <div id="step-code" style="display:none">
      <input id="otp" type="text" inputmode="numeric" placeholder="6-digit code" autocomplete="one-time-code" maxlength="6">
      <button id="verify" onclick="verifyAndLoad()">Open my wallet</button>
    </div>
    <div class="err" id="err"></div>
  </div>
  <main class="wal" id="wal" style="display:none">
    <div class="wal__lede">Your story, in your pocket.</div>
    <div id="cards"></div>
    <div class="wal__foot">Press a keepsake to open its memory vault.</div>
    <div style="text-align:center;margin-top:10px"><button class="signout" onclick="signOut()">Sign out</button></div>
  </main>`;

  const script = `
<script src="/privy.js"></script>
<script>
  var PRIVY_CFG = ${JSON.stringify(privy)};
  var privy = null, booted = false, bootErr = null;

  (async function boot(){
    try {
      privy = new TickPrivy.Privy({ appId: PRIVY_CFG.appId, clientId: PRIVY_CFG.clientId, storage: new TickPrivy.LocalStorage() });
      if (privy.initialize) await privy.initialize();
      var f = document.createElement('iframe');
      f.src = await Promise.resolve(privy.embeddedWallet.getURL());
      f.style.display = 'none';
      document.body.appendChild(f);
      privy.setMessagePoster(f.contentWindow);
      window.addEventListener('message', function(e){ try { privy.embeddedWallet.onMessage(e.data); } catch(_){} });
      booted = true;
      // Returning visitor with a live session? Skip the gate entirely.
      try {
        var existing = await privy.user.get();
        if (existing && (existing.user || existing.id)) { await loadTickets(); }
      } catch (_) { /* no session — the gate stays */ }
    } catch (e) { bootErr = e; }
  })();

  async function sendCode(){
    var err = document.getElementById('err'); err.textContent = '';
    var email = document.getElementById('email').value.trim();
    if (!email || email.indexOf('@') < 1) { err.textContent = 'Enter a valid email.'; return; }
    if (!booted) { err.textContent = bootErr ? 'Could not start the secure wallet. Refresh and try again.' : 'One moment — still getting ready…'; return; }
    var btn = document.getElementById('send');
    btn.disabled = true; btn.textContent = 'Sending…';
    try {
      await privy.auth.email.sendCode(email);
      document.getElementById('step-email').style.display = 'none';
      document.getElementById('step-code').style.display = 'block';
      document.getElementById('otp').focus();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Send my code';
      err.textContent = 'Could not send the code — check the address and try again.';
    }
  }

  async function verifyAndLoad(){
    var err = document.getElementById('err'); err.textContent = '';
    var email = document.getElementById('email').value.trim();
    var otp = document.getElementById('otp').value.trim();
    if (otp.length < 6) { err.textContent = 'Enter the 6-digit code from your email.'; return; }
    var btn = document.getElementById('verify');
    btn.disabled = true; btn.textContent = 'Opening…';
    try {
      await privy.auth.email.loginWithCode(email, otp);
      await loadTickets();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Open my wallet';
      err.textContent = 'That code did not verify — check it and try again.';
    }
  }

  async function loadTickets(){
    var token = await privy.getAccessToken();
    var r = await fetch('/wallet/tickets', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ privyToken: token }) });
    var d = await r.json();
    if (!d.ok) { document.getElementById('err').textContent = d.error || 'Could not load your keepsakes.'; return; }
    render(d);
  }

  function escT(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  function render(d){
    document.getElementById('gate').style.display = 'none';
    var wal = document.getElementById('wal');
    wal.style.display = 'flex';
    var head = document.querySelector('.wal__head');
    var count = document.createElement('div');
    count.className = 'wal__count';
    count.textContent = d.tickets.length + ' keepsake' + (d.tickets.length === 1 ? '' : 's');
    var old = head.querySelector('.wal__count'); if (old) old.remove();
    head.appendChild(count);

    var cards = document.getElementById('cards');
    if (!d.tickets.length) {
      cards.innerHTML = '<div style="text-align:center;color:rgba(241,233,221,.55);padding:30px 10px">No keepsakes yet on this email.<br>Claim one and it appears here — permanently.</div>';
      return;
    }
    cards.innerHTML = d.tickets.map(function(t){
      var badges = (t.owned ? '<span class="badge badge--own">Yours</span>' : '<span class="badge badge--held">Held for you</span>')
        + (t.redeemed ? '<span class="badge badge--adm">Admitted</span>' : '');
      var vq = t.version ? '?v=' + t.version : '';
      return '<a class="keep" href="/vault/' + encodeURIComponent(t.eventKey) + '" style="margin-bottom:18px">'
        + '<div class="keep__art"><img src="/ticket/' + escT(t.tokenId) + '/image' + vq + '" alt="Keepsake #' + escT(t.tokenId) + '" loading="lazy"></div>'
        + '<div class="keep__foot"><div>'
        + '<div class="keep__name">' + escT(t.name) + badges + '</div>'
        + '<div class="keep__date">#' + escT(t.tokenId) + (t.date ? ' &middot; ' + escT(t.date) : '') + '</div>'
        + '</div><span class="keep__go">Open vault &rarr;</span></div></a>';
    }).join('');
  }

  function signOut(){
    // Drop only Privy's own storage keys, then reload to the gate.
    try {
      var kill = [];
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && k.toLowerCase().indexOf('privy') !== -1) kill.push(k);
      }
      kill.forEach(function(k){ localStorage.removeItem(k); });
    } catch (_) {}
    location.reload();
  }

  document.getElementById('otp').addEventListener('keydown', function(e){ if (e.key === 'Enter') verifyAndLoad(); });
  document.getElementById('email').addEventListener('keydown', function(e){ if (e.key === 'Enter') sendCode(); });
</script>`;

  return walletShell({
    title: "Your Keepsakes — Ticklore",
    headerRight: "",
    body,
    extraScript: script,
  });
}

/** The original sample-data showcase (Privy not configured). */
function walletPage(eventsList) {
  const cards = eventsList.map((e, i) => `
    <a class="keep" href="/vault/${esc(e.key)}">
      <div class="keep__art">${ticketSvg({ name: e.name, venue: e.venue, priceCents: e.priceCents, number: String(i + 1).padStart(3, "0") })}</div>
      <div class="keep__foot">
        <div class="keep__meta">
          <div class="keep__name">${esc(e.name)}</div>
          <div class="keep__date">${e.date ? formatDate(e.date) : ""}</div>
        </div>
        <span class="keep__go">Open vault →</span>
      </div>
    </a>`).join("");

  const body = `
  <main class="wal">
    <div class="wal__lede">Your story, in your pocket.</div>
    ${cards}
    <div class="wal__foot">Press a keepsake to open its memory vault.</div>
  </main>`;

  return walletShell({
    title: "Your Keepsakes — Ticklore",
    headerRight: `<div class="wal__count">${eventsList.length} keepsake${eventsList.length === 1 ? "" : "s"}</div>`,
    body,
  });
}

function vaultPage(e) {
  return `<!doctype html>
<html lang="en"><head>${head("The Vault — " + e.name)}
<meta name="theme-color" content="#081619">
<style>
  body{background:var(--ink-deep,#081619)}
  .vnav{padding:16px 20px}
  .vnav a{color:rgba(241,233,221,.7);text-decoration:none;font-size:.9rem}
  .vault{max-width:520px;margin:0 auto;padding:30px 24px 80px;text-align:center}
  .vault__tag{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:.24em;
    text-transform:uppercase;color:var(--gold);margin-bottom:14px}
  .vault__event{font-family:'Fraunces',serif;font-weight:600;font-size:2rem;line-height:1.1;margin-bottom:8px}
  .vault__date{font-family:'IBM Plex Mono',monospace;font-size:.8rem;color:var(--sage);margin-bottom:40px}
  .vault__ph{border:1px dashed var(--line);border-radius:16px;padding:44px 26px;background:rgba(241,233,221,.02)}
  .vault__ph h2{font-family:'Fraunces',serif;font-weight:600;font-size:1.2rem;margin-bottom:12px}
  .vault__ph p{color:rgba(241,233,221,.6);line-height:1.6;font-size:.98rem}
</style></head>
<body>
  <nav class="vnav"><a href="/wallet">← Your keepsakes</a></nav>
  <main class="vault">
    <div class="vault__tag">The Memory Vault</div>
    <div class="vault__event">${esc(e.name)}</div>
    <div class="vault__date">${e.date ? formatDate(e.date) : ""}</div>
    <div class="vault__ph">
      <h2>Forever, from the night itself.</h2>
      <p>Photos and memories the organizer shares from this event will live here — permanently, tied to your ticket. This is where the keepsake keeps growing. Coming next.</p>
    </div>
  </main>
</body></html>`;
}

module.exports = { mountWallet, walletPage, vaultPage };
