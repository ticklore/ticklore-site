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

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.MINT_API_KEY;

const app = express();

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
    res.json({
      status: "ok",
      chainId: chain.network.chainId.toString(),
      contract: chain.address,
      minter: chain.signer.address,
      minterBalanceEth: require("ethers").formatEther(balance),
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
    const { metadata } = await ticklore.getTicket(chain.contract, req.params.id);
    const owner = await chain.contract.ownerOf(req.params.id);
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
    const { svg } = await ticklore.getTicket(chain.contract, req.params.id);
    if (!svg) return res.status(404).send("No SVG in metadata");
    res.type("image/svg+xml").send(svg);
  } catch (err) {
    res.status(404).send(`No such ticket: ${req.params.id}`);
  }
});

/** A tiny viewer, so a ticket can be looked at without any tooling. */
app.get("/", (req, res) => {
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

    if (stripe) {
      // Mounted first so the webhook's express.raw() sees unparsed bytes.
      require("./lib/stripe-routes").mountStripeRoutes(app, { chain, stripe });
    }

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

    app.listen(PORT, "127.0.0.1", () => {
      console.log(`\n  listening on http://localhost:${PORT}`);
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
 * 1. Bound to 127.0.0.1 on purpose. It is reachable only from this machine.
 *    Do not change that until the items below are done.
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
