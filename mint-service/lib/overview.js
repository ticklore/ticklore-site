/**
 * lib/overview.js — Mission Control: every number that matters, one screen.
 *
 * The founder's morning-coffee page: totals across all events, a per-event
 * table with jump links, and the system vitals (gas on both chains, last
 * backup age, email readiness). Read-only, auto-refreshing, admin-gated.
 * Counts only — same privacy posture as everything else.
 */

const express = require("express");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const events = require("./events");
const claims = require("./claims");
const vaultStore = require("./vault-store");

function mountOverview(app, { chain, chainV5, chainV6 } = {}) {
  const PASSWORD = process.env.ADMIN_PASSWORD;

  function checkPassword(req, res, next) {
    if (!PASSWORD) return res.status(500).json({ error: "Overview is not configured (ADMIN_PASSWORD unset)." });
    const given = req.get("x-admin-password") || "";
    const a = Buffer.from(given), b = Buffer.from(PASSWORD);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: "Wrong password." });
    }
    next();
  }

  function lastBackupHours() {
    try {
      const anchor = process.env.CLAIM_STORE || path.join(__dirname, "..", "claims.json");
      const t = new Date(fs.readFileSync(path.join(path.dirname(anchor), ".last-backup-email"), "utf8").trim()).getTime();
      return Math.round(((Date.now() - t) / 36e5) * 10) / 10;
    } catch { return null; }
  }

  app.get("/admin/overview/stats", checkPassword, async (req, res) => {
    const evs = events.list().filter((e) => e.mode === "sponsor");
    const totals = { events: evs.length, codes: 0, sold: 0, claimed: 0, checkedIn: 0, vaultPending: 0, vaultPublished: 0 };

    const perEvent = evs.map((e) => {
      const codes = claims.listByEvent(e.key);
      const print = codes.filter((c) => (c.channel || "print") === "print");
      const online = codes.filter((c) => c.channel === "online");
      const roster = codes.filter((c) => c.channel === "roster");
      const claimed = codes.filter((c) => c.status === "claimed").length;
      const checkedIn = codes.filter((c) => !!c.redeemedAt).length;
      // "Sold" is honest per channel: activated stubs (when the event tracks
      // activation; otherwise claims are the only signal), online allocations,
      // and the whole roster (they registered with the organizer already).
      const printSold = e.activationRequired
        ? print.filter((c) => c.active).length
        : print.filter((c) => c.status === "claimed").length;
      const sold = printSold + online.filter((c) => !!c.assignedTo).length + roster.length;
      const vault = vaultStore.listByEvent(e.key, { publishedOnly: false });
      const vaultPending = vault.filter((v) => v.status === "pending").length;
      const vaultPublished = vault.filter((v) => v.status === "published").length;

      totals.codes += codes.length; totals.sold += sold; totals.claimed += claimed;
      totals.checkedIn += checkedIn; totals.vaultPending += vaultPending; totals.vaultPublished += vaultPublished;

      return {
        key: e.key, name: e.name, date: e.date || "", visibility: e.vaultVisibility,
        total: codes.length, sold, claimed, checkedIn,
        remaining: Math.max(0, codes.length - sold),
        vaultPending, vaultPublished,
        dashUrl: `/organizer/${encodeURIComponent(e.key)}?t=${e.orgToken || ""}`,
      };
    });

    const system = { lastBackupHoursAgo: lastBackupHours(), emailConfigured: !!(process.env.RESEND_API_KEY && process.env.FROM_EMAIL) };
    const { formatEther } = require("ethers");
    try {
      if (chain) {
        const b = await chain.provider.getBalance(chain.signer.address);
        system.legacyGasEth = Number(formatEther(b)).toFixed(5);
        system.legacyGasLow = Number(formatEther(b)) < 0.0005;
      }
    } catch { system.legacyGasEth = "unreachable"; }
    try {
      // The newest configured model is the one that mints, so it is the one
      // whose gas matters. Read it from `newest`, never from a named version —
      // hardcoding chainV5 here would throw the moment V6 ships alone.
      const newest = chainV6 || chainV5;
      if (newest) {
        const b = await newest.provider.getBalance(newest.signer.address);
        system.mainGasEth = Number(formatEther(b)).toFixed(5);
        system.mainGasLow = Number(formatEther(b)) < Number(process.env.MIN_GAS_ETH || 0.0005);
        system.mainChainId = newest.network.chainId.toString();
      }
    } catch { system.mainGasEth = "unreachable"; }

    res.json({ totals, perEvent, system });
  });

  app.get("/admin/overview", (req, res) => {
    res.type("html").send(overviewPage());
  });
}

function overviewPage() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Mission Control — Ticklore</title>
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
  .wrap{max-width:880px;margin:0 auto;padding:26px 20px 80px}
  h1{font-family:Georgia,serif;font-size:1.45rem}
  .sub{color:var(--sage);font-size:.8rem;font-family:ui-monospace,monospace;margin-bottom:22px}
  .cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:10px;margin-bottom:24px}
  .card{border:1px solid var(--line);border-radius:10px;padding:14px 10px;text-align:center;background:var(--field)}
  .card b{display:block;font-size:1.7rem;font-family:Georgia,serif;color:var(--gold-bright)}
  .card span{font-size:.66rem;letter-spacing:.1em;text-transform:uppercase;color:var(--sage)}
  table{width:100%;border-collapse:collapse;font-size:.88rem;margin-bottom:26px}
  th{font-family:ui-monospace,monospace;font-size:.66rem;letter-spacing:.12em;text-transform:uppercase;
    color:var(--gold);text-align:left;padding:8px 8px;border-bottom:1px solid var(--line)}
  td{padding:9px 8px;border-bottom:1px solid var(--line);vertical-align:middle}
  td.num{text-align:right;font-family:ui-monospace,monospace}
  .evname{font-family:Georgia,serif;font-size:.98rem}
  .evname a{color:var(--parchment);text-decoration:none}
  .evname a:hover{color:var(--gold-bright)}
  .viz{font-size:.62rem;font-family:ui-monospace,monospace;letter-spacing:.06em;text-transform:uppercase;
    padding:2px 7px;border-radius:99px;border:1px solid var(--line);color:var(--sage)}
  .pending{color:#E3C25E;font-weight:600}
  .sys{display:flex;flex-wrap:wrap;gap:10px}
  .chip{border:1px solid var(--line);border-radius:99px;padding:7px 14px;font-size:.78rem;
    font-family:ui-monospace,monospace;color:var(--sage);background:var(--field)}
  .chip.bad{border-color:rgba(227,138,138,.5);color:#E38A8A}
  .chip.good{color:var(--sage)}
  .foot{margin-top:26px;font-size:.72rem;color:rgba(241,233,221,.4);font-family:ui-monospace,monospace}
</style></head>
<body>
<div class="gate" id="gate"><div class="gate__box">
  <div>Enter the admin password.</div>
  <input id="pw" type="password" placeholder="Admin password" autofocus>
  <button onclick="unlock()">Open Mission Control</button>
  <div class="err" id="gerr"></div>
</div></div>

<div class="wrap" id="main" style="display:none">
  <h1>Mission Control</h1>
  <div class="sub" id="stamp">&nbsp;</div>

  <div class="cards" id="cards"></div>

  <table>
    <thead><tr>
      <th>Event</th><th></th>
      <th style="text-align:right">Codes</th><th style="text-align:right">Sold</th>
      <th style="text-align:right">Claimed</th><th style="text-align:right">In</th>
      <th style="text-align:right">Vault</th>
    </tr></thead>
    <tbody id="rows"></tbody>
  </table>

  <div class="sys" id="sys"></div>
  <div class="foot">Counts only — no names anywhere on this screen. Auto-refreshes every 30 seconds.
    &nbsp;·&nbsp; <a href="/admin" style="color:var(--gold-bright)">Console &rarr;</a></div>
</div>

<script>
  var PW = "", timer = null;
  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  function unlock(){
    PW = document.getElementById('pw').value;
    load(true);
  }
  document.getElementById('pw').addEventListener('keydown', function(e){ if (e.key === 'Enter') unlock(); });

  function load(first){
    fetch('/admin/overview/stats', { headers: { 'x-admin-password': PW } })
      .then(function(r){ if (!r.ok) throw 0; return r.json(); })
      .then(function(d){
        if (first){
          document.getElementById('gate').classList.add('hidden');
          document.getElementById('main').style.display = 'block';
          if (timer) clearInterval(timer);
          timer = setInterval(load, 30000);
        }
        paint(d);
      })
      .catch(function(){ if (first) document.getElementById('gerr').textContent = 'Wrong password.'; });
  }

  function paint(d){
    var t = d.totals;
    document.getElementById('stamp').textContent = 'as of ' + new Date().toLocaleTimeString();
    document.getElementById('cards').innerHTML =
      card(t.events, 'events') + card(t.codes, 'codes') + card(t.sold, 'sold') +
      card(t.claimed, 'keepsakes') + card(t.checkedIn, 'checked in') +
      card(t.vaultPending, 'awaiting curation');
    document.getElementById('rows').innerHTML = (d.perEvent || []).map(function(e){
      var vault = e.vaultPending ? '<span class="pending">' + e.vaultPending + ' ⏳</span> / ' + e.vaultPublished
                                 : e.vaultPublished + '';
      return '<tr>'
        + '<td class="evname"><a href="' + esc(e.dashUrl) + '" target="_blank">' + esc(e.name) + '</a>'
        + (e.date ? ' <span style="color:var(--sage);font-size:.72rem;font-family:ui-monospace,monospace">' + esc(e.date) + '</span>' : '') + '</td>'
        + '<td><span class="viz">' + esc(e.visibility || '') + '</span></td>'
        + '<td class="num">' + e.total + '</td>'
        + '<td class="num">' + e.sold + '</td>'
        + '<td class="num">' + e.claimed + '</td>'
        + '<td class="num">' + e.checkedIn + '</td>'
        + '<td class="num">' + vault + '</td>'
        + '</tr>';
    }).join('') || '<tr><td colspan="7" style="color:var(--sage)">No sponsor events yet.</td></tr>';

    var s = d.system || {}, chips = [];
    if (s.legacyGasEth !== undefined) chips.push(chip('Sepolia gas ' + s.legacyGasEth, s.legacyGasLow || s.legacyGasEth === 'unreachable'));
    if (s.mainGasEth !== undefined) chips.push(chip('Mainnet gas ' + s.mainGasEth, s.mainGasLow || s.mainGasEth === 'unreachable'));
    chips.push(chip(s.emailConfigured ? 'email ✓' : 'email NOT configured', !s.emailConfigured));
    chips.push(chip(s.lastBackupHoursAgo == null ? 'backup: never emailed' : 'backup ' + s.lastBackupHoursAgo + 'h ago',
      s.lastBackupHoursAgo == null || s.lastBackupHoursAgo > 30));
    document.getElementById('sys').innerHTML = chips.join('');
  }
  function card(v, label){ return '<div class="card"><b>' + v + '</b><span>' + label + '</span></div>'; }
  function chip(text, bad){ return '<span class="chip ' + (bad ? 'bad' : 'good') + '">' + esc(text) + '</span>'; }
</script>
</body></html>`;
}

module.exports = { mountOverview };
