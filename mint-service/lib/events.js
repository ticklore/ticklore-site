/**
 * lib/events.js — the catalogue of events organizers create.
 *
 * Replaces the hardcoded EVENTS object. Same JSON-file approach as the order
 * store: honest for a single-process pilot, and the shape is what a real
 * database would hold later, so swapping the storage out is a contained change.
 *
 * An event here is the ORGANIZER's configuration. When someone buys, these
 * fields become the on-chain TicketData for their ticket.
 */

const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const FILE = process.env.EVENT_STORE || path.join(__dirname, "..", "events.json");
const PLATFORM_MINIMUM_UNLOCK_DAYS = 30;

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { events: {} };
  }
}

function write(data) {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

/** A URL-safe slug from the event name, with a short random suffix so two
 *  "Summer Gala"s don't collide. */
function makeKey(name) {
  const base = String(name).toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "event";
  const suffix = Math.random().toString(36).slice(2, 7);
  return `${base}-${suffix}`;
}

function list() {
  const data = read();
  return Object.entries(data.events)
    .map(([key, e]) => ({ key, ...e }))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)); // newest first
}

function get(key) {
  return read().events[key] || null;
}

/**
 * Validate and store a new event. Returns { key } or throws with a message
 * safe to show the organizer.
 *
 * Note what is NOT validated away: ampersands, quotes, and angle brackets in
 * the name. The contract escapes those at render time, so "Mom & Dad's 50th"
 * is a perfectly good event name and must survive intact.
 */
function create(input) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Event name is required.");
  if (name.length > 80) throw new Error("Event name is a bit long — keep it under 80 characters.");

  const tier = String(input.tier || "General Admission").trim().slice(0, 40);
  const blurb = String(input.blurb || "").trim().slice(0, 200);

  // Price arrives as dollars from the form; store whole cents to match the
  // contract. Guard against the classic floating-point cents error.
  const dollars = Number(input.priceDollars);
  if (Number.isNaN(dollars) || dollars < 0) throw new Error("Price must be zero or a positive number.");
  if (dollars > 100000) throw new Error("Price seems too high — is that right?");
  const priceCents = Math.round(dollars * 100);

  const date = String(input.date || "").trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Please choose an event date.");
  if (Number.isNaN(new Date(date + "T12:00:00").getTime())) throw new Error("That date doesn't look valid.");

  // Unlock window: how long after the event before a ticket can be transferred.
  // Platform floor is 30 days; an organizer may go longer, never shorter.
  let unlockDays = Number(input.unlockDays);
  if (Number.isNaN(unlockDays)) unlockDays = PLATFORM_MINIMUM_UNLOCK_DAYS;
  unlockDays = Math.max(unlockDays, PLATFORM_MINIMUM_UNLOCK_DAYS);

  const nonTransferable = input.nonTransferable === true || input.nonTransferable === "true";

  // Sponsor credits (optional) — V3 allows a LIST; each ticket carries one and
  // they rotate across the run. Backward compatible with the old single
  // sponsorLabel/sponsorName pair. Stored raw; escaped at render time.
  let sponsors = Array.isArray(input.sponsors) ? input.sponsors : null;
  if (!sponsors) {
    const nm = String(input.sponsorName || "").trim();
    sponsors = nm ? [{ leadIn: String(input.sponsorLabel || "").trim(), name: nm }] : [];
  }
  sponsors = sponsors
    .map((s) => ({
      leadIn: String(s.leadIn ?? s.sponsorLabel ?? "").trim().slice(0, 28),
      name: String(s.name ?? s.sponsorName ?? "").trim().slice(0, 44),
    }))
    .filter((s) => s.name.length > 0)
    .slice(0, 128);
  // A single lead-in/name mirror (the first sponsor) so the V2 render path and
  // any preview that still reads the single pair keep working.
  const sponsorLabel = sponsors[0]?.leadIn || "";
  const sponsorName = sponsors[0]?.name || "";

  // Lane: "standard" (public, self-serve) or "sponsor" (concierge, admin-only,
  // claim-distributed). Sponsor events also carry their blocks — how many
  // tickets each sponsor backs — which drives claim-code generation.
  const mode = input.mode === "sponsor" ? "sponsor" : "standard";
  const blocks = Array.isArray(input.blocks)
    ? input.blocks.map((b) => ({
        sponsorRef: Number(b.sponsorRef) || 0,
        count: Math.max(0, Math.floor(Number(b.count) || 0)),
        sponsorName: String(b.sponsorName || "").slice(0, 44),
        priceCents: Math.max(0, Math.round(Number(b.priceCents) || 0)),
      }))
    : [];
  // Door check-in (redemption) — per-event opt-in, off by default. When on, a
  // claimed ticket can be redeemed at the door (flips the contract's redeem
  // flag; the keepsake gains its ADMITTED stamp). Keepsake-only events leave it off.
  const redemptionEnabled = input.redemptionEnabled === true || input.redemptionEnabled === "true";

  // Ticket design — whitelisted so a bad value can't reach the renderer.
  const PALETTES = ["teal", "midnight", "burgundy", "forest", "plum"];
  const STYLES = ["classic", "modern", "elegant"];
  const palette = PALETTES.includes(input.palette) ? input.palette : "teal";
  const style = STYLES.includes(input.style) ? input.style : "classic";

  // Buyer personalization is OFF unless the organizer opts in. When off, the
  // buy page never shows the name/message fields.
  const allowInscription = input.allowInscription === true || input.allowInscription === "true";

  // V2 event-model fields.
  const venue = String(input.venue || "").trim().slice(0, 60);
  const soulbound = input.soulbound === true || input.soulbound === "true";
  // The on-chain event id, set once the event is created on-chain, plus which
  // contract version created it (2 or 3) so a later buy mints on the matching
  // one across a flip. Undefined version = a legacy V2 event.
  const onChainEventId = input.onChainEventId != null ? String(input.onChainEventId) : null;
  const onChainVersion = input.onChainVersion != null ? Number(input.onChainVersion) : null;

  const data = read();

  // Guard against accidental double-submits (double-click, a network retry that
  // still reached the server, an impatient second tap): if an identical event
  // was created in the last minute, return that one instead of making a twin.
  // Older identical events are left alone — legitimately re-creating the same
  // event another day should still work.
  const RECENT_MS = 60_000;
  const nowMs = Date.now();
  for (const [k, e] of Object.entries(data.events)) {
    if (e.name === name && e.tier === tier && e.priceCents === priceCents &&
        e.date === date && e.blurb === blurb && e.unlockDays === unlockDays &&
        e.nonTransferable === nonTransferable &&
        nowMs - new Date(e.createdAt).getTime() < RECENT_MS) {
      return { key: k, duplicate: true };
    }
  }

  const key = makeKey(name);
  data.events[key] = {
    name, tier, blurb, priceCents, date, unlockDays, nonTransferable,
    sponsorLabel, sponsorName, sponsors, palette, style, allowInscription,
    venue, soulbound, onChainEventId, onChainVersion, mintedCount: 0,
    mode, blocks, redemptionEnabled,
    createdAt: new Date().toISOString(),
  };
  write(data);
  return { key };
}

/** Count one more mint against an event and return the new running total
 *  (1-based). Used to rotate ticket sponsor assignments across the run. Returns
 *  0 for an unknown key (e.g. a seed event, which isn't in this store). */
function recordMint(key) {
  const data = read();
  const e = data.events[key];
  if (!e) return 0;
  e.mintedCount = (e.mintedCount || 0) + 1;
  write(data);
  return e.mintedCount;
}

/** Remove an event by key. Returns true if it existed, false if not found.
 *  Only affects organizer-created events; the seed events live in code and are
 *  not in this store, so they can't be deleted here. */
function remove(key) {
  const data = read();
  if (!data.events[key]) return false;
  delete data.events[key];
  write(data);
  return true;
}

module.exports = { list, get, create, remove, recordMint, PLATFORM_MINIMUM_UNLOCK_DAYS };
