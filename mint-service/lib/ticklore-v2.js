/**
 * lib/ticklore-v2.js — the event-model (V2) contract interface.
 *
 * Parallel to ticklore.js on purpose: nothing imports this yet, so the live V1
 * demo is untouched while V2 is wired and tested. Reuses V1's signer/keystore
 * logic (getSigner) so key handling stays in one place.
 *
 *   V2 flow:  createEvent(...) -> eventId   (organizer, on-chain)
 *             mintTicket(eventId, to, price, buyerName, inscription) -> tokenId
 *
 * Point it at the V2 contract with TICKLORE_CONTRACT_V2 (falls back to
 * TICKLORE_CONTRACT).
 */

const { ethers } = require("ethers");
const { getSigner } = require("./ticklore");

// Only the functions we call. Kept minimal so it's obvious what this can do.
const ABI = [
  "function createEvent(string name, string venue, uint64 date, string sponsorLeadIn, string sponsorName, uint8 palette, bool inscriptionsAllowed, bool soulbound) returns (uint256)",
  "function updateEvent(uint256 eventId, string name, string venue, uint64 date, string sponsorLeadIn, string sponsorName, uint8 palette, bool inscriptionsAllowed, bool soulbound)",
  "function mintTicket(uint256 eventId, address to, uint256 price, string buyerName, string inscription) returns (uint256)",
  "function setAgent(uint256 eventId, address agent, bool allowed)",
  "function isEventAgent(uint256 eventId, address who) view returns (bool)",
  "function organizerOf(uint256 eventId) view returns (address)",
  "function eventIdOf(uint256 tokenId) view returns (uint256)",
  "function redeem(uint256 tokenId)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function nextEventId() view returns (uint256)",
  "function nextTokenId() view returns (uint256)",
  "event EventCreated(uint256 indexed eventId, address indexed organizer, string name)",
  "event TicketMinted(uint256 indexed tokenId, uint256 indexed eventId, address indexed to)",
];

// Organizer palette names -> the contract's uint8 index (must match _palette()).
const PALETTE_INDEX = { teal: 0, midnight: 1, burgundy: 2, forest: 3, plum: 4 };

async function connect({ password } = {}) {
  const rpcUrl = process.env.RPC_URL;
  const address = process.env.TICKLORE_CONTRACT_V2 || process.env.TICKLORE_CONTRACT;
  if (!rpcUrl) throw new Error("Missing RPC_URL in .env");
  if (!address) throw new Error("Missing TICKLORE_CONTRACT_V2 (or TICKLORE_CONTRACT) in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const signer = await getSigner(provider, { password });
  const contract = new ethers.Contract(address, ABI, signer);
  return { provider, signer, contract, network, address };
}

/** Normalize an organizer's loose event input into on-chain arguments. */
function buildEventArgs(input) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Missing event name");

  const venue = String(input.venue || "").trim().slice(0, 60);
  const sponsorLeadIn = String(input.sponsorLeadIn ?? input.sponsorLabel ?? "").trim().slice(0, 28);
  const sponsorName = String(input.sponsorName || "").trim().slice(0, 44);

  const date = input.date
    ? Math.floor(new Date(`${input.date}T12:00:00`).getTime() / 1000)
    : Math.floor(Date.now() / 1000);
  if (Number.isNaN(date)) throw new Error(`Could not read date "${input.date}"`);

  // palette may arrive as a name ("burgundy") or already an index.
  let palette = input.palette;
  if (typeof palette === "string") palette = PALETTE_INDEX[palette] ?? 0;
  palette = Number(palette) || 0;

  const inscriptionsAllowed =
    input.inscriptionsAllowed === true || input.inscriptionsAllowed === "true" ||
    input.allowInscription === true || input.allowInscription === "true";
  const soulbound = input.soulbound === true || input.soulbound === "true";

  return { name, venue, date, sponsorLeadIn, sponsorName, palette, inscriptionsAllowed, soulbound };
}

/** Create an on-chain event. The caller (the connected signer) becomes organizer. */
async function createEvent(contract, input) {
  const a = buildEventArgs(input);
  const tx = await contract.createEvent(
    a.name, a.venue, a.date, a.sponsorLeadIn, a.sponsorName, a.palette, a.inscriptionsAllowed, a.soulbound
  );
  const receipt = await tx.wait();

  let eventId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "EventCreated") eventId = parsed.args.eventId;
    } catch { /* not ours */ }
  }
  if (eventId === null) {
    throw new Error(`createEvent tx ${tx.hash} emitted no EventCreated — is ${await contract.getAddress()} a V2 contract?`);
  }
  return { eventId: eventId.toString(), txHash: tx.hash, args: { ...a, date: String(a.date) } };
}

/** Mint one ticket against an existing event. */
async function mintTicket(contract, input) {
  const eventId = BigInt(input.eventId);
  const to = input.to;
  if (!to || !ethers.isAddress(to)) throw new Error(`Not a valid recipient: ${to}`);
  const price = BigInt(input.price ?? 0);
  const buyerName = String(input.buyerName || "").trim().slice(0, 32);
  const inscription = String(input.inscription ?? input.message ?? "").trim().slice(0, 42);

  const tx = await contract.mintTicket(eventId, to, price, buyerName, inscription);
  const receipt = await tx.wait();

  let tokenId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "TicketMinted") tokenId = parsed.args.tokenId;
    } catch { /* not ours */ }
  }
  if (tokenId === null) {
    throw new Error(`mintTicket tx ${tx.hash} emitted no TicketMinted — is ${await contract.getAddress()} a V2 contract with this event?`);
  }
  return {
    tokenId: tokenId.toString(),
    txHash: tx.hash,
    block: receipt.blockNumber,
    args: { eventId: eventId.toString(), to, price: price.toString(), buyerName, inscription },
  };
}

/** Read a ticket's metadata back out of the contract and decode it. */
async function getTicket(contract, tokenId) {
  const uri = await contract.tokenURI(tokenId);
  const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
  const svg = json.image?.startsWith("data:image/svg+xml;base64,")
    ? Buffer.from(json.image.split(",")[1], "base64").toString()
    : null;
  return { metadata: json, svg };
}

module.exports = {
  ABI,
  PALETTE_INDEX,
  connect,
  buildEventArgs,
  createEvent,
  mintTicket,
  getTicket,
};
