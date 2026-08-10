/**
 * lib/backup.js — because the custody ledger must never have one copy.
 *
 * The chain protects the keepsakes; these files protect WHO THEY BELONG TO.
 * Everything off-chain lives in JSON stores on one disk — events (with their
 * on-chain ids), claim codes (printed sheets die without them), the
 * email→keepsake custody records, orders, and the vault. This module gets
 * copies OFF that disk two ways:
 *
 *   1. GET /admin/backup — password-gated, on-demand: a tar.gz of every store
 *      PLUS the vault media directory. Click, download, done.
 *   2. A nightly email snapshot of the JSON stores (the truly irreplaceable
 *      kilobytes; media excluded to stay mail-sized) to BACKUP_EMAIL via the
 *      same Resend that sends receipts. At most once per 20h, tracked by a
 *      marker file on the persistent disk so redeploys don't spam.
 *
 * PRIVACY RULE: backups contain emails and custody records — they go to the
 * admin and NOWHERE else. Never to public/permanent storage (no Arweave).
 * Both paths degrade gracefully: no Resend key or no BACKUP_EMAIL just means
 * the scheduler stays off; the download endpoint always works.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");
const { execFile } = require("child_process");

// The same defaults the store modules use — kept in one list so a new store
// added elsewhere should be added here too (see docs/HANDOFF.md).
function storeFiles() {
  const base = path.join(__dirname, "..");
  return [
    { name: "events.json", file: process.env.EVENT_STORE || path.join(base, "events.json") },
    { name: "claims.json", file: process.env.CLAIM_STORE || path.join(base, "claims.json") },
    { name: "vault.json", file: process.env.VAULT_STORE || path.join(base, "vault.json") },
    { name: "orders.json", file: process.env.ORDER_STORE || path.join(base, "orders.json") },
    { name: "donations.json", file: process.env.DONATION_STORE || path.join(base, "donations.json") },
  ].filter((s) => fs.existsSync(s.file));
}

function mediaDir() {
  const dir = process.env.VAULT_MEDIA || path.join(__dirname, "..", "vault-media");
  return fs.existsSync(dir) ? dir : null;
}

function stamp() {
  return new Date().toISOString().replace(/[:T]/g, "-").slice(0, 16);
}

/** Build the full archive (stores + media) with the system tar. Calls back
 *  with the temp file path; caller streams and deletes it. */
function makeFullArchive(cb) {
  const out = path.join(os.tmpdir(), `ticklore-backup-${stamp()}-${crypto.randomBytes(3).toString("hex")}.tar.gz`);
  const args = ["-czf", out];
  for (const s of storeFiles()) args.push("-C", path.dirname(s.file), path.basename(s.file));
  const media = mediaDir();
  if (media) args.push("-C", path.dirname(media), path.basename(media));
  if (args.length === 2) return cb(new Error("Nothing to back up yet."));
  execFile("tar", args, (err) => cb(err, out));
}

/** The nightly snapshot payload: every JSON store bundled into one gzipped
 *  JSON document (self-describing, restorable by hand if it ever comes to that). */
function makeSnapshotBundle() {
  const bundle = { takenAt: new Date().toISOString(), stores: {} };
  for (const s of storeFiles()) {
    try {
      bundle.stores[s.name] = JSON.parse(fs.readFileSync(s.file, "utf8"));
    } catch {
      bundle.stores[s.name] = { unreadable: true };
    }
  }
  return zlib.gzipSync(Buffer.from(JSON.stringify(bundle)));
}

// Marker lives next to the claim store so it rides the persistent disk.
function markerFile() {
  const anchor = process.env.CLAIM_STORE || path.join(__dirname, "..", "claims.json");
  return path.join(path.dirname(anchor), ".last-backup-email");
}

function hoursSinceLastEmail() {
  try {
    const t = new Date(fs.readFileSync(markerFile(), "utf8").trim()).getTime();
    return (Date.now() - t) / 36e5;
  } catch {
    return Infinity;
  }
}

/** Email the snapshot to BACKUP_EMAIL. Always resolves with {sent, reason?}. */
async function sendBackupEmail() {
  const to = process.env.BACKUP_EMAIL;
  const key = process.env.RESEND_API_KEY;
  if (!to) return { sent: false, reason: "BACKUP_EMAIL not set — nightly backup off" };
  if (!key) return { sent: false, reason: "RESEND_API_KEY not set — nightly backup off" };

  const { Resend } = require("resend");
  const gz = makeSnapshotBundle();
  const name = `ticklore-stores-${stamp()}.json.gz`;
  const from = process.env.FROM_EMAIL || "Ticklore <onboarding@resend.dev>";

  const { data, error } = await new Resend(key).emails.send({
    from,
    to: [to],
    subject: `Ticklore nightly backup — ${new Date().toISOString().slice(0, 10)}`,
    text: [
      "Attached: tonight's snapshot of the off-chain stores (events, claims/custody, vault entries, orders).",
      "Media (photos) is NOT included — use /admin/backup for the full archive.",
      "Keep a few of these; they are the custody ledger.",
      "",
      `Stores included: ${storeFiles().map((s) => s.name).join(", ") || "none yet"}`,
    ].join("\n"),
    attachments: [{ filename: name, content: gz.toString("base64") }],
  });

  if (error) return { sent: false, reason: error.message || String(error) };
  try { fs.writeFileSync(markerFile(), new Date().toISOString()); } catch { /* marker is best-effort */ }
  return { sent: true, id: data?.id };
}

/** Kick the scheduler: check on boot, then every 6 hours; send only when the
 *  last successful email is older than 20h (redeploys can't spam). */
function startScheduler() {
  const tick = async () => {
    if (hoursSinceLastEmail() < 20) return;
    const r = await sendBackupEmail().catch((e) => ({ sent: false, reason: e.message }));
    console.log(r.sent ? `  ✉ nightly backup → ${process.env.BACKUP_EMAIL} (${r.id})` : `  · backup email: ${r.reason}`);
  };
  setTimeout(tick, 15 * 1000); // after boot settles
  setInterval(tick, 6 * 60 * 60 * 1000);
}

function mountBackup(app) {
  const PASSWORD = process.env.ADMIN_PASSWORD;
  function checkPassword(req, res, next) {
    if (!PASSWORD) return res.status(500).json({ error: "Backup is not configured (ADMIN_PASSWORD unset)." });
    const given = req.get("x-admin-password") || "";
    const a = Buffer.from(given), b = Buffer.from(PASSWORD);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
      return res.status(401).json({ error: "Wrong password." });
    }
    next();
  }
  /** Full archive on demand — stores + vault media. */
  app.get("/admin/backup", checkPassword, (req, res) => {
    makeFullArchive((err, file) => {
      if (err) return res.status(500).json({ error: err.message });
      res.download(file, path.basename(file), () => {
        fs.unlink(file, () => {});
      });
    });
  });

  /** Backup status — when the last nightly went out, what's covered. */
  app.get("/admin/backup/status", checkPassword, (req, res) => {
    const h = hoursSinceLastEmail();
    res.json({
      stores: storeFiles().map((s) => s.name),
      media: !!mediaDir(),
      nightlyConfigured: !!(process.env.BACKUP_EMAIL && process.env.RESEND_API_KEY),
      lastEmailHoursAgo: Number.isFinite(h) ? Math.round(h * 10) / 10 : null,
    });
  });

  startScheduler();
}

module.exports = { mountBackup, sendBackupEmail, makeSnapshotBundle };
