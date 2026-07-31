/**
 * lib/claims.js — claim codes for concierge (Lane B) sponsor events.
 *
 * A sponsor keepsake event isn't "bought" one ticket at a time. Ticklore sets it
 * up, mints nothing yet, and hands the organizer a printable sheet of codes —
 * one per ticket, grouped by the sponsor whose block it belongs to. Whoever ends
 * up holding a code claims it: the ticket is LAZY-MINTED at claim time, carrying
 * that code's sponsor. Codes never claimed never mint, so there's no wasted gas
 * and no orphan tickets — and a last-minute lineup change breaks nothing, because
 * attribution rides the code (its block), not a named person.
 *
 * File-backed like the event + order stores: honest for a single-process pilot,
 * same shape a real database would hold later.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = process.env.CLAIM_STORE || path.join(__dirname, "..", "claims.json");

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { codes: {} };
  }
}

function write(data) {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

/** An unguessable, URL-safe code. 9 bytes → 12 base64url chars, no padding. */
function newCode() {
  return crypto.randomBytes(9).toString("base64url");
}

/**
 * Generate claim codes for an event from its sponsor blocks.
 *   blocks = [{ sponsorRef, count, sponsorName }]
 * sponsorRef is the 1-based index into the event's on-chain sponsor list (0 for a
 * block with no sponsor). Returns the created code records.
 */
function generate(eventKey, blocks) {
  const data = read();
  const created = [];
  for (const b of blocks) {
    const count = Math.max(0, Math.floor(Number(b.count) || 0));
    for (let i = 0; i < count; i++) {
      let code = newCode();
      while (data.codes[code]) code = newCode(); // astronomically unlikely, still cheap to guard
      data.codes[code] = {
        code,
        eventKey,
        sponsorRef: Number(b.sponsorRef) || 0,
        sponsorName: b.sponsorName || "",
        // What the buyer pays the ORGANIZER for this ticket (engraved at mint).
        // 0 renders "Free". Ticklore never handles this money.
        priceCents: Math.max(0, Math.round(Number(b.priceCents) || 0)),
        status: "unclaimed", // unclaimed → claiming → claimed
        email: null,
        tokenId: null,
        createdAt: new Date().toISOString(),
        claimedAt: null,
      };
      created.push(data.codes[code]);
    }
  }
  write(data);
  return created;
}

function get(code) {
  return read().codes[code] || null;
}

/** All codes for one event (for the printable sheet). Order: by sponsorRef, then
 *  creation, so a sponsor's block stays together on the page. */
function listByEvent(eventKey) {
  return Object.values(read().codes)
    .filter((c) => c.eventKey === eventKey)
    .sort((a, b) => a.sponsorRef - b.sponsorRef || (a.createdAt < b.createdAt ? -1 : 1));
}

/** Counts for an event: { total, claimed, unclaimed }. */
function statsByEvent(eventKey) {
  const all = listByEvent(eventKey);
  const claimed = all.filter((c) => c.status === "claimed").length;
  return { total: all.length, claimed, unclaimed: all.length - claimed };
}

/**
 * Reserve a code before minting, so two simultaneous scans of the same code
 * can't both mint. Flips unclaimed → claiming and returns the record, or null if
 * it's already claiming/claimed/unknown. Pair with finalize() on success or
 * release() on failure.
 */
function reserve(code) {
  const data = read();
  const c = data.codes[code];
  if (!c || c.status !== "unclaimed") return null;
  c.status = "claiming";
  write(data);
  return c;
}

/** Finalize a reserved code once its ticket is minted. `address` is set when
 *  the ticket minted straight into the attendee's own (Privy) wallet — absent
 *  means platform custody against the email. */
function finalize(code, { email, tokenId, address }) {
  const data = read();
  const c = data.codes[code];
  if (!c) return null;
  c.status = "claimed";
  c.email = email || null;
  c.tokenId = tokenId != null ? String(tokenId) : null;
  c.address = address || null;
  c.claimedAt = new Date().toISOString();
  write(data);
  return c;
}

/** Hand a reserved code back if the mint failed, so it can be claimed again. */
function release(code) {
  const data = read();
  const c = data.codes[code];
  if (c && c.status === "claiming") {
    c.status = "unclaimed";
    write(data);
  }
}

/** Mirror a door redemption onto the code record, so pages can show "Admitted"
 *  without a chain read. The chain's redeem flag is the truth; this is a cache. */
function markRedeemed(code) {
  const data = read();
  const c = data.codes[code];
  if (!c) return null;
  c.redeemedAt = new Date().toISOString();
  write(data);
  return c;
}

/** Remove all codes for an event (when a sponsor event is deleted). */
function removeByEvent(eventKey) {
  const data = read();
  let n = 0;
  for (const [code, c] of Object.entries(data.codes)) {
    if (c.eventKey === eventKey) { delete data.codes[code]; n++; }
  }
  if (n) write(data);
  return n;
}

module.exports = { generate, get, listByEvent, statsByEvent, reserve, finalize, release, markRedeemed, removeByEvent };
