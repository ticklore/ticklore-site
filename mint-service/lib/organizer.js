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

function mountOrganizer(app, { chain }) {
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

  /** Publish a new event. */
  app.post("/organize/publish", express.json(), checkPassword, (req, res) => {
    try {
      const { key } = events.create(req.body);
      res.json({ ok: true, key });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  /** List existing events (for the organizer's own view). */
  app.get("/organize/events", checkPassword, (req, res) => {
    res.json({ events: events.list() });
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
<style>
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
  <div class="brand">Tick<em>lore</em></div>
  <div class="sub">Create an event — see the ticket your guests will keep, then publish.</div>
</header>

<div class="layout">
  <div class="form-col">
    <div class="field">
      <label for="f-name">Event name</label>
      <input type="text" id="f-name" placeholder="The Sullivan Family Reunion" oninput="draw()">
      <div class="hint">This appears on every ticket. Ampersands and apostrophes are fine — "Mom &amp; Dad's 50th" works.</div>
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

    <button class="publish" id="publish" onclick="publish()">Publish event</button>
    <div class="result" id="result"></div>
  </div>

  <div class="preview-col">
    <div class="preview-label">Live preview</div>
    <div id="preview"></div>
    <div class="preview-note">This is the exact keepsake your guests receive.</div>
  </div>
</div>

<script>
  var PW = "";

  function unlock(){
    PW = document.getElementById('pw').value;
    // Validate the password against a protected endpoint before revealing the form.
    fetch('/organize/events', { headers: { 'x-organizer-password': PW } })
      .then(function(r){
        if (r.ok) { document.getElementById('gate').classList.add('hidden'); draw(); }
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

  // A preview SVG that mirrors the on-chain art closely enough that what the
  // organizer sees is what the contract will draw.
  function draw(){
    var name = document.getElementById('f-name').value || 'Your event name';
    var tier = document.getElementById('f-tier').value || 'General Admission';
    var price = document.getElementById('f-price').value;
    var used = false;
    var svg =
      '<svg viewBox="0 0 800 500" xmlns="http://www.w3.org/2000/svg">'
      + '<defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">'
      + '<stop offset="0" stop-color="#123138"/><stop offset="0.6" stop-color="#0d262c"/>'
      + '<stop offset="1" stop-color="#0a1e23"/></linearGradient></defs>'
      + '<rect width="800" height="500" rx="18" fill="url(#bg)"/>'
      + '<rect x="16" y="16" width="768" height="468" rx="12" fill="none" stroke="#C9A227" stroke-opacity="0.5"/>'
      + '<text x="52" y="72" fill="#E3C25E" font-family="monospace" font-size="24" letter-spacing="8">TICKLORE</text>'
      + '<line x1="52" y1="92" x2="748" y2="92" stroke="#C9A227" stroke-opacity="0.4"/>'
      + '<text x="52" y="228" fill="#C9A227" font-family="monospace" font-size="18" letter-spacing="4">CHAPTER</text>'
      + '<text x="52" y="258" fill="#F1E9DD" font-family="Georgia, serif" font-size="46">' + esc(name) + '</text>'
      + '<text x="52" y="296" fill="#7FB3A6" font-family="monospace" font-size="18" letter-spacing="1">' + esc(tier) + '</text>'
      + '<text x="52" y="452" fill="#F1E9DD" font-family="monospace" font-size="26">' + esc(money(price)) + '</text>'
      + '<text x="748" y="452" fill="#E3C25E" font-family="Georgia, serif" font-size="40" text-anchor="end">#—</text>'
      + '<text x="52" y="476" fill="#7FB3A6" font-family="monospace" font-size="12" letter-spacing="3" opacity="0.7">EVERY TICKET HAS A STORY</text>'
      + '</svg>';
    document.getElementById('preview').innerHTML = svg;
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
      nonTransferable: document.getElementById('f-nontransfer').checked
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
    ['f-name','f-tier','f-price','f-date','f-blurb'].forEach(function(id){
      document.getElementById(id).value = '';
    });
    document.getElementById('f-unlock').value = '30';
    document.getElementById('f-nontransfer').checked = false;
    var out = document.getElementById('result'); out.textContent = ''; out.className = 'result';
    var btn = document.getElementById('publish'); btn.disabled = false; btn.textContent = 'Publish event';
    draw();
  }
</script>
</body></html>`;
}

module.exports = { mountOrganizer };
