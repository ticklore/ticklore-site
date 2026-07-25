/**
 * lib/ratelimit.js — a small in-memory rate limiter.
 *
 * The public showroom mints real testnet transactions, each costing gas from a
 * throwaway wallet. Without a limit, one person (or a bot) hammering the buy
 * button drains that wallet and the demo goes dark. This caps how often a
 * single IP can mint.
 *
 * In-memory on purpose: a demo runs as one process, and a limiter that resets
 * on restart is completely fine for this. A multi-instance production system
 * would use a shared store (Redis) instead.
 */

const hits = new Map(); // ip -> array of timestamps (ms)

/**
 * @param {object} opts
 * @param {number} opts.windowMs   how far back to look
 * @param {number} opts.max        max requests allowed in that window
 */
function rateLimit({ windowMs = 60_000, max = 5 } = {}) {
  return (req, res, next) => {
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const now = Date.now();
    const recent = (hits.get(ip) || []).filter((t) => now - t < windowMs);

    if (recent.length >= max) {
      const retryS = Math.ceil((windowMs - (now - recent[0])) / 1000);
      res.set("Retry-After", String(retryS));
      return res.status(429).json({
        error: `That's a lot of tickets at once. Try again in ${retryS} seconds.`,
      });
    }

    recent.push(now);
    hits.set(ip, recent);

    // Opportunistic cleanup so the map doesn't grow forever.
    if (hits.size > 5000) {
      for (const [k, v] of hits) {
        if (v.every((t) => now - t > windowMs)) hits.delete(k);
      }
    }

    next();
  };
}

module.exports = { rateLimit };
