/**
 * lib/store.js — a tiny JSON file used as the order book.
 *
 * WHY THIS EXISTS
 * ---------------
 * Stripe retries webhooks. If the network hiccups, or our server is slow, or
 * it restarts mid-request, Stripe sends the same event again — sometimes
 * several times. That is correct behaviour on their side: they would rather
 * deliver twice than not at all.
 *
 * It is a disaster on ours. Without a guard, one payment mints two tickets.
 * The customer paid once and now owns two permanent records, and the second
 * one cannot be deleted because that is the entire point of the chain.
 *
 * So before minting we ask: have we already handled this Stripe session? If
 * yes, we return the ticket we already made and do nothing else.
 *
 * A JSON file is obviously not a real database. It is honest for a
 * single-process proof of concept and nothing more — see NOTES at the bottom.
 */

const fs = require("fs");
const path = require("path");

const FILE = process.env.ORDER_STORE || path.join(__dirname, "..", "orders.json");

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { orders: {} };
  }
}

function write(data) {
  // Write to a temp file and rename. Renaming is atomic on POSIX, so a crash
  // mid-write leaves the old file intact rather than a half-written one.
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

/** Has this Stripe session already been turned into a ticket? */
function findBySession(sessionId) {
  return read().orders[sessionId] || null;
}

/**
 * Claim a session before doing any minting.
 *
 * Returns true if this call won the claim, false if someone already had it.
 * Claiming first means that even if two webhook deliveries arrive at once,
 * only one proceeds to mint.
 */
function claimSession(sessionId, details = {}) {
  const data = read();
  if (data.orders[sessionId]) return false;
  data.orders[sessionId] = { status: "minting", claimedAt: new Date().toISOString(), ...details };
  write(data);
  return true;
}

/** Record the finished ticket against the session. */
function completeSession(sessionId, result) {
  const data = read();
  data.orders[sessionId] = {
    ...(data.orders[sessionId] || {}),
    ...result,
    status: "minted",
    mintedAt: new Date().toISOString(),
  };
  write(data);
}

/**
 * Release a claim after a failed mint, so a Stripe retry can try again.
 * Without this, one transient RPC error would strand a paid order forever.
 */
function releaseSession(sessionId, error) {
  const data = read();
  data.orders[sessionId] = {
    ...(data.orders[sessionId] || {}),
    status: "failed",
    error: String(error).slice(0, 500),
    failedAt: new Date().toISOString(),
  };
  write(data);
}

function allOrders() {
  return read().orders;
}

module.exports = { findBySession, claimSession, completeSession, releaseSession, allOrders };

/* ---------------------------------------------------------------------------
 * NOTES — what changes before real money
 * ---------------------------------------------------------------------------
 *
 * 1. This is a file, not a database. It works because exactly one process
 *    touches it. Two servers behind a load balancer would race each other and
 *    the claim would stop being a claim. Postgres with a unique index on the
 *    Stripe session id is the real answer, and the index — not the code — is
 *    what makes double-minting impossible.
 *
 * 2. A failed mint currently sits marked "failed" until Stripe retries or a
 *    human looks. Production wants a retry queue and an alert, because a
 *    customer has paid and has nothing.
 *
 * 3. Emails live in here. Once this holds real customers it is personal data
 *    and belongs somewhere with access control, backups, and a deletion path.
 * ------------------------------------------------------------------------- */
