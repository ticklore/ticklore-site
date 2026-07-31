/**
 * lib/vault-store.js — the memory vault's content store (THE STORAGE SEAM).
 *
 * ADR-001 rev 3 splits the vault into two layers: the LOOK is presentation the
 * app renders freely; WHERE CONTENT LIVES decides permanence. This module is
 * the seam between them. Today it's a JSON file + a media directory on the
 * persistent disk — honest for the pilot. After the contract freeze, the
 * permanent core (event record, story, curated photos) anchors to Arweave
 * BEHIND THIS SAME API, and nothing upstream changes.
 *
 * Curation is the privacy model ("gating a view is theater; content is
 * public — privacy = what the organizer chooses to publish"). Every entry has
 * a status: today's concierge flow publishes directly (the admin IS the
 * curator), but the "pending" state is already here for the day attendees can
 * submit — their entries will land pending and wait for the curator's yes.
 *
 *   Entry: { id, eventKey, type: "photo" | "letter", title, text, credit,
 *            media (filename under the media dir, photos only),
 *            status: "pending" | "published", createdAt, publishedAt }
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const FILE = process.env.VAULT_STORE || path.join(__dirname, "..", "vault.json");
const MEDIA_DIR = process.env.VAULT_MEDIA || path.join(__dirname, "..", "vault-media");

function read() {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8"));
  } catch {
    return { entries: {} };
  }
}

function write(data) {
  const tmp = FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, FILE);
}

function ensureMediaDir() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
}

/** Decode a data-URL image and save it under an unguessable id-based filename.
 *  Returns the stored filename. Only the formats a browser camera/gallery
 *  actually produces. */
function saveMedia(dataUrl) {
  const m = /^data:image\/(png|jpe?g|webp|gif);base64,(.+)$/s.exec(String(dataUrl || ""));
  if (!m) throw new Error("That doesn't look like a photo (png/jpg/webp/gif).");
  const ext = m[1] === "jpeg" ? "jpg" : m[1];
  const buf = Buffer.from(m[2], "base64");
  if (buf.length < 100) throw new Error("That photo looks empty.");
  if (buf.length > 8 * 1024 * 1024) throw new Error("Photos are capped at 8 MB for now.");
  ensureMediaDir();
  const name = `${crypto.randomBytes(9).toString("base64url")}.${ext}`;
  fs.writeFileSync(path.join(MEDIA_DIR, name), buf);
  return name;
}

/** Read a stored media file by its exact stored name (path-traversal safe). */
function mediaPath(name) {
  if (!/^[A-Za-z0-9_-]{6,24}\.(png|jpg|webp|gif)$/.test(String(name || ""))) return null;
  const p = path.join(MEDIA_DIR, name);
  return fs.existsSync(p) ? p : null;
}

/** Add an entry. Photos pass imageData (a data URL); letters pass text.
 *  `publish` true = live immediately (the concierge/curator path); attendee
 *  submissions pass false and wait for the curator. `submitter` is context
 *  for curation ({name, email, verified}) — never rendered publicly unless
 *  the curator puts it in the credit. */
function add(eventKey, { type, title, text, credit, imageData, publish, submitter }) {
  const t = type === "photo" ? "photo" : "letter";
  const entry = {
    id: crypto.randomBytes(8).toString("base64url"),
    eventKey: String(eventKey),
    type: t,
    title: String(title || "").trim().slice(0, 80),
    text: String(text || "").trim().slice(0, 4000),
    credit: String(credit || "").trim().slice(0, 60),
    media: null,
    status: publish ? "published" : "pending",
    submitter: submitter
      ? {
          name: String(submitter.name || "").trim().slice(0, 60),
          email: String(submitter.email || "").trim().slice(0, 120),
          verified: !!submitter.verified,
        }
      : null,
    createdAt: new Date().toISOString(),
    publishedAt: publish ? new Date().toISOString() : null,
  };
  if (t === "photo") {
    entry.media = saveMedia(imageData);
  } else if (!entry.text) {
    throw new Error("A letter needs some words.");
  }
  const data = read();
  data.entries[entry.id] = entry;
  write(data);
  return entry;
}

/** Entries for one event. `publishedOnly` for the public page. Oldest first —
 *  a vault reads like a story, in the order it was told. */
function listByEvent(eventKey, { publishedOnly = true } = {}) {
  return Object.values(read().entries)
    .filter((e) => e.eventKey === eventKey)
    .filter((e) => (publishedOnly ? e.status === "published" : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1));
}

/** Publish a pending entry (the curator's yes). */
function publish(id) {
  const data = read();
  const e = data.entries[id];
  if (!e) return null;
  e.status = "published";
  e.publishedAt = new Date().toISOString();
  write(data);
  return e;
}

/** Remove an entry (and its media file). The pilot store is editable; the
 *  Arweave layer, once it exists, is not — curation happens BEFORE permanence. */
function remove(id) {
  const data = read();
  const e = data.entries[id];
  if (!e) return false;
  if (e.media) {
    const p = mediaPath(e.media);
    if (p) { try { fs.unlinkSync(p); } catch { /* already gone */ } }
  }
  delete data.entries[id];
  write(data);
  return true;
}

module.exports = { add, listByEvent, publish, remove, mediaPath };
