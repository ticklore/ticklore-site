/**
 * lib/ticklore-v5.js — the freeze-candidate (V5) contract interface.
 *
 * V5's EXTERNAL interface is byte-for-byte V4's — the only change is internal
 * (the custody-delivery exemption in _update: transfers FROM the contract
 * owner bypass the anti-scalp window and soulbound, so "held for you" can
 * become "yours"). So this module simply re-exports the V4 implementation
 * with its own connect() preferring TICKLORE_CONTRACT_V5, keeping the
 * one-module-per-version pattern every other layer relies on.
 *
 * New capability unlocked (used by custody→Privy migration when it lands):
 * transferTicket(contract, tokenId, to) — deliver a custodial keepsake to its
 * holder's own wallet.
 */

const { ethers } = require("ethers");
const { getSigner } = require("./ticklore");
const v4 = require("./ticklore-v4");

async function connect({ password } = {}) {
  const rpcUrl = process.env.RPC_URL;
  const address =
    process.env.TICKLORE_CONTRACT_V5 ||
    process.env.TICKLORE_CONTRACT_V4 ||
    process.env.TICKLORE_CONTRACT_V3 ||
    process.env.TICKLORE_CONTRACT_V2 ||
    process.env.TICKLORE_CONTRACT;
  if (!rpcUrl) throw new Error("Missing RPC_URL in .env");
  if (!address) throw new Error("Missing TICKLORE_CONTRACT_V5 (or an earlier version) in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const signer = await getSigner(provider, { password });
  const contract = new ethers.Contract(address, v4.ABI, signer);
  return { provider, signer, contract, network, address };
}

/** Custody delivery: hand a custodial keepsake to its holder's own wallet.
 *  Only works when our signer (the contract owner) currently holds the token —
 *  the V5 exemption lets this through the window and soulbound. */
async function transferTicket(contract, tokenId, to) {
  if (!ethers.isAddress(to)) throw new Error(`Not a valid address: ${to}`);
  const from = await contract.ownerOf(BigInt(tokenId));
  const tx = await contract.transferFrom(from, to, BigInt(tokenId));
  const receipt = await tx.wait();
  return { tokenId: String(tokenId), from, to, txHash: tx.hash, block: receipt.blockNumber };
}

module.exports = {
  ...v4,           // ABI, palettes, buildEventArgs, createEvent, mintTicket,
  connect,         //   redeemTicket, transferOrganizer, getTicket — unchanged
  transferTicket,  // the V5-unlocked delivery
};
