/**
 * lib/privy.js — shared Privy config + server-side verification.
 *
 * One place for the env gate and the token→wallet lookup, used by both the
 * claim flow (concierge.js) and the attendee wallet (wallet.js). The rule
 * stays: ALL THREE env vars or Privy is off everywhere — a half-configured
 * Privy would show wallet UI while the server runs custodial, which is worse
 * than either mode.
 *
 * The wallet address is always taken from Privy's server API after verifying
 * the access token — never from the client — so a user can only ever act as
 * the wallet their login actually owns.
 */

const config =
  process.env.PRIVY_APP_ID && process.env.PRIVY_CLIENT_ID && process.env.PRIVY_APP_SECRET
    ? { appId: process.env.PRIVY_APP_ID, clientId: process.env.PRIVY_CLIENT_ID }
    : null;

let client = null;
function getClient() {
  if (!config) return null;
  if (!client) {
    const { PrivyClient } = require("@privy-io/server-auth");
    client = new PrivyClient(config.appId, process.env.PRIVY_APP_SECRET);
  }
  return client;
}

/** Verify a Privy access token and return the user's embedded EVM wallet
 *  address + email. Throws on a bad/expired token or a wallet-less login. */
async function walletFromToken(token) {
  const c = getClient();
  if (!c) throw new Error("Privy is not configured.");
  const claims = await c.verifyAuthToken(token);
  const user = await c.getUserById(claims.userId);
  const accounts = user.linkedAccounts || [];
  const wallet =
    accounts.find((a) => a.type === "wallet" && a.walletClientType === "privy" && a.chainType === "ethereum") ||
    (user.wallet && user.wallet.address ? user.wallet : null);
  const email = accounts.find((a) => a.type === "email");
  if (!wallet || !wallet.address) throw new Error("Your login has no wallet yet — refresh and try again.");
  return { address: wallet.address, email: email ? email.address : null, userId: claims.userId };
}

module.exports = { config, walletFromToken };
