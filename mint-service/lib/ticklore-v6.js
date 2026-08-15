/**
 * lib/ticklore-v6.js — the V6 contract interface.
 *
 * V6's EXTERNAL interface is byte-for-byte V5's. The only change is what the
 * contract DRAWS: the keepsake's wordmark moved from monospace to a light
 * letterspaced sans so it matches the site, and the footer stopped crowding
 * the frame. Nothing about the ABI, the storage or the behaviour moved.
 *
 * So this re-exports V5's implementation — which itself re-exports V4's ABI —
 * with its own connect() preferring TICKLORE_CONTRACT_V6, keeping the
 * one-module-per-version pattern every other layer relies on.
 *
 * Per-version RPC (TICKLORE_RPC_V6) is here for the same reason it exists on
 * V5: when V6 goes to Base mainnet, the older generations stay readable on
 * Sepolia and every keepsake minted before the move keeps rendering.
 */

const { ethers } = require("ethers");
const { getSigner } = require("./ticklore");
const v5 = require("./ticklore-v5");

async function connect({ password } = {}) {
  const rpcUrl = process.env.TICKLORE_RPC_V6 || process.env.RPC_URL;
  const address =
    process.env.TICKLORE_CONTRACT_V6 ||
    process.env.TICKLORE_CONTRACT_V5 ||
    process.env.TICKLORE_CONTRACT_V4 ||
    process.env.TICKLORE_CONTRACT_V3 ||
    process.env.TICKLORE_CONTRACT_V2 ||
    process.env.TICKLORE_CONTRACT;
  if (!rpcUrl) throw new Error("Missing RPC_URL in .env");
  if (!address) throw new Error("Missing TICKLORE_CONTRACT_V6 (or an earlier version) in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const signer = await getSigner(provider, { password });
  const contract = new ethers.Contract(address, v5.ABI, signer);
  return { provider, signer, contract, network, address };
}

module.exports = {
  ...v5,      // ABI, palettes, buildEventArgs, createEvent, mintTicket,
  connect,    //   redeemTicket, transferOrganizer, transferTicket, getTicket
};
