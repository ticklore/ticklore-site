/**
 * lib/magic.js — one-tap claim links for the buyer's own email.
 *
 * WHY THIS EXISTS. The OTP step asks a guest to leave the page, open their
 * mail app, find a six-digit number, and come back. Buyers told us plainly
 * that the coming back is where they lose: the page that wanted the code is
 * gone, and so are they. For an audience that has never done this before, the
 * verification step is the whole wall.
 *
 * A signed link in the purchase email removes the step rather than relocating
 * it. Tapping a link that was delivered to your inbox proves you can read that
 * inbox, which is the same thing an emailed code proves — it just proves it in
 * one tap instead of four.
 *
 * WHAT THE SIGNATURE IS FOR. Not secrecy: the claim code is already a bearer
 * secret, and the token rides in the same email, so it adds nothing against a
 * forwarded message. It exists to mark WHICH route a claim page was reached
 * by. A printed ticket's QR, a door-desk link, or a code read aloud must still
 * go through the OTP; only a link we ourselves mailed to the buyer skips it.
 * Without the signature, every claim page in existence would be one-tap.
 *
 * The secret is generated once and kept beside the claim store, so it lands on
 * the same persistent disk and survives redeploys. An env var overrides it for
 * anyone who would rather manage the secret themselves.
 */

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const KEY_FILE =
  process.env.MAGIC_KEY_FILE ||
  path.join(
    path.dirname(process.env.CLAIM_STORE || path.join(__dirname, "..", "claims.json")),
    "magic.key"
  );

let cached = null;

/** The signing secret: env first, then a file beside the stores, created once. */
function secret() {
  if (process.env.MAGIC_SECRET) return process.env.MAGIC_SECRET;
  if (cached) return cached;
  try {
    cached = fs.readFileSync(KEY_FILE, "utf8").trim();
    if (cached) return cached;
  } catch (_) {
    /* first run */
  }
  cached = crypto.randomBytes(32).toString("base64url");
  try {
    fs.mkdirSync(path.dirname(KEY_FILE), { recursive: true });
    fs.writeFileSync(KEY_FILE, cached, { mode: 0o600 });
  } catch (e) {
    // A read-only disk means links would change on every restart, which is
    // worse than silence — say so once so it shows up in the deploy log.
    console.error(`  ⚠ magic: could not persist ${KEY_FILE} (${e.message}); links will not survive a restart`);
  }
  return cached;
}

/** The token for a claim code. Stable for the life of the secret. */
function sign(code) {
  return crypto.createHmac("sha256", secret()).update(String(code)).digest("base64url").slice(0, 22);
}

/** Constant-time check. Any malformed input is a plain false, never a throw. */
function verify(code, token) {
  if (!code || !token) return false;
  const want = Buffer.from(sign(code));
  const got = Buffer.from(String(token));
  if (want.length !== got.length) return false;
  try {
    return crypto.timingSafeEqual(want, got);
  } catch (_) {
    return false;
  }
}

/** The full one-tap URL to put in an email. */
function link(publicUrl, code) {
  return `${publicUrl}/claim/${encodeURIComponent(code)}?t=${sign(code)}`;
}

module.exports = { sign, verify, link };
