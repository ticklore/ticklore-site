/**
 * lib/wallet.js — the attendee keepsake wallet (PWA).
 *
 * This is the app: a phone-first, installable wallet that holds a person's
 * tickets as keepsakes and presses open toward each event's memory vault.
 *
 * WHAT'S REAL vs STUBBED (2026-07-26, first build):
 *   - Real:   the wallet UI, the keepsake rendering, the wallet→vault flow,
 *             installability (manifest + service worker).
 *   - Stubbed: the tickets shown are sample events, and the vault is a
 *             "coming soon" placeholder. The real wallet lists the SIGNED-IN
 *             holder's own tickets (email magic-link → email→tickets), and the
 *             vault shows organizer-shared memories from durable storage.
 *             Those land behind this UI without changing it.
 */

const { head, ticketSvg, money, formatDate, esc } = require("./ui");
const { listEvents } = require("./stripe-routes");

function mountWallet(app, { chain }) {
  app.get("/wallet", (req, res) => {
    res.type("html").send(walletPage(listEvents()));
  });

  app.get("/vault/:key", (req, res) => {
    const events = listEvents();
    const e = events.find((x) => x.key === req.params.key) || events[0] || { name: "Your event", date: "" };
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

function walletPage(events) {
  const cards = events.map((e, i) => `
    <a class="keep" href="/vault/${esc(e.key)}">
      <div class="keep__art">${ticketSvg({ name: e.name, tier: e.tier, priceCents: e.priceCents, number: String(i + 1).padStart(3, "0") })}</div>
      <div class="keep__foot">
        <div class="keep__meta">
          <div class="keep__name">${esc(e.name)}</div>
          <div class="keep__date">${e.date ? formatDate(e.date) : ""}</div>
        </div>
        <span class="keep__go">Open vault →</span>
      </div>
    </a>`).join("");

  return `<!doctype html>
<html lang="en"><head>${head("Your Keepsakes — Ticklore")}
<link rel="manifest" href="/manifest.webmanifest">
<meta name="theme-color" content="#0E262B">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<style>
  *{box-sizing:border-box}
  html,body{background:var(--ink);overflow-x:hidden;max-width:100%}
  .keep__art{width:100%;aspect-ratio:800/500;overflow:hidden}
  .keep__art svg{display:block;width:100%;height:100%}
  .wal__head{position:sticky;top:0;z-index:5;display:flex;align-items:center;justify-content:space-between;
    padding:15px 20px;background:linear-gradient(var(--ink),rgba(14,38,43,.82));backdrop-filter:blur(8px);
    border-bottom:1px solid var(--line)}
  .wal__brand{display:flex;align-items:center;gap:10px}
  .wal__brand img{height:34px;width:auto;display:block}
  .wal__title{font-family:'Fraunces',serif;font-weight:600;font-size:1.02rem}
  .wal__count{font-family:'IBM Plex Mono',monospace;font-size:.68rem;letter-spacing:.14em;
    text-transform:uppercase;color:var(--sage)}
  .wal{max-width:460px;margin:0 auto;padding:18px 16px 70px;display:flex;flex-direction:column;gap:22px}
  .wal__lede{font-family:'Fraunces',serif;font-style:italic;color:var(--gold-bright);font-size:1rem;
    text-align:center;margin:4px 0 6px}
  .keep{display:block;text-decoration:none;color:inherit;border-radius:16px;overflow:hidden;
    border:1px solid var(--line);background:rgba(241,233,221,.02);
    box-shadow:0 18px 40px -26px rgba(0,0,0,.8);transition:transform .14s ease}
  .keep:active{transform:scale(.985)}
  .keep__art svg{display:block;width:100%;height:auto}
  .keep__foot{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:13px 16px 15px}
  .keep__name{font-family:'Fraunces',serif;font-weight:600;font-size:1.04rem;line-height:1.2}
  .keep__date{font-family:'IBM Plex Mono',monospace;font-size:.72rem;color:var(--sage);margin-top:4px}
  .keep__go{font-family:'IBM Plex Mono',monospace;font-size:.76rem;color:var(--gold-bright);white-space:nowrap}
  .wal__foot{text-align:center;color:rgba(241,233,221,.4);font-size:.78rem;margin-top:6px}
</style></head>
<body>
  <header class="wal__head">
    <div class="wal__brand"><img src="/logo.png" alt="Ticklore"></div>
    <div class="wal__count">${events.length} keepsake${events.length === 1 ? "" : "s"}</div>
  </header>
  <main class="wal">
    <div class="wal__lede">Your story, in your pocket.</div>
    ${cards}
    <div class="wal__foot">Press a keepsake to open its memory vault.</div>
  </main>
  <script>if('serviceWorker' in navigator){navigator.serviceWorker.register('/sw.js').catch(function(){});}</script>
</body></html>`;
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
