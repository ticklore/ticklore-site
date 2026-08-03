#!/usr/bin/env node
/**
 * server.js — the mint service as an HTTP API.
 *
 * WHY A SERVER
 * ------------
 * TickloreTicket.mintTicket() is owner-only, and that key can never reach a
 * browser. So the buyer's browser only ever takes payment; this server does
 * the minting on the other side of a wall.
 *
 *     browser → Stripe → [this server] → contract → email
 *
 * Right now Stripe and email are missing. This is deliberately the middle
 * piece on its own, so that when Stripe is added and something breaks, the
 * mint is already known-good and there is one fewer suspect.
 *
 * THE KEY
 * -------
 * The keystore is unlocked ONCE at startup, with the password typed by a
 * human. The unlocked wallet then lives in memory for the life of the
 * process. That is why this server cannot be restarted unattended — which is
 * a real limitation, and the reason production uses a managed signer instead
 * (see NOTES at the bottom).
 *
 * USAGE
 *   node server.js
 *   # then, in another terminal:
 *   curl localhost:3000/health
 */

require("dotenv").config();
const express = require("express");
const crypto = require("crypto");
const ticklore = require("./lib/ticklore");
const ticklorev2 = require("./lib/ticklore-v2");
const ticklorev3 = require("./lib/ticklore-v3");
const ticklorev4 = require("./lib/ticklore-v4");
const ticklorev5 = require("./lib/ticklore-v5");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.MINT_API_KEY;

const app = express();

// The app domain is functional, never marketing: nothing served here should
// ever be indexed (docs/vault-urls-privacy-seo.md §4). SEO lives on
// ticklore.com; keepsakes, claims, and vaults are for the people they belong
// to, not for crawlers. Header on every response + a blanket robots.txt.
app.use((req, res, next) => { res.set("X-Robots-Tag", "noindex, nofollow"); next(); });
app.get("/robots.txt", (req, res) => res.type("text/plain").send("User-agent: *\nDisallow: /\n"));

// Static assets (the logo, etc.). Cached hard — it's an immutable brand file.
app.use(express.static(__dirname + "/public", { maxAge: "7d" }));

// NOTE ON MIDDLEWARE ORDER
// Stripe signs the RAW bytes of the webhook body. If express.json() parses it
// first, the bytes get reassembled slightly differently and the signature no
// longer matches. So the Stripe routes are mounted BEFORE express.json(), and
// the webhook route uses express.raw() for itself. Getting this backwards is
// the most common reason a Stripe integration fails, and the error it produces
// does not point at the cause.
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);
}

// Body parsing is applied PER ROUTE rather than globally, so there is no way
// for a global parser to consume the webhook's raw bytes by accident.

// Set at startup, used by every request.
let chain = null;
let chainV2 = null;   // set at startup when TICKLORE_CONTRACT_V2 is configured
let chainV3 = null;   // set at startup when TICKLORE_CONTRACT_V3 is configured
let chainV4 = null;   // set at startup when TICKLORE_CONTRACT_V4 is configured
let chainV5 = null;   // set at startup when TICKLORE_CONTRACT_V5 is configured

/** Every configured event-model source, newest first. */
function ticketSources() {
  const list = [];
  if (chainV5) list.push({ src: chainV5, lib: ticklorev5 });
  if (chainV4) list.push({ src: chainV4, lib: ticklorev4 });
  if (chainV3) list.push({ src: chainV3, lib: ticklorev3 });
  if (chainV2) list.push({ src: chainV2, lib: ticklorev2 });
  if (!list.length) list.push({ src: chain, lib: ticklore });
  return list;
}

/** Find which contract a token actually lives on — newest first, probing with
 *  a cheap ownerOf. Keepsakes must survive contract flips: a V3 ticket someone
 *  OWNS (in their wallet) keeps rendering after the demo moves to V4. The
 *  outer retry covers RPC lag on a just-minted token.
 *
 *  Token ids COLLIDE across contracts (every version has a #1), so callers
 *  that know a token's home version pin it with ?v= — the probe is only the
 *  fallback for unqualified links. */
async function findTicket(id, versionPin) {
  if (versionPin) {
    const byVersion = { 5: chainV5 && { src: chainV5, lib: ticklorev5 },
                       4: chainV4 && { src: chainV4, lib: ticklorev4 },
                       3: chainV3 && { src: chainV3, lib: ticklorev3 },
                       2: chainV2 && { src: chainV2, lib: ticklorev2 } };
    return byVersion[versionPin] || null;
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    for (const cand of ticketSources()) {
      try {
        await cand.src.contract.ownerOf(id);
        return cand;
      } catch { /* not on this contract (or not yet visible) — keep looking */ }
    }
    await new Promise((r) => setTimeout(r, 1000 * attempt));
  }
  return null;
}

/**
 * Anything that can mint tickets is, in a real sense, a money printer. This
 * endpoint must never be open to the internet without a check.
 *
 * A shared secret is the minimum bar and is fine while this runs on your own
 * machine. Compared with a plain === it uses a timing-safe comparison, which
 * costs nothing and avoids a class of attack where response timing leaks the
 * secret one character at a time.
 */
function requireApiKey(req, res, next) {
  if (!API_KEY) {
    return res.status(500).json({
      error: "Server misconfigured: MINT_API_KEY is not set. Refusing to expose an open mint endpoint.",
    });
  }
  const provided = req.get("x-api-key") || "";
  const a = Buffer.from(provided);
  const b = Buffer.from(API_KEY);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/** Is the service up, and what is it pointed at? Open on purpose. */
app.get("/health", async (req, res) => {
  try {
    const balance = await chain.provider.getBalance(chain.signer.address);
    const next = await chain.contract.nextTicketId();
    // The minter pays gas for every mint and nobody watches it at 3am. A mint
    // costs ~0.00002 ETH on Base Sepolia, so 0.0005 is ~25 mints of runway —
    // enough warning to hit a faucet before an event day goes dark.
    const eth = Number(require("ethers").formatEther(balance));
    const gas = eth <= 0 ? "EMPTY — mints will fail" : eth < 0.0005 ? "LOW — top up the minter soon" : "ok";
    res.json({
      status: "ok",
      chainId: chain.network.chainId.toString(),
      contract: chain.address,
      minter: chain.signer.address,
      minterBalanceEth: require("ethers").formatEther(balance),
      gas,
      nextTicketId: next.toString(),
    });
  } catch (err) {
    res.status(503).json({ status: "degraded", error: err.message });
  }
});

/**
 * Mint a ticket.
 *
 * POST /mint
 * { "to": "0x...", "eventName": "The Sullivan Family Reunion",
 *   "tier": "General", "price": 2500, "date": "2026-07-22" }
 *
 * price is in whole cents.
 */
app.post("/mint", express.json(), requireApiKey, async (req, res) => {
  const started = Date.now();
  try {
    const result = await ticklore.mintTicket(chain.contract, req.body);
    console.log(`  ✓ minted #${result.ticketId} → ${result.args.to} (${Date.now() - started}ms)`);
    res.json({ ok: true, ...result });
  } catch (err) {
    // Bad input is the caller's fault (400); anything else is ours (500).
    const isInputError = /Missing|not a valid|Could not read|cannot be negative/i.test(err.message);
    console.error(`  ✗ mint failed: ${err.message}`);
    res.status(isInputError ? 400 : 500).json({ ok: false, error: err.message });
  }
});

/** The decoded metadata for a ticket, straight from the contract. */
app.get("/ticket/:id", async (req, res) => {
  try {
    const found = await findTicket(req.params.id, Number(req.query.v) || 0);
    if (!found) return res.status(404).json({ error: `No such ticket: ${req.params.id}` });
    const { metadata } = await found.lib.getTicket(found.src.contract, req.params.id);
    const owner = await found.src.contract.ownerOf(req.params.id);
    res.json({ ticketId: req.params.id, owner, metadata });
  } catch (err) {
    res.status(404).json({ error: `No such ticket: ${req.params.id}` });
  }
});

/**
 * The ticket artwork, as an actual image.
 *
 * Useful beyond debugging: block explorers cache NFT images through a slow
 * indexer, so a freshly minted ticket often shows a blank box for hours. This
 * route reads the contract directly and always shows the truth.
 */
app.get("/ticket/:id/image", async (req, res) => {
  try {
    const found = await findTicket(req.params.id, Number(req.query.v) || 0);
    if (!found) return res.status(404).send(`No such ticket: ${req.params.id}`);
    const { svg } = await found.lib.getTicket(found.src.contract, req.params.id);
    if (!svg) return res.status(404).send("No SVG in metadata");
    res.type("image/svg+xml").send(svg);
  } catch (err) {
    res.status(404).send(`No such ticket: ${req.params.id}`);
  }
});

/** A tiny viewer, so a ticket can be looked at without any tooling. Lives at
 *  /viewer now — the storefront owns "/" (the landing page). */
app.get("/viewer", (req, res) => {
  res.type("html").send(`<!doctype html>
<html><head><meta charset="utf-8"><title>Ticklore mint service</title>
<style>
  body{background:#0E262B;color:#F1E9DD;font-family:system-ui,sans-serif;
       display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0}
  .box{text-align:center;max-width:860px;padding:32px}
  h1{font-family:Georgia,serif;font-weight:600;margin:0 0 6px}
  .t{font-style:italic;color:#E3C25E;margin-bottom:28px}
  input{background:rgba(241,233,221,.06);border:1px solid rgba(241,233,221,.25);
        color:#F1E9DD;padding:10px 14px;border-radius:4px;font-size:1rem;width:90px;text-align:center}
  button{background:#C9A227;color:#081619;border:0;padding:11px 22px;border-radius:4px;
         font-weight:600;margin-left:8px;cursor:pointer;font-size:.95rem}
  img{margin-top:28px;max-width:100%;border-radius:10px;
      box-shadow:0 24px 50px -18px rgba(0,0,0,.7)}
  .err{color:#E38A8A;margin-top:20px;min-height:1.2em}
</style></head><body><div class="box">
<h1>Ticklore</h1><div class="t">Every ticket has a story.</div>
<input id="n" type="number" value="1" min="1"><button onclick="show()">View ticket</button>
<div class="err" id="e"></div>
<div id="o"></div>
<script>
function show(){
  var n=document.getElementById('n').value;
  document.getElementById('e').textContent='';
  var i=new Image();
  i.onload=function(){document.getElementById('o').innerHTML='';document.getElementById('o').appendChild(i)};
  i.onerror=function(){document.getElementById('o').innerHTML='';document.getElementById('e').textContent='Ticket #'+n+' not found.'};
  i.src='/ticket/'+n+'/image?'+Date.now();
}
show();
</script></div></body></html>`);
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

(async () => {
  try {
    console.log("\nTicklore mint service");
    console.log("─────────────────────");
    chain = await ticklore.connect();

    // Optional V2 (event-model) connection. Only when TICKLORE_CONTRACT_V2 is set,
    // so the current V1 demo is untouched until we deliberately turn it on.
    if (process.env.TICKLORE_CONTRACT_V2) {
      try {
        chainV2 = await ticklorev2.connect();
        console.log("  V2 model : connected", chainV2.address);
      } catch (e) {
        console.warn("  ⚠ V2 connect failed:", e.message);
      }
    }

    // Optional V3 (multi-sponsor) connection — same gate, newest of the three.
    // When set, reads/publish/buy prefer V3 over V2 over V1.
    if (process.env.TICKLORE_CONTRACT_V3) {
      try {
        chainV3 = await ticklorev3.connect();
        console.log("  V3 model : connected", chainV3.address);
      } catch (e) {
        console.warn("  ⚠ V3 connect failed:", e.message);
      }
    }

    // Optional V4 (final design pass: sections, price display, authority
    // handoff) — same gate again. Newest configured version always wins.
    if (process.env.TICKLORE_CONTRACT_V4) {
      try {
        chainV4 = await ticklorev4.connect();
        console.log("  V4 model : connected", chainV4.address);
      } catch (e) {
        console.warn("  ⚠ V4 connect failed:", e.message);
      }
    }

    // Optional V5 (the freeze candidate: custody delivery) — same gate.
    if (process.env.TICKLORE_CONTRACT_V5) {
      try {
        chainV5 = await ticklorev5.connect();
        console.log("  V5 model : connected", chainV5.address);
      } catch (e) {
        console.warn("  ⚠ V5 connect failed:", e.message);
      }
    }

    // Mounted first so the webhook's express.raw() sees unparsed bytes.
    // Always mounted, even without Stripe: /success and /order don't need it,
    // and the demo buy path lands on /success?demo=... to mint. The two routes
    // that truly need Stripe (/webhook, /checkout) guard themselves when it's
    // null, so a Stripe-less showroom still has a working success page.
    require("./lib/stripe-routes").mountStripeRoutes(app, { chain, stripe, chainV2, chainV3, chainV4, chainV5 });
    // The public storefront. Uses Stripe checkout when available, and falls
    // back to a gated demo mint so it is never dead in a local showing.
    require("./lib/storefront").mountStorefront(app, { chain, stripeEnabled: !!stripe });
    require("./lib/organizer").mountOrganizer(app, { chain, chainV2, chainV3, chainV4, chainV5 });
    // Admin-only concierge backend for sponsor keepsake events (Lane B). Needs
    // V3+ for the on-chain sponsor list; prefers V4 (sections, price display).
    require("./lib/concierge").mountConcierge(app, { chainV3, chainV4, chainV5 });
    // The memory vault: public branded pages + concierge curation. Content
    // sits behind lib/vault-store.js — the seam Arweave fills after the freeze.
    require("./lib/vault").mountVault(app);
    // Roster import — "keep your registration; send me the list": paste a
    // registration export, every person gets an emailed claim link.
    require("./lib/roster").mountRoster(app);
    // Off-chain stores are the custody ledger — get copies off this disk:
    // /admin/backup (full archive) + a nightly email snapshot (BACKUP_EMAIL).
    require("./lib/backup").mountBackup(app);
    require("./lib/wallet").mountWallet(app, { chain });

    const { ethers } = require("ethers");
    const balance = await chain.provider.getBalance(chain.signer.address);

    console.log("  network  : chain", chain.network.chainId.toString());
    console.log("  contract :", chain.address);
    console.log("  minter   :", chain.signer.address);
    console.log("  balance  :", ethers.formatEther(balance), "ETH");

    if (balance === 0n) {
      console.warn("\n  ⚠  Minter has no ETH. Mints will fail until it is topped up.");
    }
    if (!API_KEY) {
      console.warn("\n  ⚠  MINT_API_KEY is not set. /mint will refuse every request.");
      console.warn("     Generate one:  openssl rand -hex 32");
    }

    // Bind address:
    //   Local dev  -> 127.0.0.1, reachable only from this machine (safe default).
    //   Hosted     -> 0.0.0.0, so the platform (Render, etc.) can route to it.
    // We treat "RENDER is set, or a HOST override is given" as the hosted case.
    // Render injects RENDER=true into every service, so this flips automatically
    // in the showroom without exposing the local dev server.
    const HOST = process.env.HOST || (process.env.RENDER ? "0.0.0.0" : "127.0.0.1");

    app.listen(PORT, HOST, () => {
      console.log(`\n  listening on ${HOST}:${PORT}`);
      console.log(`  open that in a browser to view tickets\n`);
    });
  } catch (err) {
    console.error("\n✗ " + err.message + "\n");
    process.exit(1);
  }
})();

/* ---------------------------------------------------------------------------
 * NOTES — what changes before this faces the public internet
 * ---------------------------------------------------------------------------
 *
 * 1. Binds to 127.0.0.1 in local dev (reachable only from this machine) and to
 *    0.0.0.0 when hosted (so Render can route to it). Do not expose the local
 *    dev server until the items below are done.
 *
 * 2. The password prompt cannot survive automation. Once Stripe calls this
 *    unattended, the key moves to a managed signer — AWS/GCP KMS or Privy
 *    server wallets — where the server requests signatures without ever
 *    holding the key.
 *
 * 3. The minter should not be the contract owner. Add AccessControl with a
 *    MINTER_ROLE so a compromised server key can be revoked without losing
 *    ownership. Already on the punch list in BUILD-LOG.md.
 *
 * 4. Idempotency. Stripe retries webhooks. Without a guard, one payment mints
 *    two tickets. Store the Stripe payment id with the ticket and refuse to
 *    mint twice for the same id.
 *
 * 5. Rate limiting and a real queue. Two mints submitted at once can collide
 *    on the wallet nonce. A single-worker queue solves it.
 * ------------------------------------------------------------------------- */
