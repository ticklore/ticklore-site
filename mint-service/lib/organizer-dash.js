/**
 * lib/organizer-dash.js — the organizer's window: tickets sold, tickets
 * claimed, people through the door. Counts, NEVER names.
 *
 * A window, not a login: each event carries an unguessable orgToken, and
 * Alex hands the committee chair ONE link — /organizer/<key>?t=<token>.
 * Read-only, phone-friendly, auto-refreshing (watch the door count tick up
 * from across the room on event night). Revoke by regenerating the token.
 *
 * Privacy discipline: this page holds no attendee names, emails, wallets, or
 * codes — the no-roster rule applies to organizers' screens too. A miss on
 * the token looks like nothing exists (same as private plaques).
 */

const crypto = require("crypto");
const events = require("./events");
const claims = require("./claims");
const vaultStore = require("./vault-store");

function mountOrganizerDash(app) {
  function authed(req, e) {
    const token = e.orgToken || events.ensureOrgToken(e.key);
    const given = String(req.query.t || "");
    return !!(token && given && given.length === token.length &&
      crypto.timingSafeEqual(Buffer.from(given), Buffer.from(token)));
  }

  /** The numbers. Honest about what each channel can actually know. */
  function stats(e) {
    const all = claims.listByEvent(e.key);
    const by = (ch) => all.filter((c) => (c.channel || "print") === ch);
    const print = by("print"), online = by("online"), roster = by("roster");
    const claimed = (list) => list.filter((c) => c.status === "claimed").length;

    // "Sold" means different things per channel — say so rather than blur it:
    //   print: activation events KNOW sales (desk activates at sale); without
    //          activation, possession is the sale and only claims are visible.
    //   online: a payment assigned the code — that IS the sale.
    //   roster: they registered through the organizer's own system.
    const printSold = e.activationRequired ? print.filter((c) => c.active).length : null;
    const onlineSold = online.filter((c) => !!c.assignedTo).length;

    const unsold =
      (e.activationRequired ? print.length - printSold : print.length - claimed(print)) +
      (online.length - onlineSold);

    const vaultAll = vaultStore.listByEvent(e.key, { publishedOnly: false });

    return {
      name: e.name, date: e.date || "", venue: e.venue || "",
      redemptionEnabled: !!e.redemptionEnabled,
      totalCodes: all.length,
      sold: (printSold || 0) + onlineSold + roster.length,
      printTracked: e.activationRequired,
      claimed: claimed(all),
      checkedIn: all.filter((c) => !!c.redeemedAt).length,
      unsold,
      channels: {
        print: { total: print.length, sold: printSold, claimed: claimed(print) },
        online: { total: online.length, sold: onlineSold, claimed: claimed(online) },
        roster: { total: roster.length, invited: roster.filter((c) => !!c.emailSentAt).length, claimed: claimed(roster) },
      },
      vault: {
        published: vaultAll.filter((x) => x.status === "published").length,
        awaiting: vaultAll.filter((x) => x.status === "pending").length,
      },
      asOf: new Date().toISOString(),
    };
  }

  app.get("/organizer/:key/stats", (req, res) => {
    const e = events.get(req.params.key);
    if (!e || !authed(req, e)) return res.status(404).json({ error: "not found" });
    res.json(stats(e));
  });

  app.get("/organizer/:key", (req, res) => {
    const e = events.get(req.params.key);
    if (!e || !authed(req, e)) {
      return res.status(404).type("html").send(
        `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticklore</title><meta name="robots" content="noindex, nofollow">
<style>body{background:#081619;color:rgba(241,233,221,.55);font-family:system-ui,sans-serif;min-height:100vh;display:flex;align-items:center;justify-content:center}</style></head>
<body><div>There's nothing at this address.</div></body></html>`);
    }
    res.type("html").send(dashPage(e.key, String(req.query.t || ""), stats(e), e));
  });
}

function dashPage(key, token, s, e) {
  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Your event — Ticklore</title>
<meta name="robots" content="noindex, nofollow">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:opsz,wght@9..144,400;9..144,600&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{--ink:#0E262B;--ink-deep:#081619;--parchment:#F1E9DD;--gold:#C9A227;--gold-bright:#E3C25E;
    --sage:#7FB3A6;--line:rgba(241,233,221,.14);--field:rgba(241,233,221,.04)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--ink-deep);color:var(--parchment);font-family:system-ui,'Segoe UI',sans-serif;line-height:1.5}
  .wrap{max-width:640px;margin:0 auto;padding:30px 18px 70px}
  .tag{font-family:'IBM Plex Mono',monospace;font-size:.68rem;letter-spacing:.24em;text-transform:uppercase;color:var(--gold);text-align:center;margin-bottom:12px}
  h1{font-family:'Fraunces',serif;font-weight:600;font-size:1.7rem;text-align:center;line-height:1.15}
  .meta{font-family:'IBM Plex Mono',monospace;font-size:.76rem;color:var(--sage);text-align:center;margin:6px 0 26px}
  .grid{display:grid;grid-template-columns:repeat(2,1fr);gap:12px;margin-bottom:14px}
  .card{border:1px solid var(--line);border-radius:12px;padding:18px 12px;text-align:center;background:var(--field)}
  .card b{display:block;font-family:'Fraunces',serif;font-weight:600;font-size:2.1rem;color:var(--gold-bright)}
  .card span{font-size:.68rem;letter-spacing:.14em;text-transform:uppercase;color:var(--sage)}
  .card.badge b{color:#7FE3B3}
  table{width:100%;border-collapse:collapse;margin-top:16px;font-size:.88rem}
  th{font-family:'IBM Plex Mono',monospace;font-size:.64rem;letter-spacing:.14em;text-transform:uppercase;color:var(--sage);text-align:left;padding:8px 6px;border-bottom:1px solid var(--line)}
  td{padding:9px 6px;border-bottom:1px solid var(--line);color:rgba(241,233,221,.85)}
  td:not(:first-child),th:not(:first-child){text-align:right}
  .vrow{display:flex;justify-content:space-between;border:1px solid var(--line);border-radius:10px;padding:12px 14px;margin-top:16px;background:var(--field);font-size:.88rem}
  .vrow span{color:var(--sage)}
  .foot{text-align:center;font-family:'IBM Plex Mono',monospace;font-size:.62rem;letter-spacing:.16em;text-transform:uppercase;color:rgba(241,233,221,.35);margin-top:34px}
  .asof{text-align:center;font-family:'IBM Plex Mono',monospace;font-size:.66rem;color:rgba(241,233,221,.4);margin-top:10px}
</style></head>
<body><div class="wrap">
  <div class="tag">Your event · live</div>
  <h1 id="d-name">${esc(s.name)}</h1>
  <div class="meta" id="d-meta">${esc(s.venue)}${s.venue && s.date ? " · " : ""}${esc(s.date)}</div>

  <div class="grid">
    <div class="card"><b id="d-sold">–</b><span>Sold / registered</span></div>
    <div class="card"><b id="d-claimed">–</b><span>Keepsakes claimed</span></div>
    <div class="card badge"><b id="d-door">–</b><span>Through the door</span></div>
    <div class="card"><b id="d-unsold">–</b><span>Unsold inventory</span></div>
  </div>

  <table>
    <thead><tr><th>Channel</th><th>Tickets</th><th>Sold</th><th>Claimed</th></tr></thead>
    <tbody id="d-rows"></tbody>
  </table>

  <div class="vrow"><span>Memory vault</span><div><b id="d-vpub">–</b> published · <b id="d-vpen">–</b> awaiting review</div></div>

  ${(s.channels && s.channels.online && s.channels.online.total) ? (
    e && e.stripeAccountId
      ? `<div class="vrow"><span>Card sales</span><div style="color:var(--sage)">deposit directly to <b>your Stripe</b> ✓</div></div>`
      : `<div class="vrow"><span>Card sales</span><div><a href="/connect/${encodeURIComponent(key)}?t=${encodeURIComponent(token)}" style="color:var(--gold-bright)">Connect your Stripe &rarr;</a>
         <span style="color:rgba(241,233,221,.5);font-size:.8rem"> so ticket money lands in your account</span></div></div>`
  ) : ""}

  <div class="asof" id="d-asof"></div>
  <div class="foot">Ticklore · counts only, never names</div>
</div>
<script>
  var KEY = ${JSON.stringify(key)}, T = ${JSON.stringify(token)};
  function paint(s){
    document.getElementById('d-sold').textContent = s.sold + (s.printTracked ? '' : '+');
    document.getElementById('d-claimed').textContent = s.claimed;
    document.getElementById('d-door').textContent = s.redemptionEnabled ? s.checkedIn : '—';
    document.getElementById('d-unsold').textContent = s.unsold;
    var ch = s.channels, rows = '';
    if (ch.print.total) rows += '<tr><td>Printed cards</td><td>' + ch.print.total + '</td><td>' + (ch.print.sold === null ? 'at the desk' : ch.print.sold) + '</td><td>' + ch.print.claimed + '</td></tr>';
    if (ch.online.total) rows += '<tr><td>Online (card)</td><td>' + ch.online.total + '</td><td>' + ch.online.sold + '</td><td>' + ch.online.claimed + '</td></tr>';
    if (ch.roster.total) rows += '<tr><td>Registered list</td><td>' + ch.roster.total + '</td><td>' + ch.roster.invited + ' invited</td><td>' + ch.roster.claimed + '</td></tr>';
    document.getElementById('d-rows').innerHTML = rows || '<tr><td colspan="4" style="color:rgba(241,233,221,.4)">No tickets yet.</td></tr>';
    document.getElementById('d-vpub').textContent = s.vault.published;
    document.getElementById('d-vpen').textContent = s.vault.awaiting;
    document.getElementById('d-asof').textContent = 'updated ' + new Date(s.asOf).toLocaleTimeString();
  }
  paint(${JSON.stringify(s)});
  setInterval(function(){
    fetch('/organizer/' + encodeURIComponent(KEY) + '/stats?t=' + encodeURIComponent(T))
      .then(function(r){ return r.ok ? r.json() : null; })
      .then(function(s){ if (s) paint(s); });
  }, 30000);
</script>
</body></html>`;
}

module.exports = { mountOrganizerDash };
