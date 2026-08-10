/**
 * lib/donations.js — the gift ledger, kept deliberately apart from tickets.
 *
 * WHY ITS OWN STORE
 * -----------------
 * A $60 gala ticket and a $20 gift are different animals to a 501(c)(3). The
 * ticket is a quid pro quo — a dinner with a fair market value — while the gift
 * is a gift. Their treasurer's acknowledgment letters depend on telling those
 * two apart, and the fastest way to make that impossible is to add the numbers
 * together somewhere in our plumbing. So donations never touch the claim pool,
 * never count against the 150 seats, and never blend into ticket revenue in any
 * report we produce.
 *
 * Same shape as store.js: a JSON file, written atomically, honest for one
 * process and nothing more. Idempotent by Stripe session id, because Stripe
 * retries webhooks and a gift recorded twice is a gift misreported.
 *
 * Env: DONATION_STORE (put it on the persistent disk alongside the others, or
 * it evaporates on redeploy).
 */

const fs = require("fs");
const path = require("path");

const FILE = process.env.DONATION_STORE || path.join(__dirname, "..", "donations.json");

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { donations: {} };
  }
}

function write(data) {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

/**
 * Record a gift against its Stripe session.
 *
 * Returns { recorded, donation }. `recorded` is false when this session was
 * already on the books — the caller should treat that as success and NOT send
 * a second thank-you.
 */
function record({ sessionId, eventKey, amountCents, email, name, withTicket }) {
  if (!sessionId) throw new Error("a donation needs its Stripe session id");
  const cents = Math.round(Number(amountCents) || 0);
  if (cents <= 0) throw new Error("a donation needs a positive amount");

  const data = read();
  if (data.donations[sessionId]) return { recorded: false, donation: data.donations[sessionId] };

  data.donations[sessionId] = {
    sessionId,
    eventKey: eventKey || null,
    amountCents: cents,
    email: email || null,
    name: name || null,
    // True when the gift rode along with a ticket purchase. Kept explicit so a
    // treasurer can separate "bought a seat and gave extra" from "just gave".
    withTicket: !!withTicket,
    at: new Date().toISOString(),
  };
  write(data);
  return { recorded: true, donation: data.donations[sessionId] };
}

function listByEvent(eventKey) {
  return Object.values(read().donations).filter((d) => d.eventKey === eventKey);
}

/** Counts and cents for an event, split the way a treasurer needs them. */
function totals(eventKey) {
  const list = listByEvent(eventKey);
  const sum = (xs) => xs.reduce((n, d) => n + d.amountCents, 0);
  const withTicket = list.filter((d) => d.withTicket);
  const alone = list.filter((d) => !d.withTicket);
  return {
    count: list.length,
    cents: sum(list),
    withTicketCount: withTicket.length,
    withTicketCents: sum(withTicket),
    aloneCount: alone.length,
    aloneCents: sum(alone),
  };
}

function all() {
  return read().donations;
}

module.exports = { record, listByEvent, totals, all };
