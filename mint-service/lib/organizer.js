/**
 * lib/organizer.js — the organizer side. Create an event, see it as a ticket,
 * publish it to the shop.
 *
 * Gated by a single shared password (ORGANIZER_PASSWORD). That is deliberately
 * modest: enough to keep the create page from being wide open during a
 * hand-held pilot, not a real accounts system. When Ticklore has many
 * organizers, this becomes proper auth — the gate is isolated here so that
 * swap is contained.
 */

const express = require("express");
const crypto = require("crypto");
const events = require("./events");
const ticklorev2 = require("./ticklore-v2");
const ticklorev3 = require("./ticklore-v3");
const ticklorev4 = require("./ticklore-v4");
const ticklorev5 = require("./ticklore-v5");
const ticklorev6 = require("./ticklore-v6");

function mountOrganizer(app, { chain, chainV2, chainV3, chainV4, chainV5, chainV6 }) {
  const PASSWORD = process.env.ORGANIZER_PASSWORD;

  /** Timing-safe password check. The password rides in a header set by the
   *  page's own fetch, not in the URL, so it never lands in logs or history. */
  function checkPassword(req, res, next) {
    if (!PASSWORD) {
      return res.status(500).json({ error: "Organizer access is not configured (ORGANIZER_PASSWORD unset)." });
    }
    const given = req.get("x-organizer-password") || "";
    const a = Buffer.from(given), b = Buffer.from(PASSWORD);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: "Wrong password." });
    }
    next();
  }

  /** Publish a new event. When the V2 contract is configured, the event is
   *  created ON-CHAIN first (the organizer/minter becomes its on-chain organizer)
   *  and the returned eventId is stored on the event record. Without V2 configured
   *  (the current V1 demo), this is unchanged — a local event only. */
  app.post("/organize/publish", express.json(), checkPassword, async (req, res) => {
    try {
      let onChainEventId = null;
      // Prefer the newest configured event-model contract; older versions are
      // the fallback chain until the next flip.
      const activeChain = chainV6 || chainV5 || chainV4 || chainV3 || chainV2;
      const activeLib = chainV6 ? ticklorev6 : (chainV5 ? ticklorev5 : (chainV4 ? ticklorev4 : (chainV3 ? ticklorev3 : ticklorev2)));
      const onChainVersion = chainV6 ? 6 : (chainV5 ? 5 : (chainV4 ? 4 : (chainV3 ? 3 : (chainV2 ? 2 : null))));
      if (activeChain) {
        const ev = await activeLib.createEvent(activeChain.contract, req.body);
        onChainEventId = ev.eventId;
      }
      const { key } = events.create({ ...req.body, onChainEventId, onChainVersion });
      res.json({ ok: true, key, eventId: onChainEventId });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  /** List existing events (for the organizer's own view). */
  app.get("/organize/events", checkPassword, (req, res) => {
    res.json({ events: events.list() });
  });

  /** Delete an organizer-created event. Seed events aren't in the store, so
   *  they can't be removed here — only events an organizer published. */
  app.post("/organize/delete", express.json(), checkPassword, (req, res) => {
    const key = (req.body && req.body.key) || "";
    if (!key) return res.status(400).json({ ok: false, error: "Missing event key." });
    const removed = events.remove(key);
    if (!removed) return res.status(404).json({ ok: false, error: "No such event — it may already be deleted." });
    res.json({ ok: true, key });
  });

  /** The create-event page. The password gate is handled client-side: the page
   *  loads, asks for the password, and holds it only in memory for the session. */
  app.get("/organize", (req, res) => {
    res.type("html").send(organizerPage());
  });
}

function organizerPage() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticklore — Create an event</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&family=IBM+Plex+Mono:wght@400;500&family=Work+Sans:wght@400;500&display=swap" rel="stylesheet">
${require("./ui").LOCKUP_FONT_LINK}
<style>
${require("./ui").LOCKUP_CSS}
  :root{
    --ink:#0E262B; --ink-deep:#081619; --parchment:#F1E9DD;
    --gold:#C9A227; --gold-bright:#E3C25E; --teal:#2FAF93; --sage:#7FB3A6;
    --line:rgba(241,233,221,.14); --field:rgba(241,233,221,.05);
  }
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--ink);color:var(--parchment);font-family:'Work Sans',sans-serif;line-height:1.5}
  .mono{font-family:'IBM Plex Mono',monospace}

  /* password gate */
  .gate{position:fixed;inset:0;background:var(--ink-deep);z-index:50;
    display:flex;align-items:center;justify-content:center;padding:24px}
  .gate.hidden{display:none}
  .gate__box{max-width:380px;width:100%;text-align:center}
  .gate h1{font-family:'Fraunces',serif;font-weight:600;font-size:1.6rem;margin-bottom:6px}
  .gate p{color:rgba(241,233,221,.6);font-size:.92rem;margin-bottom:22px}
  .gate input{width:100%;background:var(--field);border:1px solid var(--line);color:var(--parchment);
    padding:13px 15px;border-radius:6px;font-size:1rem;text-align:center;margin-bottom:12px}
  .gate button{width:100%;background:var(--gold);color:var(--ink-deep);border:0;border-radius:6px;
    padding:13px;font-weight:600;font-size:.95rem;cursor:pointer}
  .gate .err{color:#E38A8A;font-size:.85rem;min-height:1.2em;margin-top:8px}

  header{padding:48px 24px 12px;text-align:center}
  .brand{font-family:'Fraunces',serif;font-size:1.7rem;font-weight:600}
  .brand em{font-style:italic;color:var(--gold-bright)}
  .sub{color:rgba(241,233,221,.6);margin-top:4px;font-size:.95rem}

  .layout{max-width:1000px;margin:0 auto;padding:24px;display:grid;grid-template-columns:1fr 1fr;gap:40px}
  @media (max-width:820px){.layout{grid-template-columns:1fr;gap:28px}}

  .field{margin-bottom:18px}
  label{display:block;font-size:.8rem;letter-spacing:.04em;color:var(--sage);margin-bottom:6px;text-transform:uppercase}
  .mono-label{font-family:'IBM Plex Mono',monospace}
  input[type=text],input[type=number],input[type=date],textarea{
    width:100%;background:var(--field);border:1px solid var(--line);color:var(--parchment);
    padding:11px 14px;border-radius:6px;font-size:.98rem;font-family:'Work Sans',sans-serif}
  input:focus,textarea:focus{outline:none;border-color:var(--gold)}
  textarea{resize:vertical;min-height:64px}
  select{width:100%;background:var(--field);border:1px solid var(--line);color:var(--parchment);
    padding:11px 14px;border-radius:6px;font-size:.98rem;font-family:'Work Sans',sans-serif;cursor:pointer}
  select:focus{outline:none;border-color:var(--gold)}
  select option{background:#0b1c20;color:var(--parchment)}
  .section-label{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:.16em;
    text-transform:uppercase;color:var(--gold);margin:26px 0 12px;padding-top:18px;
    border-top:1px solid var(--line)}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .hint{font-size:.78rem;color:rgba(241,233,221,.45);margin-top:5px}

  .toggle{display:flex;align-items:center;gap:10px;margin-top:6px;cursor:pointer;user-select:none}
  .toggle input{width:auto}
  .toggle span{font-size:.9rem;color:rgba(241,233,221,.8)}

  .publish{width:100%;background:var(--gold);color:var(--ink-deep);border:0;border-radius:6px;
    padding:14px;font-weight:600;font-size:1rem;cursor:pointer;margin-top:8px;transition:background .18s}
  .publish:hover{background:var(--gold-bright)}
  .publish:disabled{opacity:.6;cursor:wait}
  .result{margin-top:16px;font-size:.9rem;min-height:1.2em}
  .result a{color:var(--gold-bright)}
  .result.err{color:#E38A8A}

  /* live preview */
  .preview-col{position:sticky;top:24px;align-self:start}
  .preview-label{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:.14em;
    text-transform:uppercase;color:var(--gold);margin-bottom:14px;text-align:center}
  #preview svg{width:100%;height:auto;border-radius:10px;box-shadow:0 24px 50px -24px rgba(0,0,0,.7)}
  .preview-note{text-align:center;font-size:.8rem;color:rgba(241,233,221,.45);margin-top:14px}

  /* manage existing events */
  .manage{max-width:1000px;margin:8px auto 64px;padding:0 24px;display:none}
  .manage__head{display:flex;align-items:baseline;justify-content:space-between;gap:14px;
    border-top:1px solid var(--line);padding-top:26px;margin-bottom:16px}
  .manage__head h2{font-family:'Fraunces',serif;font-weight:600;font-size:1.2rem}
  .manage__head .count{font-family:'IBM Plex Mono',monospace;font-size:.76rem;color:var(--sage)}
  .ev{display:flex;align-items:center;gap:14px;padding:12px 14px;border:1px solid var(--line);
    border-radius:8px;margin-bottom:10px;background:var(--field)}
  .ev__main{flex:1;min-width:0}
  .ev__name{font-family:'Fraunces',serif;font-size:1.02rem;margin-bottom:2px;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ev__meta{font-size:.78rem;color:rgba(241,233,221,.55);font-family:'IBM Plex Mono',monospace;
    white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .ev__view{font-size:.82rem;color:var(--gold-bright);text-decoration:none;white-space:nowrap}
  .ev__view:hover{text-decoration:underline}
  .ev__del{background:transparent;border:1px solid rgba(227,138,138,.4);color:#E38A8A;
    border-radius:6px;padding:7px 12px;font-size:.82rem;cursor:pointer;white-space:nowrap}
  .ev__del:hover{background:rgba(227,138,138,.12)}
  .ev__del:disabled{opacity:.5;cursor:wait}
  .manage__empty{color:rgba(241,233,221,.45);font-size:.9rem;padding:8px 0}
</style></head>
<body>

<div class="gate" id="gate">
  <div class="gate__box">
    <h1>Organizer access</h1>
    <p>Enter the shared password to create an event.</p>
    <input id="pw" type="password" placeholder="Password" autofocus>
    <button onclick="unlock()">Enter</button>
    <div class="err" id="gate-err"></div>
  </div>
</div>

<header>
  <a href="/" style="display:inline-block;text-decoration:none">${require("./ui").brandLockup({ size: 80 })}</a>
  <div class="sub">Create an event — see the ticket your guests will keep, then publish.</div>
</header>

<div class="layout">
  <div class="form-col">
    <div class="field">
      <label for="f-name">Event name</label>
      <input type="text" id="f-name" placeholder="The Sullivan Family Reunion" oninput="draw()">
      <div class="hint">This appears on every ticket. Ampersands and apostrophes are fine — "Mom &amp; Dad's 50th" works.</div>
    </div>

    <div class="field">
      <label for="f-venue">Venue</label>
      <input type="text" id="f-venue" placeholder="Lynchburg, VA" maxlength="60" oninput="draw()">
      <div class="hint">Where it happened. Appears on the keepsake.</div>
    </div>

    <div class="row">
      <div class="field">
        <label for="f-tier">Tier / role</label>
        <input type="text" id="f-tier" placeholder="General Admission" oninput="draw()">
      </div>
      <div class="field">
        <label for="f-price">Price (USD)</label>
        <input type="number" id="f-price" placeholder="25" min="0" step="1" oninput="draw()">
        <div class="hint">Enter 0 for a free event.</div>
        <label class="toggle" style="margin-top:10px">
          <input type="checkbox" id="f-showprice" checked>
          <span>Show the price on the keepsake</span>
        </label>
        <div class="hint">On: the true price ($25 / Free) is part of the memory. Off: no price appears — right for gifts and sponsored seats.</div>
      </div>
    </div>

    <div class="row">
      <div class="field">
        <label for="f-date">Event date</label>
        <input type="date" id="f-date" oninput="draw()">
      </div>
      <div class="field">
        <label for="f-unlock">Transfer unlock (days after)</label>
        <input type="number" id="f-unlock" placeholder="30" min="30" step="1" value="30">
        <div class="hint">Minimum 30. Tickets can't be resold until then.</div>
      </div>
    </div>

    <div class="field">
      <label for="f-blurb">Short description</label>
      <textarea id="f-blurb" placeholder="Forty-two Sullivans, one warm July afternoon in Lynchburg." maxlength="200"></textarea>
    </div>

    <div class="field">
      <label class="toggle">
        <input type="checkbox" id="f-nontransfer">
        <span>Permanently non-transferable (for private or sensitive events)</span>
      </label>
    </div>

    <div class="section-label">Sponsor credit — optional</div>
    <div class="row">
      <div class="field">
        <label for="f-sponsor-label">Lead-in</label>
        <input type="text" id="f-sponsor-label" placeholder="Supported by" maxlength="28" oninput="draw()">
        <div class="hint">e.g. "Supported by", "In honor of", "Brought to you by".</div>
      </div>
      <div class="field">
        <label for="f-sponsor-name">Sponsor name</label>
        <input type="text" id="f-sponsor-name" placeholder="The Acme Foundation" maxlength="44" oninput="draw()">
        <div class="hint">One graceful line, engraved on every ticket forever. Leave blank for none.</div>
      </div>
    </div>

    <div class="section-label">Ticket design</div>
    <div class="row">
      <div class="field">
        <label for="f-palette">Color</label>
        <select id="f-palette" onchange="draw()"></select>
      </div>
      <div class="field">
        <label for="f-style">Style</label>
        <select id="f-style" onchange="draw()"></select>
      </div>
    </div>

    <div class="section-label">Buyer keepsake</div>
    <div class="field">
      <label class="toggle">
        <input type="checkbox" id="f-allow-inscription">
        <span>Let buyers add their name + a memorable line to their ticket</span>
      </label>
      <div class="hint">Off by default. Great for reunions, galas and benefits; leave it off where it could get out of hand.</div>
    </div>

    <div class="section-label">Transfer</div>
    <div class="field">
      <label class="toggle">
        <input type="checkbox" id="f-soulbound">
        <span>Permanently non-transferable (soulbound)</span>
      </label>
      <div class="hint">Off = standard 10-day anti-scalp lock, then free to move as a keepsake. On = bound to the buyer forever.</div>
    </div>

    <button class="publish" id="publish" onclick="publish()">Publish event</button>
    <div class="result" id="result"></div>
  </div>

  <div class="preview-col">
    <div class="preview-label">Live preview</div>
    <div id="preview"></div>
    <div class="preview-note">A live preview of your ticket — color and style update as you type.</div>
  </div>
</div>

<section class="manage" id="manage">
  <div class="manage__head">
    <h2>Your events</h2>
    <span class="count" id="ev-count"></span>
  </div>
  <div id="ev-list"></div>
</section>

<script>
  var PW = "";

  function unlock(){
    PW = document.getElementById('pw').value;
    // Validate the password against a protected endpoint before revealing the form.
    fetch('/organize/events', { headers: { 'x-organizer-password': PW } })
      .then(function(r){
        if (r.ok) { document.getElementById('gate').classList.add('hidden'); draw(); loadEvents(); }
        else { document.getElementById('gate-err').textContent = 'Wrong password.'; }
      })
      .catch(function(){ document.getElementById('gate-err').textContent = 'Could not reach the server.'; });
  }
  document.getElementById('pw').addEventListener('keydown', function(e){ if(e.key==='Enter') unlock(); });

  function esc(s){ return String(s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]; }); }

  function money(dollars){
    var n = Number(dollars);
    if (!n || n <= 0) return 'Free';
    return '$' + n.toFixed(2).replace(/\\.00$/, '');
  }

  // Curated color palettes. Kept to generic font families (serif / monospace /
  // sans-serif) on purpose: that is what the on-chain SVG can render, so the
  // preview stays honest about the eventual keepsake.
  var PALETTES = {
    teal:     { label:'Teal & Gold',       bg:['#123138','#0d262c','#0a1e23'], accent:'#C9A227', bright:'#E3C25E', ink:'#F1E9DD', sub:'#7FB3A6' },
    midnight: { label:'Midnight & Silver',  bg:['#20283a','#161c2b','#0e121c'], accent:'#8fa3c0', bright:'#d3ddec', ink:'#F2F4F8', sub:'#8b98ac' },
    burgundy: { label:'Burgundy & Gold',    bg:['#3c1622','#290d17','#1b070d'], accent:'#C9A227', bright:'#E9C558', ink:'#F6EAE0', sub:'#c48f99' },
    forest:   { label:'Forest & Cream',     bg:['#173a2d','#0f2a1f','#0a2017'], accent:'#cdba8c', bright:'#ecdfbe', ink:'#F3EEE1', sub:'#93b4a0' },
    plum:     { label:'Plum & Rose',        bg:['#2b1a3a','#1e1129','#140b1c'], accent:'#c58fb0', bright:'#e6b9d2', ink:'#F3ECF3', sub:'#a58fb8' }
  };
  var STYLES = {
    classic: { label:'Classic — serif' },
    modern:  { label:'Modern — sans' },
    elegant: { label:'Elegant — serif italic' }
  };

  // Populate the color/style selectors from the data above.
  (function initControls(){
    var ps = document.getElementById('f-palette');
    for (var k in PALETTES){ var o = document.createElement('option'); o.value = k; o.textContent = PALETTES[k].label; ps.appendChild(o); }
    var ss = document.getElementById('f-style');
    for (var k2 in STYLES){ var o2 = document.createElement('option'); o2.value = k2; o2.textContent = STYLES[k2].label; ss.appendChild(o2); }
  })();

  // Parametric ticket art. Mirrors the on-chain layout closely; three layouts,
  // any palette, plus an optional single graceful sponsor credit line.
  function ticketPreviewSVG(o){
    var P = PALETTES[o.palette] || PALETTES.teal;
    var rawName = o.name || 'Your event name';
    var rawTier = o.tier || 'General Admission';
    var name = esc(rawName);
    var tier = esc(rawTier);
    var price = esc(money(o.price));
    var sponsor = '';
    if (o.sponsorName){
      var raw = (o.sponsorLabel ? o.sponsorLabel + ' \\u00b7 ' : '') + o.sponsorName;
      sponsor = esc(raw.toUpperCase());
    }
    var defs = '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0" stop-color="' + P.bg[0] + '"/><stop offset="0.6" stop-color="' + P.bg[1] + '"/>'
      + '<stop offset="1" stop-color="' + P.bg[2] + '"/></linearGradient>'
      + '<linearGradient id="spine" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="' + P.bright + '"/><stop offset="1" stop-color="' + P.accent + '"/></linearGradient></defs>';
    var base = '<rect width="800" height="500" rx="18" fill="url(#bg)"/>';
    var body;
    if (o.style === 'modern'){
      body = '<rect x="0" y="0" width="800" height="8" fill="url(#spine)"/>'
        + '<rect x="26" y="26" width="748" height="448" rx="10" fill="none" stroke="' + P.accent + '" stroke-opacity="0.28"/>'
        + '<text x="56" y="90" fill="' + P.bright + '" font-family="sans-serif" font-weight="700" font-size="20" letter-spacing="10">TICKLORE</text>'
        + '<text x="56" y="252" fill="' + P.sub + '" font-family="sans-serif" font-size="16" letter-spacing="6">' + esc(rawTier.toUpperCase()) + '</text>'
        + '<text x="56" y="304" fill="' + P.ink + '" font-family="sans-serif" font-weight="700" font-size="52">' + name + '</text>'
        + (sponsor ? '<text x="56" y="402" fill="' + P.accent + '" font-family="sans-serif" font-size="15" letter-spacing="3">' + sponsor + '</text>' : '')
        + '<text x="56" y="452" fill="' + P.ink + '" font-family="sans-serif" font-weight="700" font-size="26">' + price + '</text>'
        + '<text x="744" y="452" fill="' + P.bright + '" font-family="sans-serif" font-weight="700" font-size="34" text-anchor="end">#—</text>';
    } else if (o.style === 'elegant'){
      body = '<rect x="18" y="18" width="764" height="464" rx="12" fill="none" stroke="' + P.accent + '" stroke-opacity="0.4"/>'
        + '<rect x="27" y="27" width="746" height="446" rx="9" fill="none" stroke="' + P.accent + '" stroke-opacity="0.18"/>'
        + '<text x="400" y="82" fill="' + P.bright + '" font-family="serif" font-size="20" letter-spacing="8" text-anchor="middle">TICKLORE</text>'
        + '<line x1="310" y1="102" x2="490" y2="102" stroke="' + P.accent + '" stroke-opacity="0.5"/>'
        + '<text x="400" y="252" fill="' + P.ink + '" font-family="serif" font-style="italic" font-size="52" text-anchor="middle">' + name + '</text>'
        + '<text x="400" y="294" fill="' + P.sub + '" font-family="serif" font-size="18" letter-spacing="3" text-anchor="middle">' + tier + '</text>'
        + (sponsor ? '<text x="400" y="362" fill="' + P.accent + '" font-family="serif" font-size="15" letter-spacing="2" text-anchor="middle">' + sponsor + '</text>' : '')
        + '<text x="400" y="452" fill="' + P.ink + '" font-family="serif" font-size="26" text-anchor="middle">' + price + '</text>';
    } else {
      body = '<rect x="0" y="0" width="10" height="500" rx="5" fill="url(#spine)"/>'
        + '<rect x="20" y="20" width="760" height="460" rx="12" fill="none" stroke="' + P.accent + '" stroke-opacity="0.45"/>'
        + '<text x="56" y="76" fill="' + P.bright + '" font-family="monospace" font-size="22" letter-spacing="9">TICKLORE</text>'
        + '<line x1="56" y1="96" x2="744" y2="96" stroke="' + P.accent + '" stroke-opacity="0.35"/>'
        + '<text x="56" y="222" fill="' + P.accent + '" font-family="monospace" font-size="17" letter-spacing="5">THE STORY</text>'
        + '<text x="56" y="262" fill="' + P.ink + '" font-family="Georgia, serif" font-size="46">' + name + '</text>'
        + '<text x="56" y="298" fill="' + P.sub + '" font-family="monospace" font-size="17" letter-spacing="1">' + tier + '</text>'
        + (sponsor ? '<text x="56" y="400" fill="' + P.accent + '" font-family="monospace" font-size="14" letter-spacing="3">' + sponsor + '</text>' : '')
        + '<text x="56" y="452" fill="' + P.ink + '" font-family="monospace" font-size="26">' + price + '</text>'
        + '<text x="744" y="452" fill="' + P.bright + '" font-family="Georgia, serif" font-size="40" text-anchor="end">#—</text>';
    }
    var footer = '<text x="400" y="482" fill="' + P.sub + '" font-family="monospace" font-size="11" letter-spacing="3" text-anchor="middle" opacity="0.55">EVERY TICKET HAS A STORY</text>';
    return '<svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">' + defs + base + body + footer + '</svg>';
  }

  function draw(){
    document.getElementById('preview').innerHTML = ticketPreviewSVG({
      name: document.getElementById('f-name').value,
      tier: document.getElementById('f-tier').value,
      price: document.getElementById('f-price').value,
      sponsorLabel: document.getElementById('f-sponsor-label').value,
      sponsorName: document.getElementById('f-sponsor-name').value,
      palette: document.getElementById('f-palette').value,
      style: document.getElementById('f-style').value
    });
  }

  function publish(){
    var btn = document.getElementById('publish');
    var out = document.getElementById('result');
    out.className = 'result'; out.textContent = '';
    var body = {
      name: document.getElementById('f-name').value,
      tier: document.getElementById('f-tier').value,
      priceDollars: document.getElementById('f-price').value || 0,
      date: document.getElementById('f-date').value,
      unlockDays: document.getElementById('f-unlock').value || 30,
      blurb: document.getElementById('f-blurb').value,
      sponsorLabel: document.getElementById('f-sponsor-label').value,
      sponsorName: document.getElementById('f-sponsor-name').value,
      nonTransferable: document.getElementById('f-nontransfer').checked,
      palette: document.getElementById('f-palette').value,
      style: document.getElementById('f-style').value,
      allowInscription: document.getElementById('f-allow-inscription').checked,
      venue: document.getElementById('f-venue').value,
      soulbound: document.getElementById('f-soulbound').checked,
      showPrice: document.getElementById('f-showprice').checked
    };
    btn.disabled = true; btn.textContent = 'Publishing…';
    fetch('/organize/publish', {
      method:'POST',
      headers:{'Content-Type':'application/json','x-organizer-password':PW},
      body: JSON.stringify(body)
    }).then(function(r){return r.json()}).then(function(d){
      if (d.ok){
        // Leave the button DISABLED after a success so a second click can't
        // publish the same event again. Re-arming only happens via "Create
        // another", which also clears the form.
        btn.textContent = 'Published \\u2713';
        out.className = 'result';
        out.innerHTML = 'Published. Your event is now live at <a href="/shop" target="_blank">the shop</a> — key <span class="mono">'+d.key+'</span>.'
          + ' <a href="#" onclick="resetForm();return false;">Create another &rarr;</a>';
        loadEvents();
      } else {
        // A real failure — let them fix it and retry.
        btn.disabled = false; btn.textContent = 'Publish event';
        out.className = 'result err';
        out.textContent = d.error || 'Something went wrong.';
      }
    }).catch(function(){
      btn.disabled = false; btn.textContent = 'Publish event';
      out.className = 'result err'; out.textContent = 'Could not reach the server.';
    });
  }

  // Clear the form and re-arm Publish, so making a second event is a deliberate
  // act rather than an accidental double-click.
  function resetForm(){
    ['f-name','f-venue','f-tier','f-price','f-date','f-blurb','f-sponsor-label','f-sponsor-name'].forEach(function(id){
      document.getElementById(id).value = '';
    });
    document.getElementById('f-unlock').value = '30';
    document.getElementById('f-nontransfer').checked = false;
    document.getElementById('f-allow-inscription').checked = false;
    document.getElementById('f-soulbound').checked = false;
    document.getElementById('f-showprice').checked = true;
    document.getElementById('f-palette').selectedIndex = 0;
    document.getElementById('f-style').selectedIndex = 0;
    var out = document.getElementById('result'); out.textContent = ''; out.className = 'result';
    var btn = document.getElementById('publish'); btn.disabled = false; btn.textContent = 'Publish event';
    draw();
  }

  // ---- Manage existing events (list + delete) --------------------------------
  function fmtMoney(cents){
    var n = Number(cents);
    if (!n || n <= 0) return 'Free';
    return '$' + (n/100).toFixed(2).replace(/\\.00$/, '');
  }

  function loadEvents(){
    var list = document.getElementById('ev-list');
    var count = document.getElementById('ev-count');
    fetch('/organize/events', { headers: { 'x-organizer-password': PW } })
      .then(function(r){ return r.ok ? r.json() : { events: [] }; })
      .then(function(d){
        var evs = d.events || [];
        document.getElementById('manage').style.display = 'block';
        count.textContent = evs.length + (evs.length === 1 ? ' event' : ' events');
        if (!evs.length){
          list.innerHTML = '<div class="manage__empty">No events yet. Publish one above and it shows up here.</div>';
          return;
        }
        // Data goes into escaped data-* attributes; a delegated click handler
        // reads them, so there is no user text inside an onclick attribute.
        list.innerHTML = evs.map(function(e){
          return '<div class="ev" data-key="' + esc(e.key) + '" data-name="' + esc(e.name) + '">'
            + '<div class="ev__main">'
            +   '<div class="ev__name">' + esc(e.name) + '</div>'
            +   '<div class="ev__meta">' + esc(e.date || '') + ' &middot; ' + esc(fmtMoney(e.priceCents)) + ' &middot; ' + esc(e.key) + '</div>'
            + '</div>'
            + '<a class="ev__view" href="/event/' + encodeURIComponent(e.key) + '" target="_blank">View &rarr;</a>'
            + '<button class="ev__del" type="button">Delete</button>'
            + '</div>';
        }).join('');
      })
      .catch(function(){ /* leave the list as-is on a transient error */ });
  }

  document.getElementById('ev-list').addEventListener('click', function(ev){
    var btn = ev.target.closest('.ev__del');
    if (!btn) return;
    var row = btn.closest('.ev');
    var key = row.getAttribute('data-key');
    var name = row.getAttribute('data-name');
    if (!confirm('Delete "' + name + '"? It disappears from the shop. Tickets already minted are unaffected.')) return;
    btn.disabled = true; btn.textContent = 'Deleting…';
    fetch('/organize/delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-organizer-password': PW },
      body: JSON.stringify({ key: key })
    }).then(function(r){ return r.json(); }).then(function(d){
      if (d.ok){ loadEvents(); }
      else { btn.disabled = false; btn.textContent = 'Delete'; alert(d.error || 'Could not delete.'); }
    }).catch(function(){
      btn.disabled = false; btn.textContent = 'Delete'; alert('Could not reach the server.');
    });
  });
</script>
</body></html>`;
}

module.exports = { mountOrganizer };
