/**
 * lib/mint-cap.js — a small daily ceiling on demo mints.
 *
 * The showroom's "buy" mints for real on Base Sepolia from a single throwaway
 * wallet. That wallet holds a finite amount of test gas, and the demo link is
 * public — without a ceiling, a bored visitor (or a bot) could loop the buy and
 * drain it, taking the whole demo down. This caps how many demo mints happen per
 * day so the wallet can't be emptied in one sitting.
 *
 * Deliberately in-memory: the count lives in this process, resets on UTC
 * midnight (a fresh day key) and on any redeploy/restart. That is fine for a
 * demo guardrail — it's a courtesy fuse, not an accounting system. If we ever
 * need a hard, durable cap, swap the Map for a shared store behind these same
 * three functions and nothing upstream changes.
 *
 * Override the ceiling with DEMO_DAILY_MINT_CAP (the human sets it in Render).
 */

const DEFAULT_CAP = 20;

/** Today's ceiling — env override if it's a sane positive number, else default. */
function cap() {
  const n = Number(process.env.DEMO_DAILY_MINT_CAP);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : DEFAULT_CAP;
}

// day (UTC "YYYY-MM-DD") -> count of mints reserved today.
const counts = new Map();

function today() {
  return new Date().toISOString().slice(0, 10);
}

/** Drop every day but today's, so the Map can't grow without bound. */
function prune(day) {
  for (const k of counts.keys()) if (k !== day) counts.delete(k);
}

/**
 * Try to claim one mint against today's ceiling.
 * Returns { ok:true, used, remaining, cap } when there is room (and claims it),
 * or { ok:false, used, remaining:0, cap } when the day is already full.
 *
 * The check-then-increment is atomic in practice: Node runs it to completion
 * with no await in between, so two overlapping requests can't both slip past a
 * full count.
 */
function tryReserveMint() {
  const day = today();
  prune(day);
  const limit = cap();
  const used = counts.get(day) || 0;
  if (used >= limit) {
    return { ok: false, used, remaining: 0, cap: limit };
  }
  const now = used + 1;
  counts.set(day, now);
  return { ok: true, used: now, remaining: limit - now, cap: limit };
}

/** Give a claimed mint back — call when a reserved mint ends up failing, so a
 *  revert doesn't burn a slot the wallet never actually spent gas on. */
function releaseMint() {
  const day = today();
  const used = counts.get(day) || 0;
  if (used > 0) counts.set(day, used - 1);
}

/** Read today's usage without changing it. */
function status() {
  const day = today();
  const limit = cap();
  const used = counts.get(day) || 0;
  return { used, remaining: Math.max(0, limit - used), cap: limit, day };
}

module.exports = { tryReserveMint, releaseMint, status };
