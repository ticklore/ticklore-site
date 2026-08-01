/**
 * lib/vault.js — the memory vault: the deeper story behind the keepsake.
 *
 * The public page (/vault/:key) is the branded web-page experience Alex
 * described: event hero, the story, the photo gallery, letters, and the
 * sponsor credits panel — where sponsor recognition actually lives (the
 * ticket face carries only the restrained credit line). Reads are OPEN on
 * purpose: gating a view is theater; privacy is what the curator publishes.
 *
 * Submission is concierge-only for now (/admin/vault/:key, ADMIN_PASSWORD):
 * Ticklore adds photos and letters on the organizer's behalf and is the
 * curator. The store already carries a "pending" state for the day attendees
 * submit directly. Content sits behind lib/vault-store.js — the storage seam
 * Arweave fills after the contract freeze (see docs/HANDOFF.md).
 */

const express = require("express");
const crypto = require("crypto");
const events = require("./events");
const vaultStore = require("./vault-store");
const claims = require("./claims");
const moderation = require("./moderation");
const privyLib = require("./privy");
const { head, formatDate, esc } = require("./ui");
const { listEvents } = require("./stripe-routes");

// Submission rate limit — photos are donations, but a leaked link shouldn't be
// able to flood the curator or the disk. In-memory, per IP, pilot-grade.
const SUBMIT_WINDOW_MS = 60 * 60 * 1000;
const SUBMIT_MAX_PER_WINDOW = 6;
const PENDING_CAP_PER_EVENT = 200;
const submitLog = new Map(); // ip -> [timestamps]

function rateLimited(ip) {
  const now = Date.now();
  const log = (submitLog.get(ip) || []).filter((t) => now - t < SUBMIT_WINDOW_MS);
  if (log.length >= SUBMIT_MAX_PER_WINDOW) { submitLog.set(ip, log); return true; }
  log.push(now);
  submitLog.set(ip, log);
  return false;
}

function mountVault(app) {
  const PASSWORD = process.env.ADMIN_PASSWORD;

  function checkPassword(req, res, next) {
    if (!PASSWORD) return res.status(500).json({ error: "Vault admin is not configured (ADMIN_PASSWORD unset)." });
    const given = req.get("x-admin-password") || "";
    const a = Buffer.from(given), b = Buffer.from(PASSWORD);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: "Wrong password." });
    }
    next();
  }

  function findEvent(key) {
    return events.get(key) || listEvents().find((x) => x.key === key) || null;
  }

  /** The public vault page. Open reads, curated content. */
  app.get("/vault/:key", (req, res) => {
    const e = findEvent(req.params.key) || { name: "Your event", date: "", key: req.params.key };
    const entries = vaultStore.listByEvent(req.params.key, { publishedOnly: true });
    res.type("html").send(vaultPage(e, entries, { vaultKey: req.params.key, privy: privyLib.config }));
  });

  /** Attendee memory submission — lands PENDING; the curator publishes.
   *  "open" events accept anyone with the link (name/email optional,
   *  unverified — provenance without a toll booth). "holders" events require
   *  a Privy sign-in AND a claim record for this event. */
  app.post("/vault/:key/submit", express.json({ limit: "10mb" }), async (req, res) => {
    try {
      const e = findEvent(req.params.key);
      if (!e) return res.status(404).json({ ok: false, error: "No such event." });

      const ip = req.ip || req.socket.remoteAddress || "?";
      if (rateLimited(ip)) {
        return res.status(429).json({ ok: false, error: "That's a lot of memories at once — try again in a little while." });
      }
      const pending = vaultStore.listByEvent(req.params.key, { publishedOnly: false })
        .filter((x) => x.status === "pending").length;
      if (pending >= PENDING_CAP_PER_EVENT) {
        return res.status(429).json({ ok: false, error: "The curation queue for this event is full for now." });
      }

      const b = req.body || {};
      let submitter = { name: b.name || "", email: b.email || "", verified: false };

      if ((e.vaultSubmissions || "open") === "holders") {
        if (!privyLib.config) return res.status(403).json({ ok: false, error: "Submissions for this event need sign-in, which isn't available right now." });
        const token = String(b.privyToken || "");
        if (!token) return res.status(401).json({ ok: false, error: "Sign in to add a memory to this vault." });
        const who = await privyLib.walletFromToken(token); // throws on bad token
        const held = claims.listByOwner({ email: who.email, address: who.address })
          .some((t) => t.eventKey === req.params.key);
        if (!held) return res.status(403).json({ ok: false, error: "This vault accepts memories from its keepsake holders — we couldn't find one on your account." });
        submitter = { name: b.name || "", email: who.email || "", verified: true };
      }

      // Same checkpoint as inscriptions — words headed for the curator should
      // already be clean, and links/contact-info aren't memories. Letters are
      // multi-line, so their body is checked line by line (checkText treats a
      // newline as an inscription violation, which doesn't apply here).
      for (const field of [b.title, b.credit, b.name]) {
        const mod = moderation.checkText(field);
        if (!mod.ok) return res.status(400).json({ ok: false, error: mod.reason });
      }
      for (const line of String(b.text || "").split(/\r?\n/)) {
        const mod = moderation.checkText(line);
        if (!mod.ok) return res.status(400).json({ ok: false, error: mod.reason });
      }

      const entry = vaultStore.add(req.params.key, {
        type: b.type, title: b.title, text: b.text,
        credit: b.credit || b.name, // their name becomes the credit line unless they wrote one
        imageData: b.imageData, publish: false, submitter,
      });
      res.json({ ok: true, pending: true, id: entry.id });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  /** Stored vault media (photos). Names are unguessable and format-checked. */
  app.get("/vault-media/:name", (req, res) => {
    const p = vaultStore.mediaPath(req.params.name);
    if (!p) return res.status(404).send("Not found");
    res.sendFile(p, { maxAge: "7d" });
  });

  // --- Concierge curation ----------------------------------------------------

  app.get("/admin/vault/:key/entries", checkPassword, (req, res) => {
    const e = findEvent(req.params.key);
    if (!e) return res.status(404).json({ error: "No such event." });
    res.json({ name: e.name, date: e.date, entries: vaultStore.listByEvent(req.params.key, { publishedOnly: false }) });
  });

  /** Add a photo or letter. Concierge path publishes immediately — the admin
   *  IS the curator. Raised body limit for the base64 photo payload. */
  app.post("/admin/vault/:key/add", express.json({ limit: "10mb" }), checkPassword, (req, res) => {
    try {
      const e = findEvent(req.params.key);
      if (!e) return res.status(404).json({ ok: false, error: "No such event." });
      const b = req.body || {};
      const entry = vaultStore.add(req.params.key, {
        type: b.type, title: b.title, text: b.text, credit: b.credit,
        imageData: b.imageData, publish: true,
      });
      res.json({ ok: true, id: entry.id, type: entry.type });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  app.post("/admin/vault/publish", express.json(), checkPassword, (req, res) => {
    const e = vaultStore.publish((req.body || {}).id);
    if (!e) return res.status(404).json({ ok: false, error: "No such entry." });
    res.json({ ok: true, id: e.id });
  });

  app.post("/admin/vault/remove", express.json(), checkPassword, (req, res) => {
    const removed = vaultStore.remove((req.body || {}).id);
    if (!removed) return res.status(404).json({ ok: false, error: "No such entry." });
    res.json({ ok: true });
  });

  /** The curation console — client-gated like the code sheet. */
  app.get("/admin/vault/:key", (req, res) => {
    res.type("html").send(consolePage(req.params.key));
  });
}

// ---------------------------------------------------------------------------
// The public vault page — the wallpaper test applies here too.
// ---------------------------------------------------------------------------

function vaultPage(e, entries, { vaultKey, privy } = {}) {
  const photos = entries.filter((x) => x.type === "photo");
  const letters = entries.filter((x) => x.type === "letter");
  const sponsors = Array.isArray(e.sponsors) ? e.sponsors.filter((s) => s && s.name) : [];
  const holdersOnly = (e.vaultSubmissions || "open") === "holders";
  const canSubmit = !holdersOnly || !!privy; // holders-only needs Privy to verify

  const photoCards = photos.map((p) => `
      <figure class="ph">
        <img src="/vault-media/${esc(p.media)}" alt="${esc(p.title || e.name)}" loading="lazy">
        ${p.title || p.credit ? `<figcaption>${esc(p.title)}${p.title && p.credit ? " — " : ""}${p.credit ? `<span>${esc(p.credit)}</span>` : ""}</figcaption>` : ""}
      </figure>`).join("");

  const letterCards = letters.map((l) => `
      <blockquote class="letter">
        ${l.title ? `<div class="letter__title">${esc(l.title)}</div>` : ""}
        <p>${esc(l.text).replace(/\n{2,}/g, "</p><p>").replace(/\n/g, "<br>")}</p>
        ${l.credit ? `<cite>— ${esc(l.credit)}</cite>` : ""}
      </blockquote>`).join("");

  const sponsorRows = sponsors.map((s) => `
      <div class="sp"><span class="sp__lead">${esc(s.leadIn || "With thanks to")}</span><span class="sp__name">${esc(s.name)}</span></div>`).join("");

  const empty = !photos.length && !letters.length;

  return `<!doctype html>
<html lang="en"><head>${head("The Vault — " + e.name)}
<meta name="theme-color" content="#081619">
<style>
  *{box-sizing:border-box}
  body{background:var(--ink-deep,#081619)}
  .vnav{padding:16px 20px;position:sticky;top:0;z-index:5;
    background:linear-gradient(rgba(8,22,25,.95),rgba(8,22,25,.75));backdrop-filter:blur(8px)}
  .vnav a{color:rgba(241,233,221,.7);text-decoration:none;font-size:.9rem}
  .vault{max-width:760px;margin:0 auto;padding:26px 22px 90px}
  .hero{text-align:center;padding:20px 0 34px;border-bottom:1px solid var(--line)}
  .hero__tag{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:.26em;
    text-transform:uppercase;color:var(--gold);margin-bottom:16px}
  .hero__name{font-family:'Fraunces',serif;font-weight:600;font-size:clamp(2rem,6vw,3rem);line-height:1.08;margin-bottom:10px}
  .hero__meta{font-family:'IBM Plex Mono',monospace;font-size:.82rem;color:var(--sage)}
  .sect{margin-top:44px}
  .sect__label{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:.2em;
    text-transform:uppercase;color:var(--gold);margin-bottom:18px}
  .story{font-family:'Fraunces',serif;font-style:italic;font-size:1.22rem;line-height:1.65;color:rgba(241,233,221,.85)}
  .gallery{columns:2;column-gap:14px}
  @media (max-width:560px){.gallery{columns:1}}
  .ph{break-inside:avoid;margin:0 0 14px;border-radius:12px;overflow:hidden;border:1px solid var(--line);
    background:rgba(241,233,221,.02);box-shadow:0 18px 40px -26px rgba(0,0,0,.8)}
  .ph img{display:block;width:100%;height:auto}
  .ph figcaption{padding:10px 13px;font-size:.82rem;color:rgba(241,233,221,.75);font-family:'Fraunces',serif}
  .ph figcaption span{color:var(--sage);font-family:'IBM Plex Mono',monospace;font-size:.72rem}
  .letter{margin:0 0 18px;border:1px solid var(--line);border-left:3px solid var(--gold);border-radius:10px;
    padding:22px 24px;background:rgba(241,233,221,.03)}
  .letter__title{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:.16em;
    text-transform:uppercase;color:var(--gold-bright);margin-bottom:10px}
  .letter p{font-family:'Fraunces',serif;font-style:italic;font-size:1.08rem;line-height:1.7;
    color:rgba(241,233,221,.88);margin:0 0 10px}
  .letter cite{font-style:normal;font-family:'IBM Plex Mono',monospace;font-size:.78rem;color:var(--sage)}
  .sp{display:flex;align-items:baseline;justify-content:space-between;gap:16px;
    padding:13px 4px;border-bottom:1px solid var(--line)}
  .sp__lead{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:.14em;
    text-transform:uppercase;color:var(--sage)}
  .sp__name{font-family:'Fraunces',serif;font-size:1.12rem;color:var(--gold-bright)}
  .empty{border:1px dashed var(--line);border-radius:16px;padding:44px 26px;text-align:center;
    background:rgba(241,233,221,.02);margin-top:44px}
  .empty h2{font-family:'Fraunces',serif;font-weight:600;font-size:1.2rem;margin-bottom:12px}
  .empty p{color:rgba(241,233,221,.6);line-height:1.6;font-size:.98rem}
  .vfoot{text-align:center;margin-top:60px;font-family:'IBM Plex Mono',monospace;font-size:.68rem;
    letter-spacing:.24em;text-transform:uppercase;color:rgba(241,233,221,.35)}
  .ph img{cursor:zoom-in}
  .lb{position:fixed;inset:0;z-index:60;display:none;flex-direction:column;align-items:center;
    justify-content:center;padding:26px;background:rgba(8,22,25,.95);backdrop-filter:blur(6px);cursor:zoom-out}
  .lb.on{display:flex}
  .lb img{max-width:94vw;max-height:80vh;border-radius:10px;box-shadow:0 40px 90px -30px rgba(0,0,0,.9)}
  .lb__cap{margin-top:16px;font-family:'Fraunces',serif;font-size:1rem;color:rgba(241,233,221,.85);text-align:center}
  .lb__cap span{font-family:'IBM Plex Mono',monospace;font-size:.74rem;color:var(--sage)}
  .lb__hint{margin-top:8px;font-family:'IBM Plex Mono',monospace;font-size:.64rem;letter-spacing:.18em;
    text-transform:uppercase;color:rgba(241,233,221,.35)}
  .add{margin-top:52px;border:1px dashed var(--line);border-radius:16px;padding:26px;text-align:center}
  .add__open{background:transparent;border:1px solid var(--gold);color:var(--gold-bright);border-radius:8px;
    padding:12px 22px;font-family:'IBM Plex Mono',monospace;font-size:.82rem;letter-spacing:.08em;cursor:pointer}
  .add__open:hover{background:rgba(201,162,39,.1)}
  .add__note{margin-top:10px;font-size:.8rem;color:rgba(241,233,221,.45)}
  .add form,.add .step{text-align:left;max-width:440px;margin:16px auto 0}
  .add label{display:block;font-size:.74rem;letter-spacing:.06em;color:var(--sage);margin:12px 0 6px;text-transform:uppercase;font-family:'IBM Plex Mono',monospace}
  .add input[type=text],.add input[type=email],.add textarea{width:100%;background:rgba(241,233,221,.05);
    border:1px solid var(--line);color:var(--parchment);padding:11px 13px;border-radius:6px;font-size:.95rem}
  .add textarea{min-height:100px;resize:vertical}
  .add input[type=file]{margin-top:4px;color:var(--sage);width:100%}
  .add .tabs{display:flex;gap:8px;max-width:440px;margin:16px auto 0}
  .add .tabs button{flex:1;padding:9px;border-radius:6px;border:1px solid var(--line);background:transparent;color:var(--parchment);cursor:pointer;font-size:.86rem}
  .add .tabs button.on{background:var(--gold);color:var(--ink-deep);border-color:var(--gold);font-weight:600}
  .add .send{width:100%;margin-top:16px;background:var(--gold);color:var(--ink-deep);border:0;border-radius:6px;padding:12px;font-weight:600;font-size:.95rem;cursor:pointer}
  .add .send:disabled{opacity:.6;cursor:wait}
  .add .msg{min-height:1.3em;margin-top:10px;font-size:.88rem;text-align:center}
  .add .msg.err{color:#E38A8A}
  .add .msg.ok{color:var(--sage)}
</style></head>
<body>
  <nav class="vnav"><a href="/wallet">← Your keepsakes</a></nav>
  <main class="vault">
    <div class="hero">
      <div class="hero__tag">The Memory Vault</div>
      <div class="hero__name">${esc(e.name)}</div>
      <div class="hero__meta">${e.venue ? esc(e.venue) : ""}${e.venue && e.date ? " · " : ""}${e.date ? formatDate(e.date) : ""}</div>
    </div>

    ${e.blurb ? `<section class="sect"><div class="sect__label">The Story</div><div class="story">${esc(e.blurb)}</div></section>` : ""}

    ${photos.length ? `<section class="sect"><div class="sect__label">From the night itself</div><div class="gallery">${photoCards}</div></section>` : ""}

    ${letters.length ? `<section class="sect"><div class="sect__label">Letters &amp; memories</div>${letterCards}</section>` : ""}

    ${sponsors.length ? `<section class="sect"><div class="sect__label">The patrons of this night</div>${sponsorRows}</section>` : ""}

    ${empty ? `<div class="empty"><h2>Forever, from the night itself.</h2><p>Photos and memories from this event will live here — permanently, tied to your ticket. The story is still being written.</p></div>` : ""}

    ${canSubmit ? `
    <div class="add" id="add">
      <div id="add-cta">
        <button class="add__open" onclick="openAdd()">+ Add your memory</button>
        <div class="add__note">${holdersOnly
          ? "This vault accepts memories from its keepsake holders — you'll sign in with the email you claimed with."
          : "Were you there? Share a photo or a few words — the curator adds it to the story."}</div>
      </div>

      ${holdersOnly ? `
      <div class="step" id="add-auth" style="display:none">
        <label>Your email (the one you claimed with)</label>
        <input type="email" id="a-email" autocomplete="email" placeholder="you@email.com">
        <button class="send" id="a-send" onclick="authSend()">Send my code</button>
        <div id="a-otp-wrap" style="display:none">
          <label>6-digit code</label>
          <input type="text" id="a-otp" inputmode="numeric" maxlength="6" autocomplete="one-time-code">
          <button class="send" id="a-verify" onclick="authVerify()">Verify</button>
        </div>
        <div class="msg" id="a-msg"></div>
      </div>` : ""}

      <div class="step" id="add-form" style="display:none">
        <div class="tabs">
          <button id="t-photo" class="on" onclick="setKind('photo')">A photo</button>
          <button id="t-letter" onclick="setKind('letter')">A few words</button>
        </div>
        <div id="k-photo">
          <label>Photo</label>
          <input type="file" id="s-file" accept="image/*">
          <label>Caption (optional)</label>
          <input type="text" id="s-title" maxlength="80" placeholder="Cousins, reunited">
        </div>
        <div id="k-letter" style="display:none">
          <label>Your words</label>
          <textarea id="s-text" maxlength="4000" placeholder="What I'll remember about that night…"></textarea>
        </div>
        <label>Your name (optional — for the credit)</label>
        <input type="text" id="s-name" maxlength="60" placeholder="Aunt May">
        ${holdersOnly ? "" : `<label>Your email (optional)</label><input type="email" id="s-email" maxlength="120" placeholder="you@email.com">`}
        <div style="font-size:.76rem;color:rgba(241,233,221,.5);line-height:1.5;margin:10px 0 4px">
          By sharing, you confirm you have the right to share this photo or note, and that anyone
          pictured is okay appearing in this event's vault. The curator reviews everything before
          it's published.
        </div>
        <button class="send" id="s-send" onclick="submitMemory()">Send to the curator</button>
        <div class="msg" id="s-msg"></div>
      </div>
    </div>` : ""}

    <div class="vfoot">Every ticket has a story</div>
  </main>

  <div class="lb" id="lb">
    <img id="lb-img" alt="">
    <div class="lb__cap" id="lb-cap"></div>
    <div class="lb__hint">Click anywhere or press Esc to close</div>
  </div>
  <script>
    (function(){
      var lb = document.getElementById('lb'), lbImg = document.getElementById('lb-img'), lbCap = document.getElementById('lb-cap');
      document.querySelectorAll('.ph').forEach(function(fig){
        var img = fig.querySelector('img');
        if (!img) return;
        img.addEventListener('click', function(){
          lbImg.src = img.src;
          lbImg.alt = img.alt || '';
          var cap = fig.querySelector('figcaption');
          lbCap.innerHTML = cap ? cap.innerHTML : '';
          lb.classList.add('on');
        });
      });
      lb.addEventListener('click', function(){ lb.classList.remove('on'); });
      document.addEventListener('keydown', function(e){ if (e.key === 'Escape') lb.classList.remove('on'); });
    })();
  </script>
  ${canSubmit && holdersOnly ? `<script src="/privy.js"></script>` : ""}
  ${canSubmit ? `
  <script>
    var VKEY = ${JSON.stringify(vaultKey || e.key || "")};
    var HOLDERS = ${holdersOnly ? "true" : "false"};
    var PRIVY_CFG = ${holdersOnly && privy ? JSON.stringify(privy) : "null"};
    var KIND = 'photo', privy = null, privyToken = null;

    function openAdd(){
      document.getElementById('add-cta').style.display = 'none';
      if (HOLDERS && !privyToken) {
        document.getElementById('add-auth').style.display = 'block';
        bootPrivy();
      } else {
        document.getElementById('add-form').style.display = 'block';
      }
    }
    function setKind(k){
      KIND = k;
      document.getElementById('t-photo').className = k === 'photo' ? 'on' : '';
      document.getElementById('t-letter').className = k === 'letter' ? 'on' : '';
      document.getElementById('k-photo').style.display = k === 'photo' ? 'block' : 'none';
      document.getElementById('k-letter').style.display = k === 'letter' ? 'block' : 'none';
    }

    async function bootPrivy(){
      if (privy || !PRIVY_CFG) return;
      try {
        privy = new TickPrivy.Privy({ appId: PRIVY_CFG.appId, clientId: PRIVY_CFG.clientId, storage: new TickPrivy.LocalStorage() });
        if (privy.initialize) await privy.initialize();
        var f = document.createElement('iframe');
        f.src = await Promise.resolve(privy.embeddedWallet.getURL());
        f.style.display = 'none';
        document.body.appendChild(f);
        privy.setMessagePoster(f.contentWindow);
        window.addEventListener('message', function(ev){ try { privy.embeddedWallet.onMessage(ev.data); } catch(_){} });
        // Live session? Skip the code dance.
        try {
          var u = await privy.user.get();
          if (u && (u.user || u.id)) { privyToken = await privy.getAccessToken(); showForm(); }
        } catch(_){}
      } catch (err) {
        document.getElementById('a-msg').className = 'msg err';
        document.getElementById('a-msg').textContent = 'Could not start sign-in. Refresh and try again.';
      }
    }
    function showForm(){
      var a = document.getElementById('add-auth'); if (a) a.style.display = 'none';
      document.getElementById('add-form').style.display = 'block';
    }
    async function authSend(){
      var m = document.getElementById('a-msg'); m.className = 'msg'; m.textContent = '';
      var email = document.getElementById('a-email').value.trim();
      if (!email || email.indexOf('@') < 1) { m.className = 'msg err'; m.textContent = 'Enter a valid email.'; return; }
      var btn = document.getElementById('a-send'); btn.disabled = true; btn.textContent = 'Sending…';
      try {
        await privy.auth.email.sendCode(email);
        document.getElementById('a-otp-wrap').style.display = 'block';
        m.textContent = 'Code sent — check your email.';
      } catch (err) { m.className = 'msg err'; m.textContent = 'Could not send the code.'; }
      btn.disabled = false; btn.textContent = 'Send my code';
    }
    async function authVerify(){
      var m = document.getElementById('a-msg'); m.className = 'msg'; m.textContent = '';
      var email = document.getElementById('a-email').value.trim();
      var otp = document.getElementById('a-otp').value.trim();
      var btn = document.getElementById('a-verify'); btn.disabled = true; btn.textContent = 'Verifying…';
      try {
        await privy.auth.email.loginWithCode(email, otp);
        privyToken = await privy.getAccessToken();
        showForm();
      } catch (err) { m.className = 'msg err'; m.textContent = 'That code did not verify.'; }
      btn.disabled = false; btn.textContent = 'Verify';
    }

    function submitMemory(){
      var m = document.getElementById('s-msg'); m.className = 'msg'; m.textContent = '';
      var btn = document.getElementById('s-send');
      var body = { type: KIND, name: document.getElementById('s-name').value };
      var emailEl = document.getElementById('s-email');
      if (emailEl) body.email = emailEl.value;
      if (HOLDERS) body.privyToken = privyToken;
      function send(){
        btn.disabled = true; btn.textContent = 'Sending…';
        fetch('/vault/' + encodeURIComponent(VKEY) + '/submit', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body)
        }).then(function(r){ return r.json(); }).then(function(d){
          btn.disabled = false; btn.textContent = 'Send to the curator';
          if (d.ok) {
            document.getElementById('add-form').style.display = 'none';
            document.getElementById('add-cta').style.display = 'block';
            document.getElementById('add-cta').innerHTML = '<div class="add__note" style="font-size:.95rem;color:var(--sage)">Sent \\u2713 &nbsp;Your memory is with the curator — it appears here once it\\u2019s approved. Thank you for adding to the story.</div>';
          } else { m.className = 'msg err'; m.textContent = d.error || 'Could not send.'; }
        }).catch(function(){ btn.disabled = false; btn.textContent = 'Send to the curator'; m.className = 'msg err'; m.textContent = 'Could not reach the server.'; });
      }
      if (KIND === 'photo') {
        var f = document.getElementById('s-file').files[0];
        if (!f) { m.className = 'msg err'; m.textContent = 'Choose a photo first.'; return; }
        if (f.size > 8 * 1024 * 1024) { m.className = 'msg err'; m.textContent = 'Photos are capped at 8 MB for now.'; return; }
        var reader = new FileReader();
        reader.onload = function(){ body.imageData = reader.result; body.title = document.getElementById('s-title').value; send(); };
        reader.readAsDataURL(f);
      } else {
        body.text = document.getElementById('s-text').value;
        if (!body.text.trim()) { m.className = 'msg err'; m.textContent = 'A memory needs some words.'; return; }
        send();
      }
    }
  </script>` : ""}
</body></html>`;
}

// ---------------------------------------------------------------------------
// The curation console (concierge-only).
// ---------------------------------------------------------------------------

function consolePage(key) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Vault curation — Ticklore</title>
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
  .sub{color:var(--sage);font-size:.85rem;margin-bottom:24px;font-family:ui-monospace,monospace}
  .sub a{color:var(--gold-bright)}
  .tabs{display:flex;gap:8px;margin-bottom:16px}
  .tabs button{flex:1;padding:10px;border-radius:6px;border:1px solid var(--line);background:transparent;
    color:var(--parchment);cursor:pointer;font-size:.9rem}
  .tabs button.on{background:var(--gold);color:var(--ink-deep);border-color:var(--gold);font-weight:600}
  label{display:block;font-size:.78rem;letter-spacing:.05em;color:var(--sage);margin:14px 0 6px;text-transform:uppercase}
  input[type=text],textarea{width:100%;background:var(--field);border:1px solid var(--line);color:var(--parchment);
    padding:11px 13px;border-radius:6px;font-size:.96rem}
  textarea{min-height:110px;resize:vertical}
  input[type=file]{margin-top:4px;color:var(--sage)}
  .go{width:100%;margin-top:18px;background:var(--gold);color:var(--ink-deep);border:0;border-radius:6px;
    padding:13px;font-weight:600;font-size:.98rem;cursor:pointer}
  .go:disabled{opacity:.6;cursor:wait}
  .msg{min-height:1.3em;margin-top:10px;font-size:.9rem}
  .msg.err{color:#E38A8A}
  .msg.ok{color:var(--sage)}
  .entries{margin-top:34px;border-top:1px solid var(--line);padding-top:20px}
  .entry{display:flex;align-items:center;gap:12px;padding:10px 12px;border:1px solid var(--line);
    border-radius:8px;margin-bottom:10px;background:var(--field)}
  .entry img{width:52px;height:52px;object-fit:cover;border-radius:6px}
  .entry__main{flex:1;min-width:0}
  .entry__t{font-size:.92rem;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .entry__m{font-size:.72rem;color:var(--sage);font-family:ui-monospace,monospace}
  .entry button{background:transparent;border:1px solid rgba(227,138,138,.4);color:#E38A8A;border-radius:6px;
    padding:6px 11px;font-size:.8rem;cursor:pointer}
</style></head>
<body>
<div class="gate" id="gate"><div class="gate__box">
  <div>Enter the admin password to curate this vault.</div>
  <input id="pw" type="password" placeholder="Admin password" autofocus>
  <button onclick="unlock()">Open curation</button>
  <div class="err" id="gerr"></div>
</div></div>

<div class="wrap" id="main" style="display:none">
  <h1 id="title">Vault curation</h1>
  <div class="sub" id="sub"></div>

  <div class="tabs">
    <button id="tab-photo" class="on" onclick="setTab('photo')">Add a photo</button>
    <button id="tab-letter" onclick="setTab('letter')">Add a letter</button>
  </div>

  <div id="pane-photo">
    <label>Photo</label>
    <input type="file" id="f-file" accept="image/*">
    <label>Caption (optional)</label>
    <input type="text" id="f-ptitle" maxlength="80" placeholder="The whole family, one frame">
    <label>Credit (optional)</label>
    <input type="text" id="f-pcredit" maxlength="60" placeholder="Photo: Aunt May">
  </div>
  <div id="pane-letter" style="display:none">
    <label>Title (optional)</label>
    <input type="text" id="f-ltitle" maxlength="80" placeholder="A note from the organizers">
    <label>The letter</label>
    <textarea id="f-ltext" maxlength="4000" placeholder="What a night it was…"></textarea>
    <label>Signed (optional)</label>
    <input type="text" id="f-lcredit" maxlength="60" placeholder="The Sullivan family">
  </div>

  <button class="go" id="go" onclick="submitEntry()">Publish to the vault</button>
  <div class="msg" id="msg"></div>

  <div class="entries">
    <div style="font-size:.8rem;letter-spacing:.1em;text-transform:uppercase;color:var(--gold);margin-bottom:12px">Published entries</div>
    <div id="list"><span style="color:var(--sage);font-size:.9rem">None yet.</span></div>
  </div>
</div>

<script>
  var KEY = ${JSON.stringify(key)};
  var PW = "", TAB = "photo";

  function unlock(){
    PW = document.getElementById('pw').value;
    fetch('/admin/vault/' + encodeURIComponent(KEY) + '/entries', { headers: { 'x-admin-password': PW } })
      .then(function(r){ if (!r.ok) throw 0; return r.json(); })
      .then(function(d){
        document.getElementById('gate').classList.add('hidden');
        document.getElementById('main').style.display = 'block';
        document.getElementById('title').textContent = 'Vault — ' + d.name;
        document.getElementById('sub').innerHTML = 'Curating the memory vault · <a href="/vault/' + encodeURIComponent(KEY) + '" target="_blank">view the public page &rarr;</a>';
        renderList(d.entries);
      })
      .catch(function(){ document.getElementById('gerr').textContent = 'Wrong password (or event not found).'; });
  }
  document.getElementById('pw').addEventListener('keydown', function(e){ if (e.key === 'Enter') unlock(); });

  function setTab(t){
    TAB = t;
    document.getElementById('tab-photo').className = t === 'photo' ? 'on' : '';
    document.getElementById('tab-letter').className = t === 'letter' ? 'on' : '';
    document.getElementById('pane-photo').style.display = t === 'photo' ? 'block' : 'none';
    document.getElementById('pane-letter').style.display = t === 'letter' ? 'block' : 'none';
  }

  function esc(s){ return String(s==null?'':s).replace(/[&<>"']/g, function(c){ return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]; }); }

  function renderList(entries){
    var list = document.getElementById('list');
    if (!entries.length) { list.innerHTML = '<span style="color:var(--sage);font-size:.9rem">None yet.</span>'; return; }
    var pending = entries.filter(function(e){ return e.status === 'pending'; }).length;
    document.getElementById('title').textContent = document.getElementById('title').textContent.replace(/ · \\d+ awaiting$/, '') + (pending ? ' · ' + pending + ' awaiting' : '');
    list.innerHTML = entries.map(function(e){
      var thumb = e.type === 'photo' && e.media ? '<img src="/vault-media/' + esc(e.media) + '">' : '';
      var t = e.type === 'photo' ? (e.title || 'Photo') : (e.title || (e.text || '').slice(0, 40) + '…');
      var who = e.submitter && (e.submitter.name || e.submitter.email)
        ? ' · from ' + esc(e.submitter.name || e.submitter.email) + (e.submitter.verified ? ' \\u2713holder' : '')
        : '';
      var pub = e.status === 'pending'
        ? '<button style="border-color:rgba(201,162,39,.6);color:var(--gold-bright)" onclick="publishEntry(this)">Publish</button>'
        : '';
      return '<div class="entry" data-id="' + esc(e.id) + '"' + (e.status === 'pending' ? ' style="border-color:rgba(201,162,39,.45)"' : '') + '>' + thumb
        + '<div class="entry__main"><div class="entry__t">' + esc(t) + '</div>'
        + '<div class="entry__m">' + e.type + ' · ' + (e.status) + (e.credit ? ' · ' + esc(e.credit) : '') + who + '</div></div>'
        + pub
        + '<button onclick="removeEntry(this)">Remove</button></div>';
    }).join('');
  }

  function publishEntry(btn){
    var id = btn.closest('.entry').getAttribute('data-id');
    fetch('/admin/vault/publish', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-password': PW }, body: JSON.stringify({ id: id }) })
      .then(function(r){ return r.json(); }).then(function(){ refresh(); });
  }

  function refresh(){
    fetch('/admin/vault/' + encodeURIComponent(KEY) + '/entries', { headers: { 'x-admin-password': PW } })
      .then(function(r){ return r.json(); }).then(function(d){ renderList(d.entries || []); });
  }

  function submitEntry(){
    var msg = document.getElementById('msg'); msg.className = 'msg'; msg.textContent = '';
    var btn = document.getElementById('go');
    var body = { type: TAB };
    if (TAB === 'letter') {
      body.title = document.getElementById('f-ltitle').value;
      body.text = document.getElementById('f-ltext').value;
      body.credit = document.getElementById('f-lcredit').value;
      if (!body.text.trim()) { msg.className = 'msg err'; msg.textContent = 'A letter needs some words.'; return; }
      send(body);
    } else {
      var f = document.getElementById('f-file').files[0];
      if (!f) { msg.className = 'msg err'; msg.textContent = 'Choose a photo first.'; return; }
      if (f.size > 8 * 1024 * 1024) { msg.className = 'msg err'; msg.textContent = 'Photos are capped at 8 MB for now.'; return; }
      var reader = new FileReader();
      reader.onload = function(){ body.imageData = reader.result; body.title = document.getElementById('f-ptitle').value; body.credit = document.getElementById('f-pcredit').value; send(body); };
      reader.readAsDataURL(f);
    }
    function send(payload){
      btn.disabled = true; btn.textContent = 'Publishing…';
      fetch('/admin/vault/' + encodeURIComponent(KEY) + '/add', {
        method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-password': PW },
        body: JSON.stringify(payload)
      }).then(function(r){ return r.json(); }).then(function(d){
        btn.disabled = false; btn.textContent = 'Publish to the vault';
        if (d.ok) {
          msg.className = 'msg ok'; msg.textContent = 'Published \\u2713';
          ['f-file','f-ptitle','f-pcredit','f-ltitle','f-ltext','f-lcredit'].forEach(function(id){ var el = document.getElementById(id); if (el) el.value = ''; });
          refresh();
        } else { msg.className = 'msg err'; msg.textContent = d.error || 'Could not publish.'; }
      }).catch(function(){ btn.disabled = false; btn.textContent = 'Publish to the vault'; msg.className = 'msg err'; msg.textContent = 'Could not reach the server.'; });
    }
  }

  function removeEntry(btn){
    var id = btn.closest('.entry').getAttribute('data-id');
    if (!confirm('Remove this entry from the vault?')) return;
    fetch('/admin/vault/remove', { method: 'POST', headers: { 'Content-Type': 'application/json', 'x-admin-password': PW }, body: JSON.stringify({ id: id }) })
      .then(function(r){ return r.json(); }).then(function(){ refresh(); });
  }
</script>
</body></html>`;
}

module.exports = { mountVault, vaultPage };
