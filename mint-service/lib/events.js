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

  const data = read();
  const key = makeKey(name);
  data.events[key] = {
    name, tier, blurb, priceCents, date, unlockDays, nonTransferable,
    createdAt: new Date().toISOString(),
  };
  write(data);
  return { key };
}

module.exports = { list, get, create, PLATFORM_MINIMUM_UNLOCK_DAYS };
