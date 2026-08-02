/**
 * lib/names.js — first name + last initial, applied at the mint seam.
 *
 * Privacy default (docs/privacy-defaults.md): keepsakes display "Alex W.",
 * never a full surname — the recovery community's own convention, and warmer
 * for every event. The full surname must never be rendered on the keepsake or
 * written on-chain, so the shortening happens server-side, at the seam every
 * mint flows through — not in the UI, where it could be bypassed.
 *
 * The rule is deliberately conservative, because buyer names are also
 * expressive ("Dave & Priya", "The Sullivan family", "Mom & Dad") and mangling
 * those would wreck keepsakes:
 *   - Normalize ONLY when the text looks like a real personal name: 2–4
 *     words, every word name-like (letters, hyphens, apostrophes, starting
 *     uppercase), no connectors (&, and, +, family, crew…).
 *   - Then: keep everything but the last word; the last word becomes an
 *     initial. "Alex Winfield" → "Alex W.", "Mary Jo Smith" → "Mary Jo S.",
 *     "Anna-Lee O'Brien" → "Anna-Lee O.".
 *   - Anything else passes through untouched (it isn't a surname disclosure).
 */

const CONNECTORS = new Set([
  "&", "+", "and", "und", "y", "the", "family", "families", "crew", "gang",
  "team", "kids", "boys", "girls", "cousins",
]);

/** One word that plausibly belongs to a personal name. */
function nameLike(word) {
  return /^[A-Z][A-Za-z'’-]*$/.test(word);
}

/** Shorten "First … Last" to "First … L." when — and only when — it reads as a
 *  personal name. Everything else is returned unchanged. */
function keepsakeName(raw) {
  const text = String(raw || "").trim().replace(/\s+/g, " ");
  if (!text) return "";

  const words = text.split(" ");
  if (words.length < 2 || words.length > 4) return text;
  if (words.some((w) => CONNECTORS.has(w.toLowerCase()))) return text;
  if (!words.every(nameLike)) return text;

  const last = words[words.length - 1];
  // Already an initial ("Alex W." / "Alex W") — leave it be.
  if (/^[A-Z]\.?$/.test(last)) return text;

  return `${words.slice(0, -1).join(" ")} ${last[0].toUpperCase()}.`;
}

module.exports = { keepsakeName };
