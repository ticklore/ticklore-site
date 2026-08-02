/**
 * lib/concierge.js — the admin-only backend for sponsor keepsake events (Lane B).
 *
 * These events are NOT self-serve. Ticklore builds them by hand: define the
 * sponsors and how many tickets each one backs (their block), and the tool
 * creates the event on-chain (V3, which stores the sponsor list) and generates
 * one claim code per ticket, each tagged with its sponsor. Nothing mints yet —
 * tickets lazy-mint when attendees claim their codes (see lib/claims.js and the
 * /claim route). Usually free to the attendee; the sponsor funds it.
 *
 * Gated by ADMIN_PASSWORD, separate from the organizer password — only Ticklore
 * reaches this.
 */

const express = require("express");
const crypto = require("crypto");
const QRCode = require("qrcode");
const events = require("./events");
const claims = require("./claims");
const moderation = require("./moderation");
const names = require("./names");
const ticklorev3 = require("./ticklore-v3");
const ticklorev4 = require("./ticklore-v4");
const privyLib = require("./privy");

function mountConcierge(app, { chainV3, chainV4 }) {
  const PASSWORD = process.env.ADMIN_PASSWORD;
  const PUBLIC_URL = process.env.PUBLIC_URL || `http://localhost:${process.env.PORT || 3000}`;

  // The newest configured event-model contract does the work. V4 adds named
  // sections + the price-display switch; V3 (multi-sponsor only) is the
  // fallback until the flip.
  const activeChain = chainV4 || chainV3;
  const activeLib = chainV4 ? ticklorev4 : ticklorev3;
  const activeVersion = chainV4 ? 4 : 3;

  // Privy (optional, env-gated like every other flip — see lib/privy.js).
  // When configured, the claim flow upgrades: email OTP proves the claimant
  // owns the address, and the keepsake mints straight into THEIR embedded
  // wallet. Without the env vars, claims keep the custodial email flow.
  const PRIVY = privyLib.config;
  const privyClient = !!PRIVY;
  const privyWalletFromToken = privyLib.walletFromToken;

  function checkPassword(req, res, next) {
    if (!PASSWORD) {
      return res.status(500).json({ error: "Concierge access is not configured (ADMIN_PASSWORD unset)." });
    }
    const given = req.get("x-admin-password") || "";
    const a = Buffer.from(given), b = Buffer.from(PASSWORD);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: "Wrong password." });
    }
    next();
  }

  /** Create a sponsor event: record it on-chain (V3, with the sponsor list),
   *  store it as a sponsor-mode event, and generate one claim code per ticket. */
  app.post("/admin/create", express.json(), checkPassword, async (req, res) => {
    try {
      if (!activeChain) {
        throw new Error("Sponsor events need the V3+ contract — set TICKLORE_CONTRACT_V4 (or _V3).");
      }
      const body = req.body || {};

      // Turn the block rows [{leadIn, name, count, priceDollars, section}] into
      // the on-chain sponsor + section lists and the blocks that drive code
      // generation. Refs are 1-based, in on-chain order.
      // THE BATCH IS THE PRODUCT: a block may have NO sponsor (plain tickets the
      // organizer sells however they like — sponsorRef 0), each block can carry
      // a price (what the buyer pays the ORGANIZER directly, engraved), and on
      // V4 a block can name its SECTION ("Table 7") — the seat as memory.
      const rawBlocks = Array.isArray(body.blocks) ? body.blocks : [];
      const sponsors = [];
      const sections = [];
      const blocks = [];
      for (const b of rawBlocks) {
        const count = Math.max(0, Math.floor(Number(b.count) || 0));
        if (count < 1) continue; // skip empty rows
        const name = String(b.name || "").trim();
        const leadIn = String(b.leadIn || "").trim();
        const dollars = Number(b.priceDollars) || 0;
        if (dollars < 0) throw new Error("A block price can't be negative.");
        if (dollars > 100000) throw new Error("A block price seems too high — is that right?");
        const priceCents = Math.round(dollars * 100);

        // Sections dedup: two blocks naming "Table 7" share one on-chain entry.
        const section = String(b.section || "").trim().slice(0, 32);
        let sectionRef = 0;
        if (section) {
          const existing = sections.findIndex((s) => s.toLowerCase() === section.toLowerCase());
          sectionRef = existing >= 0 ? existing + 1 : sections.push(section);
        }

        // Online blocks are sold through the card payment gate — their codes
        // are never printed; the webhook emails them out one per payment.
        const online = b.online === true || b.online === "true";

        if (name) {
          sponsors.push({ leadIn, name });
          blocks.push({ sponsorRef: sponsors.length, count, sponsorName: name, priceCents, sectionRef, section, online });
        } else {
          blocks.push({ sponsorRef: 0, count, sponsorName: "", priceCents, sectionRef, section, online });
        }
      }
      if (!blocks.length) throw new Error("Add at least one block with a ticket count of 1 or more.");
      if (sections.length && activeVersion < 4) throw new Error("Sections need the V4 contract — set TICKLORE_CONTRACT_V4.");

      const totalTickets = blocks.reduce((s, b) => s + b.count, 0);
      if (totalTickets > 1000) throw new Error("That's over 1000 tickets — split it into more than one event for now.");

      const showPrice = !(body.showPrice === false || body.showPrice === "false");

      // Discreet event (privacy defaults, docs/privacy-defaults.md): one flag
      // sets the whole posture — soulbound keepsakes (can never leave the
      // community), holders-only vault viewing AND submissions. The on-chain
      // name should be neutral; the form reminds the admin before creating.
      const discreet = body.discreet === true || body.discreet === "true";

      // 1) On-chain event (records the sponsor + section lists, permanent).
      const ev = await activeLib.createEvent(activeChain.contract, {
        name: body.name, venue: body.venue, date: body.date, palette: body.palette,
        sponsors, sections, showPrice, inscriptionsAllowed: false, soulbound: discreet,
      });

      // 2) Store it as a sponsor-mode event (free; not shown in the public shop).
      const activationRequired = body.activationRequired === true || body.activationRequired === "true";
      const { key } = events.create({
        name: body.name, venue: body.venue, date: body.date, palette: body.palette,
        priceDollars: 0, sponsors, sections, showPrice, mode: "sponsor", blocks,
        onChainEventId: ev.eventId, onChainVersion: activeVersion,
        allowInscription: false, soulbound: discreet,
        redemptionEnabled: body.redemptionEnabled === true || body.redemptionEnabled === "true",
        vaultSubmissions: discreet ? "holders" : body.vaultSubmissions,
        vaultVisibility: discreet ? "holders" : "public",
        activationRequired,
      });
      const stored = events.get(key);

      // 3) One claim code per ticket in every block (print codes start dormant
      //    when activation is on; online codes are born active).
      const codes = claims.generate(key, blocks, { activationRequired });

      res.json({
        ok: true, key, eventId: ev.eventId, codeCount: codes.length,
        sellerPin: stored ? stored.sellerPin : null,
        onlineCount: codes.filter((c) => c.channel === "online").length,
      });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  /** List sponsor events with claim stats, for the admin console. */
  app.get("/admin/events", checkPassword, (req, res) => {
    const sponsorEvents = events.list()
      .filter((e) => e.mode === "sponsor")
      .map((e) => ({
        key: e.key, name: e.name, venue: e.venue, date: e.date,
        onChainEventId: e.onChainEventId, blocks: e.blocks || [],
        ...claims.statsByEvent(e.key),
      }));
    res.json({ events: sponsorEvents });
  });

  /** Delete a sponsor event and its claim codes. */
  app.post("/admin/delete", express.json(), checkPassword, (req, res) => {
    const key = (req.body && req.body.key) || "";
    if (!key) return res.status(400).json({ ok: false, error: "Missing event key." });
    const removed = events.remove(key);
    claims.removeByEvent(key);
    if (!removed) return res.status(404).json({ ok: false, error: "No such event." });
    res.json({ ok: true, key });
  });

  /** JSON: an event's codes with their claim URLs + a QR SVG each, for the
   *  printable sheet. QR is rendered server-side (no external calls at print). */
  app.get("/admin/event/:key/codes", checkPassword, async (req, res) => {
    const e = events.get(req.params.key);
    if (!e || e.mode !== "sponsor") return res.status(404).json({ error: "No such sponsor event." });
    const codes = await Promise.all(
      // Online codes never print — they're sold and delivered by email.
      claims.listByEvent(req.params.key).filter((c) => c.channel !== "online").map(async (c) => {
        const url = `${PUBLIC_URL}/claim/${c.code}`;
        let qr = "";
        try { qr = await QRCode.toString(url, { type: "svg", margin: 1 }); } catch { /* leave blank */ }
        return { code: c.code, sponsorRef: c.sponsorRef, sponsorName: c.sponsorName, priceCents: c.priceCents || 0, section: c.section || "", status: c.status, url, qr };
      })
    );
    res.json({ name: e.name, venue: e.venue, date: e.date, codes });
  });

  /** The "who came?" list — every code's full story as a CSV the organizer can
   *  open in Excel. Contains emails/addresses, so it's admin-gated like the
   *  backup and downloaded via fetch+blob from the console. */
  app.get("/admin/event/:key/claims.csv", checkPassword, (req, res) => {
    const e = events.get(req.params.key);
    if (!e || e.mode !== "sponsor") return res.status(404).json({ error: "No such sponsor event." });
    const cell = (v) => {
      const s = String(v == null ? "" : v);
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const rows = [[
      "code", "channel", "status", "active", "sponsor", "section", "price",
      "email", "wallet", "ticket", "claimedAt", "admittedAt", "soldOnlineTo",
    ].join(",")];
    for (const c of claims.listByEvent(req.params.key)) {
      rows.push([
        c.code, c.channel || "print", c.status, c.active === false ? "dormant" : "active",
        c.sponsorName || "", c.section || "", c.priceCents ? (c.priceCents / 100).toFixed(2) : "0",
        c.email || "", c.address || "", c.tokenId || "", c.claimedAt || "", c.redeemedAt || "",
        c.assignedTo || "",
      ].map(cell).join(","));
    }
    res.type("text/csv").send(rows.join("\n"));
  });

  /** The printable code sheet — a client-gated page (opened in a new tab, so it
   *  can't carry the admin header; it asks for the password, then fetches). */
  app.get("/admin/event/:key/sheet", (req, res) => {
    res.type("html").send(sheetPage(req.params.key));
  });

  // --- Public claim flow (Lane B tickets lazy-mint here) --------------------

  /** The claim page for one code. Public — the code itself is the credential. */
  app.get("/claim/:code", (req, res) => {
    const rec = claims.get(req.params.code);
    const details = rec ? events.get(rec.eventKey) : null;
    // Prefill personalization typed earlier (e.g. on the shop's buy form) —
    // display-only convenience; the POST is the moderated source of truth.
    const prefill = { name: String(req.query.name || "").slice(0, 32), msg: String(req.query.msg || "").slice(0, 42) };
    res.type("html").send(claimPage({ code: req.params.code, rec, details, privy: PRIVY, prefill }));
  });

  /** Claim a code: lazy-mint the ticket (with its sponsor + section) on the
   *  contract version its event was created on. Reserve→mint→finalize so one
   *  code mints once. */
  app.post("/claim/:code", express.json(), async (req, res) => {
    const code = req.params.code;
    try {
      if (!activeChain) throw new Error("Claiming isn't available right now.");
      const rec = claims.get(code);
      if (!rec) return res.status(404).json({ ok: false, error: "That claim code isn't valid." });
      if (rec.status === "claimed") return res.status(409).json({ ok: false, error: "already claimed", tokenId: rec.tokenId });
      // Seller activation: a dormant card hasn't been sold yet — no mint until
      // the desk activates it. A photographed card is worthless paper.
      if (rec.active === false) {
        return res.status(403).json({ ok: false, error: "This ticket hasn't been activated yet — see the ticket desk." });
      }

      const details = events.get(rec.eventKey);
      if (!details || !details.onChainEventId) throw new Error("This event is no longer available.");

      // Personalization at claim — only when the organizer allowed it, and
      // ALWAYS through the moderation gate before anything mints (engravings
      // are forever; a rejected line costs a rephrase, not a claim). Privacy
      // default: full surnames never reach the chain — "Alex Winfield"
      // becomes "Alex W." right here at the seam (see lib/names.js).
      const buyerName = details.allowInscription
        ? names.keepsakeName(String((req.body && req.body.buyerName) || "").trim().slice(0, 32))
        : "";
      const inscription = details.allowInscription ? String((req.body && req.body.inscription) || "").trim().slice(0, 42) : "";
      const mod = moderation.checkInscription({ buyerName, inscription });
      if (!mod.ok) return res.status(400).json({ ok: false, error: mod.reason });

      // Who gets the ticket? With Privy configured, the claimant proves their
      // login (OTP) and the mint goes to THEIR embedded wallet. Without it,
      // platform custody against a typed email (the original flow).
      let to = activeChain.signer.address;
      let email = String((req.body && req.body.email) || "").trim();
      let owned = false;
      if (privyClient) {
        const token = String((req.body && req.body.privyToken) || "");
        if (!token) return res.status(401).json({ ok: false, error: "Sign in to claim this keepsake." });
        const w = await privyWalletFromToken(token); // throws on a bad/expired token
        to = w.address;
        email = w.email || email;
        owned = true;
      }

      const reserved = claims.reserve(code);
      if (!reserved) return res.status(409).json({ ok: false, error: "That code is already being claimed." });

      try {
        // An event's ids only mean anything on the contract that created it —
        // mint on that version, not blindly on the newest.
        const mintChain = details.onChainVersion === 4 ? chainV4 : chainV3;
        const mintLib = details.onChainVersion === 4 ? ticklorev4 : ticklorev3;
        if (!mintChain) throw new Error("This event's contract isn't configured right now.");
        const r = await mintLib.mintTicket(mintChain.contract, {
          eventId: details.onChainEventId,
          to,
          price: rec.priceCents || 0, // what the buyer pays the organizer; 0 renders "Free"
          buyerName,
          inscription,
          sponsorRef: rec.sponsorRef,
          sectionRef: rec.sectionRef || 0,
        });
        claims.finalize(code, { email, tokenId: r.tokenId, address: owned ? to : null });
        res.json({ ok: true, tokenId: r.tokenId, owned, address: owned ? to : undefined, version: details.onChainVersion || undefined });

        // Claim receipt — after the response on purpose. The keepsake already
        // exists on-chain; a mail failure costs a notification, never a claim.
        require("./email").sendClaimEmail({
          to: email,
          eventName: details.name,
          ticketId: r.tokenId,
          claimUrl: `${PUBLIC_URL}/claim/${code}`,
          vaultUrl: `${PUBLIC_URL}/vault/${encodeURIComponent(rec.eventKey)}`,
          owned,
        }).then((m) => console.log(m.sent
          ? `  ✉ claim receipt → ${email} (${m.id})`
          : `  ⚠ claim receipt not sent: ${m.reason}`));
      } catch (err) {
        claims.release(code); // mint never landed — the code stays claimable
        throw err;
      }
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  // --- Door check-in (redemption) -------------------------------------------
  // Per-event opt-in. Staff (Ticklore, at concierge events) opens the same
  // claim link the attendee holds, follows "Door check-in", enters the admin
  // password, and the server flips the contract's redeem flag — the keepsake
  // gains its ADMITTED stamp on-chain. Never a burn.

  // --- Seller activation (cash sales, gift-card model) ----------------------
  // When an event requires activation, printed cards are DORMANT until the
  // desk activates them at the moment of sale — with the event's seller PIN,
  // not the admin password, so volunteers never hold the master key.

  /** The activation page for one code. Public page; the ACTION needs the PIN. */
  app.get("/activate/:code", (req, res) => {
    const rec = claims.get(req.params.code);
    const details = rec ? events.get(rec.eventKey) : null;
    res.type("html").send(activatePage({ code: req.params.code, rec, details }));
  });

  /** Activate a dormant code at the point of sale. */
  app.post("/activate/:code", express.json(), (req, res) => {
    try {
      const rec = claims.get(req.params.code);
      if (!rec) return res.status(404).json({ ok: false, error: "That code isn't valid." });
      const details = events.get(rec.eventKey);
      if (!details || !details.activationRequired || !details.sellerPin) {
        return res.status(400).json({ ok: false, error: "This event doesn't use activation." });
      }
      if (rec.active) return res.json({ ok: true, already: true });

      const given = String((req.body && req.body.pin) || "").trim();
      const a = Buffer.from(given), b = Buffer.from(String(details.sellerPin));
      if (!given || a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ ok: false, error: "Wrong PIN." });
      }
      claims.activate(req.params.code);
      res.json({ ok: true });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  /** The door page for one code. Public page; the redeem ACTION is gated. */
  app.get("/door/:code", (req, res) => {
    const rec = claims.get(req.params.code);
    const details = rec ? events.get(rec.eventKey) : null;
    res.type("html").send(doorPage({ code: req.params.code, rec, details }));
  });

  /** Redeem a claimed ticket at the door. Gated by ADMIN_PASSWORD in the body. */
  app.post("/door/:code", express.json(), async (req, res) => {
    try {
      if (!PASSWORD) return res.status(500).json({ ok: false, error: "Door check-in is not configured." });
      const given = String((req.body && req.body.password) || "");
      const a = Buffer.from(given), b = Buffer.from(PASSWORD);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return res.status(401).json({ ok: false, error: "Wrong password." });
      }

      const rec = claims.get(req.params.code);
      if (!rec) return res.status(404).json({ ok: false, error: "That code isn't valid." });
      const details = events.get(rec.eventKey);
      if (!details || !details.redemptionEnabled) {
        return res.status(400).json({ ok: false, error: "Door check-in isn't enabled for this event." });
      }
      if (rec.status !== "claimed" || !rec.tokenId) {
        return res.status(400).json({ ok: false, error: "This ticket hasn't been claimed yet — claim it first, then check in." });
      }
      if (rec.redeemedAt) {
        return res.status(409).json({ ok: false, error: "Already admitted.", redeemedAt: rec.redeemedAt });
      }
      const redeemChain = details.onChainVersion === 4 ? chainV4 : chainV3;
      const redeemLib = details.onChainVersion === 4 ? ticklorev4 : ticklorev3;
      if (!redeemChain) throw new Error("Check-in isn't available right now.");

      try {
        await redeemLib.redeemTicket(redeemChain.contract, rec.tokenId);
      } catch (err) {
        // The chain is the truth: if it says already redeemed, mirror and accept.
        if (/already redeemed/i.test(String(err?.shortMessage || err?.reason || err?.message || ""))) {
          claims.markRedeemed(req.params.code);
          return res.status(409).json({ ok: false, error: "Already admitted." });
        }
        throw err;
      }
      claims.markRedeemed(req.params.code);
      res.json({ ok: true, tokenId: rec.tokenId });
    } catch (err) {
      res.status(400).json({ ok: false, error: err.message });
    }
  });

  /** The concierge console page. Password gate is client-side (in-memory). */
  app.get("/admin", (req, res) => {
    res.type("html").send(adminPage());
  });
}

function adminPage() {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticklore — Concierge</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,600;1,9..144,500&family=IBM+Plex+Mono:wght@400;500&family=Work+Sans:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root{--ink:#0E262B;--ink-deep:#081619;--parchment:#F1E9DD;--gold:#C9A227;--gold-bright:#E3C25E;
    --teal:#2FAF93;--sage:#7FB3A6;--line:rgba(241,233,221,.14);--field:rgba(241,233,221,.05)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--ink);color:var(--parchment);font-family:'Work Sans',sans-serif;line-height:1.5}
  .mono{font-family:'IBM Plex Mono',monospace}
  .gate{position:fixed;inset:0;background:var(--ink-deep);z-index:50;display:flex;align-items:center;justify-content:center;padding:24px}
  .gate.hidden{display:none}
  .gate__box{max-width:380px;width:100%;text-align:center}
  .gate h1{font-family:'Fraunces',serif;font-weight:600;font-size:1.6rem;margin-bottom:6px}
  .gate p{color:rgba(241,233,221,.6);font-size:.92rem;margin-bottom:22px}
  .gate input{width:100%;background:var(--field);border:1px solid var(--line);color:var(--parchment);
    padding:13px 15px;border-radius:6px;font-size:1rem;text-align:center;margin-bottom:12px}
  .gate button{width:100%;background:var(--gold);color:var(--ink-deep);border:0;border-radius:6px;padding:13px;font-weight:600;cursor:pointer}
  .gate .err{color:#E38A8A;font-size:.85rem;min-height:1.2em;margin-top:8px}
  header{padding:40px 24px 6px;text-align:center}
  .brand{font-family:'Fraunces',serif;font-size:1.7rem;font-weight:600}
  .brand em{font-style:italic;color:var(--gold-bright)}
  .tag{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);margin-top:6px}
  .wrap{max-width:760px;margin:0 auto;padding:20px 24px 80px}
  .field{margin-bottom:16px}
  label{display:block;font-size:.8rem;letter-spacing:.04em;color:var(--sage);margin-bottom:6px;text-transform:uppercase}
  input[type=text],input[type=number],input[type=date],select{width:100%;background:var(--field);
    border:1px solid var(--line);color:var(--parchment);padding:11px 14px;border-radius:6px;font-size:.98rem;font-family:'Work Sans',sans-serif}
  input:focus,select:focus{outline:none;border-color:var(--gold)}
  select option{background:#0b1c20}
  .row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  .section-label{font-family:'IBM Plex Mono',monospace;font-size:.72rem;letter-spacing:.16em;text-transform:uppercase;
    color:var(--gold);margin:24px 0 12px;padding-top:16px;border-top:1px solid var(--line)}
  .block-row{display:grid;grid-template-columns:1fr 1.2fr 70px 85px 110px auto auto;gap:8px;margin-bottom:10px;align-items:center}
  .b-online{display:flex;align-items:center;gap:5px;font-size:.74rem;color:var(--sage);white-space:nowrap;cursor:pointer}
  .b-online input{width:auto;margin:0}
  .block-row input{width:100%}
  .blk-del{background:transparent;border:1px solid rgba(227,138,138,.4);color:#E38A8A;border-radius:6px;height:42px;padding:0 12px;cursor:pointer}
  .blk-del:hover{background:rgba(227,138,138,.12)}
  .add-block{background:transparent;border:1px dashed var(--line);color:var(--gold-bright);border-radius:6px;
    padding:9px 14px;font-size:.86rem;cursor:pointer;font-family:'IBM Plex Mono',monospace}
  .add-block:hover{border-color:var(--gold)}
  .hint{font-size:.78rem;color:rgba(241,233,221,.45);margin-top:5px}
  .total{font-family:'IBM Plex Mono',monospace;color:var(--sage);font-size:.85rem;margin-top:8px}
  .create{width:100%;background:var(--gold);color:var(--ink-deep);border:0;border-radius:6px;padding:14px;
    font-weight:600;font-size:1rem;cursor:pointer;margin-top:18px}
  .create:hover{background:var(--gold-bright)}
  .create:disabled{opacity:.6;cursor:wait}
  .result{margin-top:14px;font-size:.92rem;min-height:1.2em}
  .result a{color:var(--gold-bright)}
  .result.err{color:#E38A8A}
  .ev{display:flex;align-items:center;gap:14px;padding:12px 14px;border:1px solid var(--line);border-radius:8px;margin-bottom:10px;background:var(--field)}
  .ev__main{flex:1;min-width:0}
  .ev__name{font-family:'Fraunces',serif;font-size:1.02rem}
  .ev__meta{font-size:.78rem;color:rgba(241,233,221,.55);font-family:'IBM Plex Mono',monospace}
  .ev__sheet{font-size:.82rem;color:var(--gold-bright);text-decoration:none;white-space:nowrap}
  .ev__sheet:hover{text-decoration:underline}
  .ev__del{background:transparent;border:1px solid rgba(227,138,138,.4);color:#E38A8A;border-radius:6px;padding:7px 12px;font-size:.82rem;cursor:pointer}
</style></head>
<body>
<div class="gate" id="gate">
  <div class="gate__box">
    <h1>Concierge access</h1>
    <p>Ticklore-only. Enter the admin password.</p>
    <input id="pw" type="password" placeholder="Admin password" autofocus>
    <button onclick="unlock()">Enter</button>
    <div class="err" id="gate-err"></div>
  </div>
</div>

<header>
  <div class="brand">Tick<em>lore</em></div>
  <div class="tag">Concierge · Sponsor Keepsakes</div>
</header>

<div class="wrap">
  <div class="row">
    <div class="field"><label for="f-name">Event name</label><input type="text" id="f-name" placeholder="The Founders Cup Scramble"></div>
    <div class="field"><label for="f-venue">Venue</label><input type="text" id="f-venue" placeholder="Pinehurst, NC" maxlength="60"></div>
  </div>
  <div class="row">
    <div class="field"><label for="f-date">Event date</label><input type="date" id="f-date"></div>
    <div class="field"><label for="f-palette">Color</label><select id="f-palette"></select></div>
  </div>

  <div class="section-label">Ticket blocks</div>
  <div id="block-list"></div>
  <button type="button" class="add-block" onclick="addBlock()">+ Add a block</button>
  <div class="hint">Each row is a block of tickets. <b>Sponsor is optional</b> — leave it blank for plain
  tickets the organizer sells themselves. <b>Price</b> is what the buyer pays the organizer directly
  (engraved on the keepsake); blank or 0 shows "Free". <b>Section</b> ("Table 7", "VIP") is engraved as
  part of the memory — blocks naming the same section share it. Ticklore never touches ticket money.</div>
  <div class="total" id="total"></div>

  <div class="field" style="margin-top:14px">
    <label class="toggle" style="display:flex;align-items:center;gap:10px;cursor:pointer">
      <input type="checkbox" id="f-showprice" checked style="width:auto">
      <span style="font-size:.9rem;color:rgba(241,233,221,.8)">Show prices on the keepsakes</span>
    </label>
    <div class="hint">On: each ticket shows its true price ($25 / Free). Off: no price appears at all — right for gifts and fully sponsored events.</div>
  </div>

  <div class="section-label">Door check-in — optional</div>
  <label style="display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none">
    <input type="checkbox" id="f-redemption" style="width:auto">
    <span style="font-size:.9rem;color:rgba(241,233,221,.8)">Enable door check-in (redeem at the gate)</span>
  </label>
  <div class="hint">Off = keepsake only. On = staff can mark each claimed ticket admitted at the door — the keepsake gains its permanent ADMITTED stamp. Never deletes or burns anything.</div>

  <div class="section-label">Privacy</div>
  <label style="display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none">
    <input type="checkbox" id="f-discreet" style="width:auto">
    <span style="font-size:.9rem;color:rgba(241,233,221,.8)"><b>Discreet event</b> — privacy-first posture, one tap</span>
  </label>
  <div class="hint">Sets everything at once: keepsakes are <b>permanently non-transferable</b> (they can
  never leave the community), and the vault — photos AND write-ups — is <b>visible only to keepsake
  holders</b>, never indexed, with holder-only submissions. Keepsake names always render first name +
  last initial. <b>⚠ Use a NEUTRAL event name</b> — the name is engraved on a public ledger forever;
  let the vault carry the meaning, not the chain.</div>

  <label style="display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none;margin-top:14px">
    <input type="checkbox" id="f-activation" style="width:auto">
    <span style="font-size:.9rem;color:rgba(241,233,221,.8)">Require desk activation for printed cards (gift-card model)</span>
  </label>
  <div class="hint">On = printed cards are DORMANT until the seller activates each one at the moment of sale
  with a per-event seller PIN (shown after you create — give it to the desk, never the admin password).
  A stolen or photographed card is worthless paper. Online-sold codes are always active.</div>

  <div class="section-label">Vault memories</div>
  <label style="display:flex;align-items:center;gap:10px;cursor:pointer;user-select:none">
    <input type="checkbox" id="f-holders" style="width:auto">
    <span style="font-size:.9rem;color:rgba(241,233,221,.8)">Holders-only submissions (verified keepsake holders)</span>
  </label>
  <div class="hint">Off (default) = anyone with the vault link can submit a memory — nothing publishes without
  your approval either way. On = submitters must sign in and hold a keepsake from this event; for
  sensitive gatherings, same instinct as soulbound.</div>

  <button class="create" id="create" onclick="create()">Create event &amp; generate codes</button>
  <div class="result" id="result"></div>

  <div class="section-label">Your sponsor events</div>
  <div id="ev-list"><div class="hint">None yet.</div></div>

  <div class="section-label">Housekeeping</div>
  <button type="button" class="add-block" onclick="downloadBackup(this)">&#8681; Download full backup (stores + vault media)</button>
  <div class="hint" id="backup-hint">Everything off-chain in one archive — the custody ledger, claim codes, events, vault.
  A nightly snapshot also emails automatically when BACKUP_EMAIL is set in the environment.</div>
</div>

<script>
  var PW = "";
  function unlock(){
    PW = document.getElementById('pw').value;
    fetch('/admin/events', { headers: { 'x-admin-password': PW } })
      .then(function(r){ if(r.ok){ document.getElementById('gate').classList.add('hidden'); loadEvents(); } else { document.getElementById('gate-err').textContent='Wrong password.'; } })
      .catch(function(){ document.getElementById('gate-err').textContent='Could not reach the server.'; });
  }
  document.getElementById('pw').addEventListener('keydown', function(e){ if(e.key==='Enter') unlock(); });

  function esc(s){ return String(s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c];}); }

  var PALETTES = { teal:'Teal & Gold', midnight:'Midnight & Silver', burgundy:'Burgundy & Gold', forest:'Forest & Cream', plum:'Plum & Rose' };
  (function(){ var s=document.getElementById('f-palette'); for(var k in PALETTES){var o=document.createElement('option');o.value=k;o.textContent=PALETTES[k];s.appendChild(o);} })();

  function addBlock(leadIn, name, count, price, section){
    var row = document.createElement('div');
    row.className = 'block-row';
    row.innerHTML =
      '<input type="text" class="b-lead" placeholder="Supported by (optional)" maxlength="28" oninput="tally()">' +
      '<input type="text" class="b-name" placeholder="Sponsor (optional)" maxlength="44" oninput="tally()">' +
      '<input type="number" class="b-count" placeholder="Qty" min="1" step="1" oninput="tally()">' +
      '<input type="number" class="b-price" placeholder="Price $" min="0" step="1" oninput="tally()">' +
      '<input type="text" class="b-section" placeholder="Section (opt.)" maxlength="32" oninput="tally()">' +
      '<label class="b-online" title="Sold through the card payment gate — never printed"><input type="checkbox" class="b-onl" onchange="tally()">online</label>' +
      '<button type="button" class="blk-del" title="Remove" onclick="removeBlock(this)">&#10005;</button>';
    document.getElementById('block-list').appendChild(row);
    if (leadIn) row.querySelector('.b-lead').value = leadIn;
    if (name) row.querySelector('.b-name').value = name;
    if (count) row.querySelector('.b-count').value = count;
    if (price) row.querySelector('.b-price').value = price;
    if (section) row.querySelector('.b-section').value = section;
    tally();
  }
  function removeBlock(btn){ var r=btn.closest('.block-row'); if(r) r.remove(); tally(); }
  function collectBlocks(){
    var rows = document.querySelectorAll('#block-list .block-row'), out=[];
    for (var i=0;i<rows.length;i++){
      var name=rows[i].querySelector('.b-name').value.trim();
      var count=parseInt(rows[i].querySelector('.b-count').value,10)||0;
      var leadIn=rows[i].querySelector('.b-lead').value.trim();
      var price=parseFloat(rows[i].querySelector('.b-price').value)||0;
      var section=rows[i].querySelector('.b-section').value.trim();
      var online=rows[i].querySelector('.b-onl').checked;
      if (count>0) out.push({ leadIn:leadIn, name:name, count:count, priceDollars:price, section:section, online:online });
    }
    return out;
  }
  function tally(){
    var b=collectBlocks(), tickets=b.reduce(function(s,x){return s+x.count;},0);
    var sponsored=b.filter(function(x){return x.name;}).length;
    var online=b.filter(function(x){return x.online;}).reduce(function(s,x){return s+x.count;},0);
    document.getElementById('total').textContent = b.length
      ? (tickets + ' ticket' + (tickets===1?'':'s') + ' in ' + b.length + ' block' + (b.length===1?'':'s')
         + (sponsored ? ' · ' + sponsored + ' sponsored' : ' · no sponsors')
         + (online ? ' · ' + online + ' sold online' : ''))
      : '';
  }

  function create(){
    var btn=document.getElementById('create'), out=document.getElementById('result');
    out.className='result'; out.textContent='';
    var blocks=collectBlocks();
    if (!blocks.length){ out.className='result err'; out.textContent='Add at least one block with a ticket count.'; return; }
    var body = {
      name: document.getElementById('f-name').value,
      venue: document.getElementById('f-venue').value,
      date: document.getElementById('f-date').value,
      palette: document.getElementById('f-palette').value,
      blocks: blocks,
      redemptionEnabled: document.getElementById('f-redemption').checked,
      activationRequired: document.getElementById('f-activation').checked,
      discreet: document.getElementById('f-discreet').checked,
      showPrice: document.getElementById('f-showprice').checked,
      vaultSubmissions: document.getElementById('f-holders').checked ? 'holders' : 'open'
    };
    btn.disabled=true; btn.textContent='Creating on-chain…';
    fetch('/admin/create',{method:'POST',headers:{'Content-Type':'application/json','x-admin-password':PW},body:JSON.stringify(body)})
      .then(function(r){return r.json()}).then(function(d){
        if (d.ok){
          btn.textContent='Created \\u2713';
          out.className='result';
          out.innerHTML='Created <span class="mono">'+esc(d.key)+'</span> — event #'+d.eventId+', '+d.codeCount+' claim codes'
            + (d.onlineCount ? ' ('+d.onlineCount+' reserved for online sale)' : '') + '. '
            + (d.sellerPin ? '<br><b style="color:var(--gold-bright)">Seller PIN: <span class="mono">'+esc(d.sellerPin)+'</span></b> — write it down for the ticket desk; it activates cards at sale. ' : '')
            + '<a href="/admin/event/'+encodeURIComponent(d.key)+'/sheet" target="_blank">Open the code sheet &rarr;</a>'
            + ' &nbsp;<a href="#" onclick="resetForm();return false;">New event &rarr;</a>';
          loadEvents();
        } else {
          btn.disabled=false; btn.textContent='Create event & generate codes';
          out.className='result err'; out.textContent=d.error || 'Something went wrong.';
        }
      }).catch(function(){ btn.disabled=false; btn.textContent='Create event & generate codes'; out.className='result err'; out.textContent='Could not reach the server.'; });
  }
  function resetForm(){
    ['f-name','f-venue','f-date'].forEach(function(id){ document.getElementById(id).value=''; });
    document.getElementById('f-redemption').checked=false;
    document.getElementById('f-activation').checked=false;
    document.getElementById('f-discreet').checked=false;
    document.getElementById('f-holders').checked=false;
    document.getElementById('f-showprice').checked=true;
    document.getElementById('block-list').innerHTML='';
    document.getElementById('f-palette').selectedIndex=0;
    document.getElementById('total').textContent='';
    var out=document.getElementById('result'); out.textContent=''; out.className='result';
    var btn=document.getElementById('create'); btn.disabled=false; btn.textContent='Create event & generate codes';
  }

  function loadEvents(){
    fetch('/admin/events',{headers:{'x-admin-password':PW}}).then(function(r){return r.ok?r.json():{events:[]}}).then(function(d){
      var evs=d.events||[], list=document.getElementById('ev-list');
      if(!evs.length){ list.innerHTML='<div class="hint">None yet.</div>'; return; }
      list.innerHTML = evs.map(function(e){
        return '<div class="ev" data-key="'+esc(e.key)+'">'
          + '<div class="ev__main"><div class="ev__name">'+esc(e.name)+'</div>'
          + '<div class="ev__meta">'+esc(e.date||'')+' &middot; '+e.claimed+'/'+e.total+' claimed &middot; event #'+esc(String(e.onChainEventId||'?'))+'</div></div>'
          + '<a class="ev__sheet" href="/admin/event/'+encodeURIComponent(e.key)+'/sheet" target="_blank">Codes &rarr;</a>'
          + '<a class="ev__sheet" href="/admin/vault/'+encodeURIComponent(e.key)+'" target="_blank">Vault &rarr;</a>'
          + '<a class="ev__sheet" href="#" onclick="downloadCsv(this);return false;">CSV &darr;</a>'
          + '<button class="ev__del" type="button" onclick="delEvent(this)">Delete</button></div>';
      }).join('');
    });
  }
  function downloadCsv(link){
    var key = link.closest('.ev').getAttribute('data-key');
    fetch('/admin/event/'+encodeURIComponent(key)+'/claims.csv', { headers: { 'x-admin-password': PW } })
      .then(function(r){ if (!r.ok) throw 0; return r.blob(); })
      .then(function(blob){
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = key + '-claims.csv';
        document.body.appendChild(a); a.click(); a.remove();
      })
      .catch(function(){ alert('Could not download the CSV.'); });
  }

  function downloadBackup(btn){
    btn.disabled = true; btn.textContent = 'Building archive…';
    fetch('/admin/backup', { headers: { 'x-admin-password': PW } })
      .then(function(r){ if (!r.ok) throw 0; return r.blob(); })
      .then(function(blob){
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'ticklore-backup-' + new Date().toISOString().slice(0,10) + '.tar.gz';
        document.body.appendChild(a); a.click(); a.remove();
        btn.disabled = false; btn.textContent = '\\u21E9 Download full backup (stores + vault media)';
        document.getElementById('backup-hint').textContent = 'Downloaded \\u2713 — stash it somewhere safe (it contains emails and custody records).';
      })
      .catch(function(){ btn.disabled = false; btn.textContent = '\\u21E9 Download full backup (stores + vault media)'; alert('Backup failed — is anything in the stores yet?'); });
  }

  function delEvent(btn){
    var row=btn.closest('.ev'), key=row.getAttribute('data-key');
    if(!confirm('Delete this sponsor event and its unclaimed codes? Minted tickets stay on-chain.')) return;
    btn.disabled=true; btn.textContent='Deleting…';
    fetch('/admin/delete',{method:'POST',headers:{'Content-Type':'application/json','x-admin-password':PW},body:JSON.stringify({key:key})})
      .then(function(r){return r.json()}).then(function(d){ if(d.ok){loadEvents();} else {btn.disabled=false;btn.textContent='Delete';alert(d.error||'Could not delete.');} });
  }
</script>
</body></html>`;
}

/** Minimal server-side HTML escaping for values we render into pages. */
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** The printable code sheet. Client-gated (own password prompt), then fetches
 *  the codes and lays them out grouped by sponsor for printing / cutting up. */
function sheetPage(key) {
  return `<!doctype html>
<html lang="en"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Ticklore — Claim codes</title>
<style>
  :root{--ink:#0E262B;--parchment:#F1E9DD;--gold:#C9A227;--gold-bright:#E3C25E;--sage:#7FB3A6;--line:rgba(0,0,0,.14)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:#12303670;color:#0E262B;font-family:system-ui,'Segoe UI',sans-serif;line-height:1.4}
  .gate{position:fixed;inset:0;background:#081619;color:#F1E9DD;z-index:50;display:flex;align-items:center;justify-content:center;padding:24px}
  .gate.hidden{display:none}
  .gate__box{max-width:360px;width:100%;text-align:center}
  .gate input{width:100%;padding:12px;border-radius:6px;border:1px solid #444;margin:14px 0 10px;text-align:center;font-size:1rem}
  .gate button{width:100%;padding:12px;border:0;border-radius:6px;background:var(--gold);color:#081619;font-weight:600;cursor:pointer}
  .gate .err{color:#E38A8A;font-size:.85rem;min-height:1.2em;margin-top:8px}
  .page{max-width:900px;margin:0 auto;padding:24px;background:#F1E9DD;min-height:100vh}
  .head{display:flex;align-items:baseline;justify-content:space-between;border-bottom:2px solid var(--gold);padding-bottom:10px;margin-bottom:6px}
  .head h1{font-size:1.4rem}
  .head .meta{color:#555;font-size:.85rem}
  .noprint{margin:14px 0}
  .noprint button{background:var(--gold);color:#081619;border:0;border-radius:6px;padding:9px 16px;font-weight:600;cursor:pointer}
  .sponsor{margin-top:22px}
  .sponsor h2{font-size:1rem;color:#7a5c00;border-bottom:1px solid var(--line);padding-bottom:4px;margin-bottom:12px}
  .cards{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}
  .card{border:1px dashed #999;border-radius:8px;padding:12px;text-align:center;page-break-inside:avoid}
  .card .spn{font-size:.72rem;letter-spacing:.08em;text-transform:uppercase;color:#7a5c00;margin-bottom:6px}
  .card svg{width:132px;height:132px;display:block;margin:0 auto 8px}
  .card .code{font-family:ui-monospace,monospace;font-weight:700;font-size:1.05rem;margin-bottom:4px;word-break:break-all}
  .card .url{font-family:ui-monospace,monospace;font-size:.62rem;color:#555;word-break:break-all}
  .card.claimed{opacity:.4}
  .card .tag{font-size:.62rem;color:#2FAF93;margin-top:4px}
  @media print{ body{background:#fff} .noprint{display:none} .page{max-width:none;padding:0} }
</style></head>
<body>
<div class="gate" id="gate"><div class="gate__box">
  <div>Enter the admin password to view the codes.</div>
  <input id="pw" type="password" placeholder="Admin password" autofocus>
  <button onclick="unlock()">View codes</button>
  <div class="err" id="err"></div>
</div></div>
<div class="page" id="page" style="display:none">
  <div class="head"><h1 id="title">Claim codes</h1><div class="meta" id="meta"></div></div>
  <div class="noprint"><button onclick="window.print()">Print</button> &nbsp;<span id="count" style="color:#555;font-size:.85rem"></span></div>
  <div id="groups"></div>
</div>
<script>
  var KEY = ${JSON.stringify(key)};
  function esc(s){return String(s==null?'':s).replace(/[&<>"']/g,function(c){return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];});}
  function unlock(){
    var pw=document.getElementById('pw').value;
    fetch('/admin/event/'+encodeURIComponent(KEY)+'/codes',{headers:{'x-admin-password':pw}})
      .then(function(r){ if(!r.ok) throw 0; return r.json(); })
      .then(function(d){ render(d); document.getElementById('gate').classList.add('hidden'); document.getElementById('page').style.display='block'; })
      .catch(function(){ document.getElementById('err').textContent='Wrong password (or event not found).'; });
  }
  document.getElementById('pw').addEventListener('keydown',function(e){ if(e.key==='Enter') unlock(); });
  function render(d){
    document.getElementById('title').textContent = d.name + ' — Claim codes';
    document.getElementById('meta').textContent = (d.venue||'') + (d.date? ' · '+d.date : '');
    var groups={}, order=[];
    (d.codes||[]).forEach(function(c){
      var price = c.priceCents ? ' — $' + (c.priceCents/100).toFixed(2).replace(/\\.00$/,'') : '';
      var sect = c.section ? ' — ' + c.section : '';
      var k = (c.sponsorName || 'General') + sect + price;
      if(!groups[k]){groups[k]=[];order.push(k);} groups[k].push(c);
    });
    var claimed=(d.codes||[]).filter(function(c){return c.status==='claimed';}).length;
    document.getElementById('count').textContent = (d.codes||[]).length+' codes · '+claimed+' claimed';
    document.getElementById('groups').innerHTML = order.map(function(k){
      return '<div class="sponsor"><h2>'+esc(k)+' — '+groups[k].length+' ticket'+(groups[k].length===1?'':'s')+'</h2><div class="cards">'
        + groups[k].map(function(c){
            return '<div class="card'+(c.status==='claimed'?' claimed':'')+'"><div class="spn">'+esc(k)+'</div>'
              + (c.qr||'')
              + '<div class="code">'+esc(c.code)+'</div><div class="url">'+esc(c.url)+'</div>'
              + (c.status==='claimed'?'<div class="tag">claimed</div>':'')+'</div>';
          }).join('')
        + '</div></div>';
    }).join('');
  }
</script>
</body></html>`;
}

/** The public claim page for one code. */
function claimPage({ code, rec, details, privy, prefill }) {
  // Optional personalization fields — only when the organizer allowed
  // inscriptions. Values are set via attributes (escaped); the server
  // re-validates and moderates on POST regardless.
  const allowIns = !!(details && details.allowInscription);
  const pfName = esc((prefill && prefill.name) || "");
  const pfMsg = esc((prefill && prefill.msg) || "");
  const inscriptionFields = allowIns ? `
<div id="insc" style="margin-bottom:2px">
  <input id="in-name" type="text" maxlength="32" placeholder="Your name (optional) — first name is plenty" value="${pfName}">
  <input id="in-msg" type="text" maxlength="42" placeholder="A line for the keepsake (optional)" value="${pfMsg}">
  <div style="font-size:.74rem;color:rgba(241,233,221,.45);margin:-4px 0 10px">Engraved on the keepsake forever — keep it kind.</div>
</div>` : "";
  const inscriptionJs = `
  function inscriptionBody(){
    var n = document.getElementById('in-name'), m = document.getElementById('in-msg');
    return { buyerName: n ? n.value : '', inscription: m ? m.value : '' };
  }
  function hideInscription(){ var b = document.getElementById('insc'); if (b) b.style.display = 'none'; }`;
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Claim your keepsake — Ticklore</title>
<style>
  :root{--ink:#0E262B;--ink-deep:#081619;--parchment:#F1E9DD;--gold:#C9A227;--gold-bright:#E3C25E;--sage:#7FB3A6;--line:rgba(241,233,221,.14);--field:rgba(241,233,221,.05)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--ink);color:var(--parchment);font-family:system-ui,'Segoe UI',sans-serif;line-height:1.5;
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px}
  .box{max-width:520px;width:100%;text-align:center}
  .brand{font-family:Georgia,serif;font-size:1.5rem;font-weight:600}
  .brand em{font-style:italic;color:var(--gold-bright)}
  .tag{font-style:italic;color:var(--gold-bright);font-size:.95rem;margin:2px 0 24px}
  h1{font-family:Georgia,serif;font-weight:600;font-size:1.7rem;margin-bottom:6px}
  .venue{color:var(--sage);font-size:.95rem;margin-bottom:6px}
  .sponsor{font-family:ui-monospace,monospace;font-size:.82rem;color:var(--gold);letter-spacing:.03em;margin-bottom:22px}
  input{width:100%;background:var(--field);border:1px solid var(--line);color:var(--parchment);padding:13px 15px;border-radius:6px;font-size:1rem;text-align:center;margin-bottom:12px}
  button{width:100%;background:var(--gold);color:var(--ink-deep);border:0;border-radius:6px;padding:14px;font-weight:600;font-size:1rem;cursor:pointer}
  button:disabled{opacity:.6;cursor:wait}
  .err{color:#E38A8A;font-size:.9rem;min-height:1.2em;margin-top:10px}
  .hint{color:rgba(241,233,221,.55);font-size:.85rem;margin-top:14px}
  .ticket img{width:100%;max-width:480px;border-radius:12px;box-shadow:0 30px 70px -26px rgba(0,0,0,.85);margin-top:10px}
  .headline{font-family:Georgia,serif;font-weight:600;font-size:1.5rem;margin:6px 0 14px}
</style></head><body><div class="box">
<div class="brand">Tick<em>lore</em></div><div class="tag">Every ticket has a story.</div>`;
  const foot = `</div></body></html>`;

  if (!rec) {
    return head + `<h1>Code not found</h1><div class="hint">This claim link isn't valid. Check with whoever gave it to you.</div>` + foot;
  }
  const evName = esc(details ? details.name : "Your event");
  const venue = details && details.venue ? `<div class="venue">${esc(details.venue)}</div>` : "";
  const sponsor = rec.sponsorName ? `<div class="sponsor">Presented with ${esc(rec.sponsorName)}</div>` : "";

  // A dormant card: printed but not yet sold. Friendly wall for the curious,
  // discreet door for the desk.
  if (rec.active === false && rec.status !== "claimed") {
    return head + `<h1>${evName}</h1>${venue}${sponsor}
<div class="headline">Almost yours.</div>
<p style="color:rgba(241,233,221,.75)">This ticket hasn't been activated yet — once it's purchased at the
ticket desk, this page becomes your keepsake claim.</p>
<div class="hint" style="margin-top:22px"><a href="/activate/${esc(rec.code)}" style="color:var(--gold-bright)">Ticket desk: activate this card &rarr;</a> <span style="opacity:.7">(staff only)</span></div>` + foot;
  }

  if (rec.status === "claimed" && rec.tokenId) {
    const admitted = !!rec.redeemedAt;
    const headline = admitted ? "Admitted ✓" : "This keepsake is claimed.";
    // Pin the token's contract version (ids collide across versions) and
    // cache-bust after redemption so the freshly stamped on-chain art shows.
    const vq = details && details.onChainVersion ? `v=${details.onChainVersion}` : "";
    const rq = admitted ? "r=1" : "";
    const q = [vq, rq].filter(Boolean).join("&");
    const imgSrc = `/ticket/${esc(rec.tokenId)}/image${q ? "?" + q : ""}`;
    const doorLink = !admitted && details && details.redemptionEnabled
      ? `<div class="hint" style="margin-top:18px"><a href="/door/${esc(rec.code)}" style="color:var(--gold-bright)">Door check-in &rarr;</a> <span style="opacity:.7">(staff only)</span></div>`
      : "";
    return head + `<h1>${evName}</h1>${venue}${sponsor}
<div class="headline">${headline}</div>
<div class="ticket"><img src="${imgSrc}" alt="Your keepsake"></div>
<div class="hint">Ticket #${esc(rec.tokenId)} — held for you.</div>
${doorLink}` + foot;
  }

  if (privy) {
    // Privy flow: email OTP proves the claimant owns the address, an embedded
    // wallet is created silently, and the keepsake mints into THEIR wallet.
    return head + `<h1>${evName}</h1>${venue}${sponsor}
<p style="margin-bottom:18px;color:rgba(241,233,221,.75)">Claim your keepsake — verify your email and it's yours, permanently.</p>
${inscriptionFields}
<div id="step-email">
  <input id="email" type="email" placeholder="you@email.com" autocomplete="email">
  <button id="send" onclick="sendCode()">Send my code</button>
</div>
<div id="step-code" style="display:none">
  <input id="otp" type="text" inputmode="numeric" placeholder="6-digit code" autocomplete="one-time-code" maxlength="6">
  <button id="verify" onclick="verifyAndClaim()">Verify &amp; claim</button>
</div>
<div class="err" id="err"></div>
<div class="ticket" id="ticket"></div>
<div class="hint" id="hint">No app, no seed phrase — your email is your key.</div>
<script src="/privy.js"></script>
<script>
  var CODE = ${JSON.stringify(code)};
  var PRIVY_CFG = ${JSON.stringify(privy)};
  var privy = null, booted = false, bootErr = null;
${inscriptionJs}

  // Boot the SDK + mount the hidden wallet iframe as soon as the page loads,
  // so key setup overlaps with the human typing their email.
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
      document.getElementById('hint').textContent = 'We emailed a 6-digit code to ' + email + '.';
      document.getElementById('otp').focus();
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Send my code';
      err.textContent = 'Could not send the code — check the address and try again.';
    }
  }

  async function verifyAndClaim(){
    var err = document.getElementById('err'); err.textContent = '';
    var email = document.getElementById('email').value.trim();
    var otp = document.getElementById('otp').value.trim();
    if (otp.length < 6) { err.textContent = 'Enter the 6-digit code from your email.'; return; }
    var btn = document.getElementById('verify');
    btn.disabled = true; btn.textContent = 'Writing your chapter…';
    try {
      var session = await privy.auth.email.loginWithCode(email, otp);
      var user = session && session.user ? session.user : session;
      // Ensure the embedded wallet exists (dashboard usually auto-creates on login).
      if (!TickPrivy.getUserEmbeddedEthereumWallet(user)) {
        try { await privy.embeddedWallet.create({}); } catch (_) { /* server verifies anyway */ }
      }
      var token = await privy.getAccessToken();
      var ins = inscriptionBody();
      var r = await fetch('/claim/' + encodeURIComponent(CODE), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ privyToken: token, buyerName: ins.buyerName, inscription: ins.inscription })
      });
      var d = await r.json();
      if (d.ok) {
        document.getElementById('step-code').style.display = 'none';
        hideInscription();
        var short = d.address ? d.address.slice(0, 6) + '…' + d.address.slice(-4) : '';
        document.getElementById('hint').textContent = d.owned
          ? 'Ticket #' + d.tokenId + ' — minted to YOUR wallet ' + short + '. Yours, permanently.'
          : 'Ticket #' + d.tokenId + ' — held for you.';
        var img = new Image(); img.src = '/ticket/' + d.tokenId + '/image' + (d.version ? '?v=' + d.version : '');
        img.onload = function(){ document.getElementById('ticket').appendChild(img); };
      } else {
        btn.disabled = false; btn.textContent = 'Verify & claim';
        err.textContent = d.error || 'Could not claim.';
      }
    } catch (e) {
      btn.disabled = false; btn.textContent = 'Verify & claim';
      err.textContent = 'That code did not verify — check it and try again.';
    }
  }
  document.getElementById('otp').addEventListener('keydown', function(e){ if (e.key === 'Enter') verifyAndClaim(); });
  document.getElementById('email').addEventListener('keydown', function(e){ if (e.key === 'Enter') sendCode(); });
</script>` + foot;
  }

  return head + `<h1>${evName}</h1>${venue}${sponsor}
<p style="margin-bottom:18px;color:rgba(241,233,221,.75)">Claim your keepsake ticket — enter your email and it's yours.</p>
${inscriptionFields}
<input id="email" type="email" placeholder="you@email.com" autocomplete="email">
<button id="go" onclick="claim()">Claim my keepsake</button>
<div class="err" id="err"></div>
<div class="ticket" id="ticket"></div>
<div class="hint" id="hint">Free — no wallet or app needed.</div>
<script>
  var CODE = ${JSON.stringify(code)};
${inscriptionJs}
  function claim(){
    var btn=document.getElementById('go'), err=document.getElementById('err');
    err.textContent=''; var email=document.getElementById('email').value.trim();
    if(!email || email.indexOf('@')<1){ err.textContent='Enter a valid email.'; return; }
    btn.disabled=true; btn.textContent='Writing your chapter…';
    var ins = inscriptionBody();
    fetch('/claim/'+encodeURIComponent(CODE),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:email,buyerName:ins.buyerName,inscription:ins.inscription})})
      .then(function(r){return r.json()}).then(function(d){
        if(d.ok || (d.tokenId)){
          document.getElementById('email').style.display='none'; btn.style.display='none'; hideInscription();
          document.getElementById('hint').textContent='Ticket #'+d.tokenId+' — held for you. No wallet needed.';
          var img=new Image(); img.src='/ticket/'+d.tokenId+'/image'+(d.version?'?v='+d.version:'');
          img.onload=function(){ document.getElementById('ticket').appendChild(img); };
        } else { btn.disabled=false; btn.textContent='Claim my keepsake'; err.textContent=d.error||'Could not claim.'; }
      }).catch(function(){ btn.disabled=false; btn.textContent='Claim my keepsake'; err.textContent='Could not reach the server.'; });
  }
</script>` + foot;
}

/** The door check-in page for one code. Staff-facing; the action needs the
 *  admin password, so an attendee stumbling in can look but not redeem. */
function doorPage({ code, rec, details }) {
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Door check-in — Ticklore</title>
<style>
  :root{--ink:#0E262B;--ink-deep:#081619;--parchment:#F1E9DD;--gold:#C9A227;--gold-bright:#E3C25E;--sage:#7FB3A6;--line:rgba(241,233,221,.14);--field:rgba(241,233,221,.05)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--ink-deep);color:var(--parchment);font-family:system-ui,'Segoe UI',sans-serif;line-height:1.5;
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px}
  .box{max-width:440px;width:100%;text-align:center}
  .tag{font-family:ui-monospace,monospace;font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);margin-bottom:18px}
  h1{font-family:Georgia,serif;font-weight:600;font-size:1.6rem;margin-bottom:4px}
  .venue{color:var(--sage);font-size:.92rem;margin-bottom:4px}
  .tk{font-family:ui-monospace,monospace;font-size:.85rem;color:rgba(241,233,221,.7);margin-bottom:24px}
  input{width:100%;background:var(--field);border:1px solid var(--line);color:var(--parchment);padding:13px 15px;border-radius:6px;font-size:1rem;text-align:center;margin-bottom:12px}
  button{width:100%;background:var(--gold);color:var(--ink-deep);border:0;border-radius:6px;padding:14px;font-weight:600;font-size:1rem;cursor:pointer}
  button:disabled{opacity:.6;cursor:wait}
  .err{color:#E38A8A;font-size:.9rem;min-height:1.2em;margin-top:10px}
  .big{font-family:Georgia,serif;font-weight:600;font-size:2rem;color:var(--gold-bright);margin:18px 0 8px}
  .hint{color:rgba(241,233,221,.55);font-size:.85rem;margin-top:14px}
</style></head><body><div class="box">
<div class="tag">Ticklore · Door check-in</div>`;
  const foot = `</div></body></html>`;

  if (!rec) return head + `<h1>Code not found</h1><div class="hint">This link isn't a valid ticket code.</div>` + foot;
  const details2 = details || {};
  const evName = esc(details2.name || "Event");
  const venue = details2.venue ? `<div class="venue">${esc(details2.venue)}</div>` : "";

  if (!details2.redemptionEnabled) {
    return head + `<h1>${evName}</h1>${venue}<div class="hint">Door check-in isn't enabled for this event — it's a keepsake-only event.</div>` + foot;
  }
  if (rec.redeemedAt) {
    return head + `<h1>${evName}</h1>${venue}<div class="big">Admitted ✓</div><div class="tk">Ticket #${esc(rec.tokenId || "?")} · checked in</div>` + foot;
  }
  if (rec.status !== "claimed" || !rec.tokenId) {
    return head + `<h1>${evName}</h1>${venue}
<div class="hint">This ticket hasn't been claimed yet. Have the guest claim it first, then check in.</div>
<div class="hint"><a href="/claim/${esc(code)}" style="color:var(--gold-bright)">Open the claim page &rarr;</a></div>` + foot;
  }

  return head + `<h1>${evName}</h1>${venue}
<div class="tk">Ticket #${esc(rec.tokenId)} · claimed, not yet admitted</div>
<input id="pw" type="password" placeholder="Staff password" autofocus>
<button id="go" onclick="redeem()">Admit &amp; stamp the keepsake</button>
<div class="err" id="err"></div>
<div class="hint">Stamps ADMITTED onto the on-chain keepsake. Permanent, never a burn.</div>
<script>
  var CODE = ${JSON.stringify(code)};
  function redeem(){
    var btn=document.getElementById('go'), err=document.getElementById('err');
    err.textContent='';
    btn.disabled=true; btn.textContent='Stamping…';
    fetch('/door/'+encodeURIComponent(CODE),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:document.getElementById('pw').value})})
      .then(function(r){return r.json()}).then(function(d){
        if(d.ok){ location.reload(); }
        else { btn.disabled=false; btn.textContent='Admit & stamp the keepsake'; err.textContent=d.error||'Could not check in.'; }
      }).catch(function(){ btn.disabled=false; btn.textContent='Admit & stamp the keepsake'; err.textContent='Could not reach the server.'; });
  }
  document.getElementById('pw').addEventListener('keydown',function(e){ if(e.key==='Enter') redeem(); });
</script>` + foot;
}

/** The point-of-sale activation page — the gift-card swipe, Ticklore style. */
function activatePage({ code, rec, details }) {
  const head = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>Activate — Ticklore</title>
<style>
  :root{--ink:#0E262B;--ink-deep:#081619;--parchment:#F1E9DD;--gold:#C9A227;--gold-bright:#E3C25E;--sage:#7FB3A6;--line:rgba(241,233,221,.14);--field:rgba(241,233,221,.05)}
  *{margin:0;padding:0;box-sizing:border-box}
  body{background:var(--ink-deep);color:var(--parchment);font-family:system-ui,'Segoe UI',sans-serif;line-height:1.5;
    min-height:100vh;display:flex;align-items:center;justify-content:center;padding:28px}
  .box{max-width:440px;width:100%;text-align:center}
  .tag{font-family:ui-monospace,monospace;font-size:.72rem;letter-spacing:.22em;text-transform:uppercase;color:var(--gold);margin-bottom:18px}
  h1{font-family:Georgia,serif;font-weight:600;font-size:1.6rem;margin-bottom:4px}
  .venue{color:var(--sage);font-size:.92rem;margin-bottom:4px}
  .tk{font-family:ui-monospace,monospace;font-size:.85rem;color:rgba(241,233,221,.7);margin-bottom:24px}
  input{width:100%;background:var(--field);border:1px solid var(--line);color:var(--parchment);padding:13px 15px;border-radius:6px;font-size:1.1rem;text-align:center;letter-spacing:.3em;margin-bottom:12px}
  button{width:100%;background:var(--gold);color:var(--ink-deep);border:0;border-radius:6px;padding:14px;font-weight:600;font-size:1rem;cursor:pointer}
  button:disabled{opacity:.6;cursor:wait}
  .err{color:#E38A8A;font-size:.9rem;min-height:1.2em;margin-top:10px}
  .big{font-family:Georgia,serif;font-weight:600;font-size:2rem;color:var(--gold-bright);margin:18px 0 8px}
  .hint{color:rgba(241,233,221,.55);font-size:.85rem;margin-top:14px}
</style></head><body><div class="box">
<div class="tag">Ticklore · Ticket desk</div>`;
  const foot = `</div></body></html>`;

  if (!rec) return head + `<h1>Code not found</h1><div class="hint">This link isn't a valid ticket code.</div>` + foot;
  const d = details || {};
  const evName = esc(d.name || "Event");
  const venue = d.venue ? `<div class="venue">${esc(d.venue)}</div>` : "";
  const price = rec.priceCents ? `$${(rec.priceCents / 100).toFixed(2).replace(/\.00$/, "")}` : "Free";

  if (!d.activationRequired) {
    return head + `<h1>${evName}</h1>${venue}<div class="hint">This event doesn't use desk activation — cards are live as printed.</div>` + foot;
  }
  if (rec.active) {
    return head + `<h1>${evName}</h1>${venue}<div class="big">Active ✓</div>
<div class="tk">${rec.status === "claimed" ? "Already claimed by its owner." : "Sold and ready — the buyer can claim any time."}</div>` + foot;
  }

  return head + `<h1>${evName}</h1>${venue}
<div class="tk">Dormant card · ${esc(rec.sponsorName || "General")} · ${esc(price)}</div>
<input id="pin" type="password" inputmode="numeric" placeholder="Seller PIN" autofocus>
<button id="go" onclick="activate()">Mark as sold &amp; activate</button>
<div class="err" id="err"></div>
<div class="hint">Collect the ${esc(price)} first, then activate — the card becomes claimable the moment you do.</div>
<script>
  var CODE = ${JSON.stringify(code)};
  function activate(){
    var btn=document.getElementById('go'), err=document.getElementById('err');
    err.textContent='';
    btn.disabled=true; btn.textContent='Activating…';
    fetch('/activate/'+encodeURIComponent(CODE),{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({pin:document.getElementById('pin').value})})
      .then(function(r){return r.json()}).then(function(d){
        if(d.ok){ location.reload(); }
        else { btn.disabled=false; btn.textContent='Mark as sold & activate'; err.textContent=d.error||'Could not activate.'; }
      }).catch(function(){ btn.disabled=false; btn.textContent='Mark as sold & activate'; err.textContent='Could not reach the server.'; });
  }
  document.getElementById('pin').addEventListener('keydown',function(e){ if(e.key==='Enter') activate(); });
</script>` + foot;
}

module.exports = { mountConcierge };
