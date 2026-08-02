/**
 * lib/roster.js — the Serenity play: "keep your registration; send me the list."
 *
 * The organizer's registration stays exactly as it is. They export their list,
 * the admin pastes it here, and every registrant gets a claim link by email —
 * self-claim, own wallet, gated vault. Ticklore never becomes their
 * registration system; it becomes their memory.
 *
 *   paste list → codes (channel "roster": never printed, born active,
 *   idempotent by email) → "Email the unsent" button, batched — Resend's free
 *   tier caps daily sends, so a 250-person roster survives being sent across
 *   days; every click resumes where the last left off.
 *
 * Admin-only (ADMIN_PASSWORD), like every concierge surface. The pasted list
 * contains names + emails — organizer data, never rendered publicly, and it
 * rides the same backups as everything else.
 */

const express = require("express");
const crypto = require("crypto");
const events = require("./events");
const claims = require("./claims");
const email = require("./email");

function mountRoster(app) {
  const PASSWORD = process.env.ADMIN_PASSWORD;
  const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

  function checkPassword(req, res, next) {
    if (!PASSWORD) return res.status(500).json({ error: "Roster admin is not configured (ADMIN_PASSWORD unset)." });
    const given = req.get("x-admin-password") || "";
    const a = Buffer.from(given), b = Buffer.from(PASSWORD);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: "Wrong password." });
    }
    next();
  }

  /** Loose parser for pasted registration exports: one person per line;
   *  commas / semicolons / tabs; the token containing "@" is the email, the
   *  rest is the name. Quotes and header rows are tolerated and dropped. */
  function parseRoster(text) {
    const people = [];
    const invalid = [];
    const seen = new Set();
    for (const rawLine of String(text || "").split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split(/[,;\t]/).map((p) => p.trim().replace(/^["']|["']$/g, "")).filter(Boolean);
      const emailPart = parts.find((p) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p));
      if (!emailPart) { invalid.push(line.slice(0, 60)); continue; }
      const addr = emailPart.toLowerCase();
      if (seen.has(addr)) continue; // duplicate within the paste
      seen.add(addr);
      const name = parts.filter((p) => p !== emailPart).join(" ").slice(0, 60);
      people.push({ email: addr, name });
    }
    return { people, invalid };
  }

  /** Import a pasted list: parse, create codes for the new people only. */
  app.post("/admin/roster/:key/import", express.json({ limit: "2mb" }), checkPassword, (req, res) => {
    const e = events.get(req.params.key);
    if (!e || e.mode !== "sponsor") return res.status(404).json({ ok: false, error: "No such sponsor event." });
    const { people, invalid } = parseRoster((req.body || {}).list);
    if (!people.length) return res.status(400).json({ ok: false, error: "No valid rows found — one person per line, with an email.", invalid });
    const dollars = Number((req.body || {}).priceDollars) || 0;
    if (dollars < 0 || dollars > 100000) return res.status(400).json({ ok: false, error: "That price doesn't look right." });
    const { created, skipped } = claims.importRoster(req.params.key, people, { priceCents: Math.round(dollars * 100) });
    res.json({ ok: true, created: created.length, skippedExisting: skipped, invalid });
  });

  /** Send claim links to roster codes that haven't been emailed yet. Batched
   *  (default 80 per click) and sequential, so provider rate/day limits are
   *  respected and every click resumes where the last stopped. */
  app.post("/admin/roster/:key/email", express.json(), checkPassword, async (req, res) => {
    const e = events.get(req.params.key);
    if (!e) return res.status(404).json({ ok: false, error: "No such event." });
    const limit = Math.min(Math.max(1, Number((req.body || {}).limit) || 80), 100);
    const unsent = claims.listRoster(req.params.key).filter((c) => !c.emailSentAt && c.status === "unclaimed");
    let sent = 0, failed = 0;
    let lastReason = null;
    for (const c of unsent.slice(0, limit)) {
      const r = await email.sendRosterEmail({
        to: c.assignedTo,
        eventName: e.name,
        claimUrl: `${PUBLIC_URL}/claim/${c.code}`,
      }).catch((err) => ({ sent: false, reason: err.message }));
      if (r.sent) { claims.markEmailed(c.code); sent++; }
      else { failed++; lastReason = r.reason; if (/not set/i.test(String(r.reason))) break; }
      await new Promise((r2) => setTimeout(r2, 600)); // ~2/sec, polite to the provider
    }
    const remaining = claims.listRoster(req.params.key).filter((c) => !c.emailSentAt && c.status === "unclaimed").length;
    res.json({ ok: true, sent, failed, remaining, lastReason });
  });

  /** Counts for the console. */
  app.get("/admin/roster/:key/status", checkPassword, (req, res) => {
    const e = events.get(req.params.key);
    if (!e) return res.status(404).json({ error: "No such event." });
    const all = claims.listRoster(req.params.key);
    res.json({
      name: e.name,
      total: all.length,
      emailed: all.filter((c) => !!c.emailSentAt).length,
      unsent: all.filter((c) => !c.emailSentAt && c.status === "unclaimed").length,
      claimed: all.filter((c) => c.status === "claimed").length,
    });
  });

  /** The roster console — client-gated like the sheet and vault consoles. */
  app.get("/admin/roster/:key", (req, res) => {
    res.type("html").send(rosterPage(req.params.key));
  });
}

function rosterPage(key) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Roster — Ticklore</title>
<style>
  :root{--ink:#0E262B;--ink-deep:#081619;--parchment:#F1E9DD;--gold:#C9A227;--gold-bright:#E3C25E;
    --sage:#7FB3A6;--line:rgba(241,233,221,.14);--field:rgba(241,233,221,.05)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--ink);color:var(--parchment);font-family:system-ui,'Segoe UI',sans-serif;line-height:1.5}
  .gate{position:fixed;inset:0;background:var(--ink-deep);z-index:50;display:flex;align-items:center;justify-content:center;padding:24px}
  .gate.hidden{display:none}
  .gate__box{max-width:360px;width:100%;text-align:center}
  .gate input{width:100%;padding:12px;border-radius:6px;border:1px solid var(--line);background:var(--field);
    color:var(--parchment);margin:14px 0 10px;text-align:center;font-size:1rem}
  .gate button{width:100%;padding:12px;border:0;border-radius:6px;background:var(--gold);color:var(--ink-deep);font-weight:600;cursor:pointer}
  .gate .err{color:#E38A8A;font-size:.85rem;min-height:1.2em;margin-top:8px}
  .wrap{max-width:640px;margin:0 auto;padding:28px 20px 80px}
  h1{font-family:Georgia,serif;font-size:1.4rem;margin-bottom:4px}
  .sub{color:var(--sage);font-size:.85rem;margin-bottom:22px;font-family:ui-monospace,monospace}
  .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:22px}
  .stat{border:1px solid var(--line);border-radius:8px;padding:12px 8px;text-align:center;background:var(--field)}
  .stat b{display:block;font-size:1.4rem;font-family:Georgia,serif;color:var(--gold-bright)}
  .stat span{font-size:.68rem;letter-spacing:.08em;text-transform:uppercase;color:var(--sage)}
  label{display:block;font-size:.78rem;letter-spacing:.05em;color:var(--sage);margin:14px 0 6px;text-transform:uppercase}
  textarea{width:100%;min-height:170px;background:var(--field);border:1px solid var(--line);color:var(--parchment);
    padding:12px;border-radius:6px;font-size:.9rem;font-family:ui-monospace,monospace;resize:vertical}
  input[type=number]{width:140px;background:var(--field);border:1px solid var(--line);color:var(--parchment);
    padding:10px 12px;border-radius:6px;font-size:.95rem}
  .go{width:100%;margin-top:14px;background:var(--gold);color:var(--ink-deep);border:0;border-radius:6px;
    padding:13px;font-weight:600;font-size:.98rem;cursor:pointer}
  .go:disabled{opacity:.6;cursor:wait}
  .go.ghost{background:transparent;border:1px dashed var(--line);color:var(--gold-bright)}
  .msg{min-height:1.3em;margin-top:10px;font-size:.9rem}
  .msg.err{color:#E38A8A}
  .msg.ok{color:var(--sage)}
  .hint{font-size:.78rem;color:rgba(241,233,221,.45);margin-top:6px;line-height:1.5}
</style></head>
<body>
<div class="gate" id="gate"><div class="gate__box">
  <div>Enter the admin password to manage this roster.</div>
  <input id="pw" type="password" placeholder="Admin password" autofocus>
  <button onclick="unlock()">Open roster</button>
  <div class="err" id="gerr"></div>
</div></div>

<div class="wrap" id="main" style="display:none">
  <h1 id="title">Roster</h1>
  <div class="sub">Paste the organizer's list — every new person gets a claim code. Re-pasting an
  updated list is safe: people who already have a code are skipped.</div>

  <div class="stats">
    <div class="stat"><b id="st-total">–</b><span>codes</span></div>
    <div class="stat"><b id="st-emailed">–</b><span>invited</span></div>
    <div class="stat"><b id="st-unsent">–</b><span>unsent</span></div>
    <div class="stat"><b id="st-claimed">–</b><span>claimed</span></div>
  </div>

  <label>The list — one person per line ("Name, email" or just an email)</label>
  <textarea id="list" placeholder="Casey Morgan, casey@example.com&#10;jordan@example.com&#10;Sam Lee; sam@example.com"></textarea>
  <label>Engraved price (what they paid the organizer — optional)</label>
  <input type="number" id="price" min="0" step="1" placeholder="35">
  <div class="hint">Run separate imports for different prices (campers $35, RV $30, non-campers $25) —
  dedupe by email makes that safe.</div>
  <button class="go" id="imp" onclick="importList()">Import the list</button>
  <div class="msg" id="imsg"></div>

  <button class="go ghost" id="send" onclick="sendBatch()">Email the unsent claim links (batch of 80)</button>
  <div class="msg" id="smsg"></div>
  <div class="hint">Batched for the email provider's daily limits — click again tomorrow if a big roster
  doesn't finish today. Every click resumes where the last stopped.</div>
</div>

<script>
  var KEY = ${JSON.stringify(key)};
  var PW = "";
  function unlock(){
    PW = document.getElementById('pw').value;
    fetch('/admin/roster/' + encodeURIComponent(KEY) + '/status', { headers: { 'x-admin-password': PW } })
      .then(function(r){ if (!r.ok) throw 0; return r.json(); })
      .then(function(d){
        document.getElementById('gate').classList.add('hidden');
        document.getElementById('main').style.display = 'block';
        document.getElementById('title').textContent = 'Roster — ' + d.name;
        paint(d);
      })
      .catch(function(){ document.getElementById('gerr').textContent = 'Wrong password (or event not found).'; });
  }
  document.getElementById('pw').addEventListener('keydown', function(e){ if (e.key === 'Enter') unlock(); });

  function paint(d){
    document.getElementById('st-total').textContent = d.total;
    document.getElementById('st-emailed').textContent = d.emailed;
    document.getElementById('st-unsent').textContent = d.unsent;
    document.getElementById('st-claimed').textContent = d.claimed;
  }
  function refresh(){
    fetch('/admin/roster/' + encodeURIComponent(KEY) + '/status', { headers: { 'x-admin-password': PW } })
      .then(function(r){ return r.json(); }).then(paint);
  }

  function importList(){
    var btn = document.getElementById('imp'), msg = document.getElementById('imsg');
    msg.className = 'msg'; msg.textContent = '';
    var list = document.getElementById('list').value;
    if (!list.trim()) { msg.className = 'msg err'; msg.textContent = 'Paste the list first.'; return; }
    btn.disabled = true; btn.textContent = 'Importing…';
    fetch('/admin/roster/' + encodeURIComponent(KEY) + '/import', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-password': PW },
      body: JSON.stringify({ list: list, priceDollars: document.getElementById('price').value || 0 })
    }).then(function(r){ return r.json(); }).then(function(d){
      btn.disabled = false; btn.textContent = 'Import the list';
      if (d.ok) {
        msg.className = 'msg ok';
        msg.textContent = d.created + ' new code' + (d.created === 1 ? '' : 's') + ' created'
          + (d.skippedExisting ? ' · ' + d.skippedExisting + ' already had one' : '')
          + (d.invalid && d.invalid.length ? ' · ' + d.invalid.length + ' line(s) had no email' : '');
        if (d.created) document.getElementById('list').value = '';
        refresh();
      } else { msg.className = 'msg err'; msg.textContent = d.error || 'Import failed.'; }
    }).catch(function(){ btn.disabled = false; btn.textContent = 'Import the list'; msg.className = 'msg err'; msg.textContent = 'Could not reach the server.'; });
  }

  function sendBatch(){
    var btn = document.getElementById('send'), msg = document.getElementById('smsg');
    msg.className = 'msg'; msg.textContent = '';
    btn.disabled = true; btn.textContent = 'Sending… (this takes a moment)';
    fetch('/admin/roster/' + encodeURIComponent(KEY) + '/email', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-password': PW },
      body: JSON.stringify({ limit: 80 })
    }).then(function(r){ return r.json(); }).then(function(d){
      btn.disabled = false; btn.textContent = 'Email the unsent claim links (batch of 80)';
      if (d.ok) {
        msg.className = d.failed ? 'msg err' : 'msg ok';
        msg.textContent = d.sent + ' sent · ' + d.failed + ' failed · ' + d.remaining + ' remaining'
          + (d.lastReason ? ' — ' + d.lastReason : '');
        refresh();
      } else { msg.className = 'msg err'; msg.textContent = d.error || 'Send failed.'; }
    }).catch(function(){ btn.disabled = false; btn.textContent = 'Email the unsent claim links (batch of 80)'; msg.className = 'msg err'; msg.textContent = 'Could not reach the server.'; });
  }
</script>
</body></html>`;
}

module.exports = { mountRoster };
