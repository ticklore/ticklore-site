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
function generate(eventKey, blocks, { activationRequired = false } = {}) {
  const data = read();
  const created = [];
  for (const b of blocks) {
    const count = Math.max(0, Math.floor(Number(b.count) || 0));
    const online = b.online === true;
    // Human stub labels ("BLUE 105"…): prefix + running number with the
    // typed zero-padding preserved. Null when the block wasn't labeled.
    const hasLabel = b.labelStart != null || (b.labelPrefix && String(b.labelPrefix).length);
    for (let i = 0; i < count; i++) {
      const label = hasLabel
        ? `${b.labelPrefix ? b.labelPrefix + " " : ""}${String((Number(b.labelStart) || 1) + i).padStart(Number(b.labelPad) || 2, "0")}`
        : null;
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
        // The named section this block belongs to ("Table 7"); 0/"" = none.
        sectionRef: Number(b.sectionRef) || 0,
        section: b.section || "",
        // The human inventory label ("BLUE 105") — for stubs, desks, disputes.
        label,
        // "print" codes go on the QR sheet; "online" codes are sold through the
        // card payment gate and are NEVER printed — the webhook emails them out.
        channel: online ? "online" : "print",
        // Seller activation (gift-card model): when the event requires it,
        // printed codes start dormant and the desk activates each at sale.
        // Online codes are always active — the payment IS the activation.
        active: online ? true : !activationRequired,
        // Online allocation: set when a payment assigns this code to a buyer,
        // so the same code can never be sold twice.
        assignedTo: null,
        assignedAt: null,
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

/**
 * Roster import (the Serenity play: "keep your registration; send me the
 * list"). One code per person, channel "roster" — never printed, born active,
 * the person's email stamped on at creation. IDEMPOTENT by email per event:
 * re-importing an updated list only creates codes for the new people, so the
 * organizer can send the list weekly without double-issuing anyone.
 * Returns { created: [codes], skipped: n (already had one), }.
 */
function importRoster(eventKey, entries, { priceCents = 0 } = {}) {
  const data = read();
  const have = new Set(
    Object.values(data.codes)
      .filter((c) => c.eventKey === eventKey && c.channel === "roster" && c.assignedTo)
      .map((c) => c.assignedTo.toLowerCase())
  );
  const created = [];
  let skipped = 0;
  for (const person of entries) {
    const email = String(person.email || "").trim().toLowerCase();
    if (!email) continue;
    if (have.has(email)) { skipped++; continue; }
    have.add(email);
    let code = newCode();
    while (data.codes[code]) code = newCode();
    data.codes[code] = {
      code,
      eventKey,
      sponsorRef: 0,
      sponsorName: "",
      priceCents: Math.max(0, Math.round(Number(priceCents) || 0)),
      sectionRef: 0,
      section: "",
      channel: "roster",
      active: true, // registration already happened; nothing to activate
      assignedTo: email,
      assignedName: String(person.name || "").trim().slice(0, 60), // organizer reconciliation only — never rendered
      assignedAt: new Date().toISOString(),
      emailSentAt: null,
      status: "unclaimed",
      email: null,
      tokenId: null,
      createdAt: new Date().toISOString(),
      claimedAt: null,
    };
    created.push(data.codes[code]);
  }
  if (created.length) write(data);
  return { created, skipped };
}

/** Roster codes for one event, oldest first. */
function listRoster(eventKey) {
  return Object.values(read().codes)
    .filter((c) => c.eventKey === eventKey && c.channel === "roster")
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/** Stamp a roster code as invited (its claim-link email went out). */
function markEmailed(code) {
  const data = read();
  const c = data.codes[code];
  if (!c) return null;
  c.emailSentAt = new Date().toISOString();
  write(data);
  return c;
}

/** Desk activation at the moment of a cash sale. Returns the record, or null. */
function activate(code) {
  const data = read();
  const c = data.codes[code];
  if (!c) return null;
  c.active = true;
  c.activatedAt = new Date().toISOString();
  write(data);
  return c;
}

/** Allocate one unsold online code to a paying buyer (webhook path). Picks the
 *  oldest unclaimed, unassigned online code for the event, stamps the buyer on
 *  it, and returns it — or null when the online block is sold out. Node runs
 *  this to completion with no await inside, so two webhooks can't double-sell. */
function allocateOnline(eventKey, buyerEmail) {
  const data = read();
  const pick = Object.values(data.codes)
    .filter((c) => c.eventKey === eventKey && c.channel === "online" && c.status === "unclaimed" && !c.assignedTo)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))[0];
  if (!pick) return null;
  pick.assignedTo = String(buyerEmail || "").trim().slice(0, 120) || "unknown";
  pick.assignedAt = new Date().toISOString();
  write(data);
  return pick;
}

/**
 * Allocate SEVERAL online codes at once — one payment, several seats.
 *
 * People bring dates and families, so a checkout that only sells one ticket is
 * a checkout that loses the sale. This takes them in a single read/write: N
 * separate allocateOnline() calls would each re-read the file, and two orders
 * landing together could hand the same code to both buyers.
 *
 * Returns whatever it could take, which may be FEWER than asked for if the
 * event sold out in between. The caller has already taken money, so a short
 * result is a refund conversation, never a silent shrug.
 */
function allocateOnlineBatch(eventKey, buyerEmail, qty) {
  const want = Math.max(1, Math.floor(Number(qty) || 1));
  const data = read();
  const open = Object.values(data.codes)
    .filter((c) => c.eventKey === eventKey && c.channel === "online" && c.status === "unclaimed" && !c.assignedTo)
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .slice(0, want);
  if (!open.length) return [];

  const who = String(buyerEmail || "").trim().slice(0, 120) || "unknown";
  const at = new Date().toISOString();
  for (const c of open) {
    c.assignedTo = who;
    c.assignedAt = at;
  }
  write(data);
  return open;
}

/** How many online codes remain sellable for an event. */
function onlineRemaining(eventKey) {
  return Object.values(read().codes)
    .filter((c) => c.eventKey === eventKey && c.channel === "online" && c.status === "unclaimed" && !c.assignedTo)
    .length;
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

/** Everything a person has claimed — matched by wallet address (tickets they
 *  OWN, minted into their Privy wallet) or by email (older custodial claims,
 *  held for them). Newest first. Powers the attendee wallet. */
function listByOwner({ email, address }) {
  const e = (email || "").toLowerCase();
  const a = (address || "").toLowerCase();
  return Object.values(read().codes)
    .filter((c) => c.status === "claimed" && c.tokenId != null)
    .filter((c) =>
      (a && c.address && c.address.toLowerCase() === a) ||
      (e && c.email && c.email.toLowerCase() === e))
    .map((c) => ({
      tokenId: c.tokenId,
      eventKey: c.eventKey,
      sponsorName: c.sponsorName || "",
      priceCents: c.priceCents || 0,
      owned: !!(a && c.address && c.address.toLowerCase() === a),
      redeemedAt: c.redeemedAt || null,
      claimedAt: c.claimedAt,
      // The code is what the door scans. Returning it here is safe by
      // construction: this list is only ever built for someone Privy has
      // already vouched for as this keepsake's holder, and the code is
      // already claimed — it can't be redeemed a second time by knowing it.
      code: c.code,
    }))
    .sort((x, y) => (x.claimedAt < y.claimedAt ? 1 : -1));
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

module.exports = {
  generate, get, listByEvent, statsByEvent, listByOwner,
  importRoster, listRoster, markEmailed,
  activate, allocateOnline, allocateOnlineBatch, onlineRemaining, retireOnline, search,
  reserve, finalize, release, markRedeemed, markAttended, removeByEvent,
  orphans, removeOrphans,
};

/**
 * Retire unsold ONLINE codes — the counterweight to adding a cash block.
 *
 * The room holds what it holds. When a printed ticket sells, one online seat
 * has to stop being sellable or the same chair gets sold twice. This deletes at
 * most n online codes that are strictly unclaimed and unassigned; it can never
 * touch a code someone has paid for, reserved, or claimed. Deleting rather than
 * flagging keeps statsByEvent honest — a voided code would still count toward
 * the total and make "1/200" appear for a 150-seat room.
 *
 * Returns how many actually went, which may be fewer than asked.
 */
function retireOnline(eventKey, n) {
  const want = Math.max(0, Math.floor(Number(n) || 0));
  if (!want) return 0;
  const data = read();
  let gone = 0;
  for (const [code, c] of Object.entries(data.codes)) {
    if (gone >= want) break;
    if (c.eventKey === eventKey && c.channel === "online" &&
        c.status === "unclaimed" && !c.assignedTo) {
      delete data.codes[code];
      gone++;
    }
  }
  if (gone) write(data);
  return gone;
}

/**
 * Find a guest's code at the door. Matches an exact code, or a substring of
 * the buyer email or the printed stub label.
 *
 * Online buyers are stamped on `assignedTo` when the payment allocates their
 * code, and on `email` only once they claim — so a buyer who paid and never
 * claimed is findable by the first and invisible to the second. Search both or
 * the people most likely to need help are the ones you cannot find.
 */
function search(q) {
  const needle = String(q || "").trim().toLowerCase();
  if (needle.length < 2) return [];
  const hit = (s) => s && String(s).toLowerCase().includes(needle);
  return Object.values(read().codes)
    .filter((c) =>
      (c.code && c.code.toLowerCase() === needle) ||
      hit(c.email) || hit(c.assignedTo) || hit(c.label))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1))
    .slice(0, 25);
}

/**
 * Admit someone at the door who never claimed.
 *
 * Attendance is recorded off-chain and instantly: a queue on New Year's Eve is
 * no place for a blockchain write. The keepsake is minted and redeemed behind
 * them, and anything that fails gets reconciled afterwards. Idempotent, so a
 * double tap on a cold night does not double-admit.
 */
function markAttended(code, by) {
  const data = read();
  const c = data.codes[code];
  if (!c) return null;
  if (!c.attendedAt) {
    c.attendedAt = new Date().toISOString();
    c.attendedBy = String(by || "door").slice(0, 40);
    write(data);
  }
  return c;
}

/**
 * Codes whose event no longer resolves — and what removing them would cost.
 *
 * A claim record carries an eventKey, not the event itself. Delete or recreate
 * an event and every code issued under the old key is stranded: the claim page
 * renders with no name, no venue and no vault link, and the claim POST refuses
 * outright at the onChainEventId check. The guest does the whole sign-in dance
 * and gets "this event is no longer available" at the last step.
 *
 * Takes a predicate rather than requiring events.js, so the store stays a leaf
 * and the caller decides what "exists" means. Read-only on purpose: knowing
 * what would go is a separate act from making it go.
 */
function orphans(eventExists) {
  const data = read();
  const groups = new Map();
  for (const [code, c] of Object.entries(data.codes || {})) {
    const key = c.eventKey || "(no event key)";
    if (c.eventKey && eventExists(c.eventKey)) continue;
    if (!groups.has(key)) groups.set(key, { eventKey: key, total: 0, claimed: 0, minted: 0, samples: [] });
    const g = groups.get(key);
    g.total++;
    if (c.status === "claimed") g.claimed++;
    if (c.tokenId) g.minted++;
    if (g.samples.length < 5) {
      g.samples.push({
        code,
        who: c.email || c.assignedTo || "",
        status: c.status || "unclaimed",
        channel: c.channel || "",
        tokenId: c.tokenId || null,
      });
    }
  }
  return [...groups.values()].sort((a, b) => b.total - a.total);
}

/** Delete stranded codes. Scoped to one dead eventKey at a time so a typo in
 *  the predicate can't empty the store in a single call. Returns the count. */
function removeOrphans(eventExists, eventKey) {
  const data = read();
  let n = 0;
  for (const [code, c] of Object.entries(data.codes || {})) {
    const key = c.eventKey || "(no event key)";
    if (key !== eventKey) continue;
    if (c.eventKey && eventExists(c.eventKey)) continue; // live event: never touch
    delete data.codes[code];
    n++;
  }
  if (n) write(data);
  return n;
}
