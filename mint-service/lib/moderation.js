/**
 * lib/moderation.js — the checkpoint BEFORE an inscription reaches the mint.
 *
 * A buyer inscription is engraved on-chain, forever. There is no delete, no
 * edit, no appeal after the fact — so the only acceptable place to catch abuse
 * is BEFORE the mint fires. This module is that gate (a product non-negotiable).
 *
 * Philosophy: for a permanent engraver, a FALSE POSITIVE costs a rephrase; a
 * FALSE NEGATIVE is forever. So the filter leans strict:
 *   - blocklist terms are matched inside a normalized AND a "squeezed" form of
 *     the text (leetspeak mapped, separators removed), which catches f.u.c.k,
 *     f*ck, and spaced-out evasions — at the cost of occasionally flagging an
 *     innocent word that embeds a bad one. The buyer just picks other words.
 *   - links, emails, and long digit runs are rejected outright: an inscription
 *     is a memory, not a billboard or a phone book.
 *
 * This is pilot-grade, not a content-safety career. When events get bigger,
 * layer a proper moderation API and/or organizer approval on top — behind this
 * same checkInscription() seam so nothing upstream changes.
 */

// Common profanity + slurs. Lowercase. Matched as substrings of the normalized
// and squeezed text (see note above about strictness).
const BLOCKLIST = [
  "fuck", "shit", "cunt", "bitch", "asshole", "dickhead", "cocksuck",
  "nigger", "nigga", "faggot", "kike", "spic", "wetback", "chink", "gook",
  "tranny", "retard", "raghead", "beaner",
  "whore", "slut", "rapist", "molest",
  "nazi", "hitler", "kkk", "lynch",
  "porn", "penis", "vagina", "blowjob", "handjob", "tits",
];

// Masked / vowel-swapped evasions ("f*ck" → "fck", "f0ck" → "fock"). Checked as
// WHOLE tokens (each word stripped to letters), never substrings — so "Ashton"
// can't trip "sht" and "Fukushima" can't trip "fuk".
const TOKEN_BLOCKLIST = new Set([
  "fck", "fcking", "fckin", "fckn", "fuk", "fuks", "fukc", "fvck", "fock", "focking", "phuck",
  "sht", "shtty", "btch", "btches", "cnt", "cnts", "dck", "dcks", "pssy",
  "nggr", "ngga", "nggas", "fgt", "fggt", "fgts",
]);

// Leetspeak / symbol substitutions people use to sneak terms past filters.
const LEET = { "0": "o", "1": "i", "3": "e", "4": "a", "5": "s", "7": "t", "8": "b", "@": "a", "$": "s", "!": "i", "+": "t" };

/** Lowercase + map leet substitutions, keep spacing. */
function normalize(text) {
  return String(text).toLowerCase().replace(/[0134578@$!+]/g, (c) => LEET[c] || c);
}

/** Normalized with every non-letter removed — catches "f u c k", "f.u.c.k", "f*ck". */
function squeeze(text) {
  return normalize(text).replace(/[^a-z]/g, "");
}

const URL_RE = /(https?:\/\/|www\.|\.(com|net|org|io|xyz|app|gg|ly|me|co|eth)(\b|$))/i;
const EMAIL_RE = /\S+@\S+\.\S+/;
const LONG_DIGITS_RE = /\d{7,}/;

/**
 * Check one piece of buyer text (name or inscription) before it may be engraved.
 * Returns { ok: true } or { ok: false, reason } with a reason safe to show.
 */
function checkText(text) {
  const raw = String(text || "");
  if (!raw.trim()) return { ok: true }; // empty is always fine

  if (/[\r\n]/.test(raw)) {
    return { ok: false, reason: "Inscriptions are a single line." };
  }
  if (URL_RE.test(raw) || EMAIL_RE.test(raw)) {
    return { ok: false, reason: "Links and addresses can't be engraved — an inscription is a memory, not an ad." };
  }
  if (LONG_DIGITS_RE.test(raw)) {
    return { ok: false, reason: "Long numbers can't be engraved." };
  }

  const REJECT = { ok: false, reason: "That wording can't be engraved — a keepsake is permanent, so we keep it clean. Try different words." };

  const norm = normalize(raw);
  const squeezed = squeeze(raw);
  for (const term of BLOCKLIST) {
    if (norm.includes(term) || squeezed.includes(term)) return REJECT;
  }
  // Masked variants, one word at a time ("f*ck" → "fck", "f0ck" → "fock").
  // Split on whitespace, then strip symbols INSIDE each word — splitting on the
  // symbols themselves would fragment "f*ck" into "f" + "ck" and miss it.
  for (const word of norm.split(/\s+/)) {
    const tok = word.replace(/[^a-z]/g, "");
    if (tok && TOKEN_BLOCKLIST.has(tok)) return REJECT;
  }
  return { ok: true };
}

/** Convenience: check a buyer name + inscription pair in one call. */
function checkInscription({ buyerName, inscription } = {}) {
  const name = checkText(buyerName);
  if (!name.ok) return name;
  return checkText(inscription);
}

module.exports = { checkText, checkInscription };
