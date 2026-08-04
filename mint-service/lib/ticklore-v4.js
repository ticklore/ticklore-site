/**
 * lib/ticklore-v4.js — the final-design-pass (V4) contract interface.
 *
 * Parallel to ticklore-v3.js, same reason as every version before it: nothing
 * runs against V4 until TICKLORE_CONTRACT_V4 is set, so the live demo is
 * untouched while V4 is wired and tested. Reuses V1's signer logic (getSigner)
 * so key handling stays in one place.
 *
 *   V4 flow:  createEvent(name, venue, date, sponsors[], sections[], palette,
 *                         inscriptionsAllowed, soulbound, showPrice) -> eventId
 *             mintTicket(eventId, to, price, buyerName, inscription,
 *                        sponsorRef, sectionRef) -> tokenId
 *
 * What changed from V3: per-event showPrice (OFF renders no price at all),
 * named SECTIONS the ticket references ("Table 7" as memory), and
 * transferOrganizer (organizer primary / contract owner recovery fallback).
 *
 * Point it at the V4 contract with TICKLORE_CONTRACT_V4 (falls back down the
 * version chain).
 */

const { ethers } = require("ethers");
const { getSigner } = require("./ticklore");

// Only the functions we call. Sponsors ride as a tuple[] — (leadIn, name).
const ABI = [
  "function createEvent(string name, string venue, uint64 date, (string leadIn, string name)[] sponsors, string[] sections, uint8 palette, bool inscriptionsAllowed, bool soulbound, bool showPrice) returns (uint256)",
  "function updateEvent(uint256 eventId, string name, string venue, uint64 date, (string leadIn, string name)[] sponsors, string[] sections, uint8 palette, bool inscriptionsAllowed, bool soulbound, bool showPrice)",
  "function mintTicket(uint256 eventId, address to, uint256 price, string buyerName, string inscription, uint256 sponsorRef, uint256 sectionRef) returns (uint256)",
  "function transferOrganizer(uint256 eventId, address newOrganizer)",
  "function setAgent(uint256 eventId, address agent, bool allowed)",
  "function isEventAgent(uint256 eventId, address who) view returns (bool)",
  "function organizerOf(uint256 eventId) view returns (address)",
  "function eventIdOf(uint256 tokenId) view returns (uint256)",
  "function eventSponsors(uint256 eventId) view returns ((string leadIn, string name)[])",
  "function sponsorCount(uint256 eventId) view returns (uint256)",
  "function eventSections(uint256 eventId) view returns (string[])",
  "function sectionCount(uint256 eventId) view returns (uint256)",
  "function redeem(uint256 tokenId)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function nextEventId() view returns (uint256)",
  "function nextTokenId() view returns (uint256)",
  "event EventCreated(uint256 indexed eventId, address indexed organizer, string name)",
  "event TicketMinted(uint256 indexed tokenId, uint256 indexed eventId, address indexed to)",
  "event OrganizerTransferred(uint256 indexed eventId, address indexed from, address indexed to, address by)",
];

// Organizer palette names -> the contract's uint8 index (must match _palette()).
const PALETTE_INDEX = { teal: 0, midnight: 1, burgundy: 2, forest: 3, plum: 4 };

// Match the contract's ceilings.
const MAX_SPONSORS = 128;
const MAX_SECTIONS = 128;

async function connect({ password } = {}) {
  const rpcUrl = process.env.TICKLORE_RPC_V4 || process.env.RPC_URL;
  const address =
    process.env.TICKLORE_CONTRACT_V4 ||
    process.env.TICKLORE_CONTRACT_V3 ||
    process.env.TICKLORE_CONTRACT_V2 ||
    process.env.TICKLORE_CONTRACT;
  if (!rpcUrl) throw new Error("Missing RPC_URL in .env");
  if (!address) throw new Error("Missing TICKLORE_CONTRACT_V4 (or an earlier version) in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const signer = await getSigner(provider, { password });
  const contract = new ethers.Contract(address, ABI, signer);
  return { provider, signer, contract, network, address };
}

/** Normalize loose sponsor input into [{leadIn, name}] — drops empties, caps
 *  length + lengths; accepts the old single sponsorLabel/sponsorName pair too. */
function normalizeSponsors(input) {
  let list = input.sponsors;
  if (!Array.isArray(list)) {
    const leadIn = String(input.sponsorLeadIn ?? input.sponsorLabel ?? "").trim();
    const name = String(input.sponsorName ?? "").trim();
    list = name ? [{ leadIn, name }] : [];
  }
  return list
    .map((s) => ({
      leadIn: String(s.leadIn ?? s.sponsorLabel ?? "").trim().slice(0, 28),
      name: String(s.name ?? s.sponsorName ?? "").trim().slice(0, 44),
    }))
    .filter((s) => s.name.length > 0)
    .slice(0, MAX_SPONSORS);
}

/** Normalize loose section input into a clean string list. */
function normalizeSections(input) {
  const list = Array.isArray(input.sections) ? input.sections : [];
  return list
    .map((s) => String(s ?? "").trim().slice(0, 32))
    .filter((s) => s.length > 0)
    .slice(0, MAX_SECTIONS);
}

/** Normalize an organizer's loose event input into on-chain arguments. */
function buildEventArgs(input) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Missing event name");

  const venue = String(input.venue || "").trim().slice(0, 60);
  const sponsors = normalizeSponsors(input);
  const sections = normalizeSections(input);

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
  // Price display defaults ON — hiding it is the deliberate choice.
  const showPrice = !(input.showPrice === false || input.showPrice === "false");

  return { name, venue, date, sponsors, sections, palette, inscriptionsAllowed, soulbound, showPrice };
}

/** tuple[] the contract expects, positional to avoid name-matching ambiguity. */
function sponsorTuples(sponsors) {
  return sponsors.map((s) => [s.leadIn, s.name]);
}

/** Create an on-chain event. The caller (the connected signer) becomes organizer. */
async function createEvent(contract, input) {
  const a = buildEventArgs(input);
  const tx = await contract.createEvent(
    a.name, a.venue, a.date, sponsorTuples(a.sponsors), a.sections,
    a.palette, a.inscriptionsAllowed, a.soulbound, a.showPrice
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
    throw new Error(`createEvent tx ${tx.hash} emitted no EventCreated — is ${await contract.getAddress()} a V4 contract?`);
  }
  return {
    eventId: eventId.toString(),
    txHash: tx.hash,
    args: { ...a, date: String(a.date) },
    sponsorCount: a.sponsors.length,
    sectionCount: a.sections.length,
  };
}

/** Mint one ticket, carrying its assigned sponsor and section. */
async function mintTicket(contract, input) {
  const eventId = BigInt(input.eventId);
  const to = input.to;
  if (!to || !ethers.isAddress(to)) throw new Error(`Not a valid recipient: ${to}`);
  const price = BigInt(input.price ?? 0);
  const buyerName = String(input.buyerName || "").trim().slice(0, 32);
  const inscription = String(input.inscription ?? input.message ?? "").trim().slice(0, 42);
  const sponsorRef = BigInt(input.sponsorRef ?? 0);
  const sectionRef = BigInt(input.sectionRef ?? 0);

  // On a public RPC the createEvent may not have propagated to the node that
  // estimates gas for this mint yet — which reverts as "no such event". The
  // failure is at estimate time (no tx broadcast), so retrying with backoff is
  // safe: there is no half-sent transaction to duplicate.
  let tx;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      tx = await contract.mintTicket(eventId, to, price, buyerName, inscription, sponsorRef, sectionRef);
      break;
    } catch (err) {
      const msg = String(err?.shortMessage || err?.reason || err?.message || "");
      if (/no such event/i.test(msg) && attempt < 6) {
        await new Promise((r) => setTimeout(r, 1200 * attempt));
        continue;
      }
      throw err;
    }
  }
  const receipt = await tx.wait();

  let tokenId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "TicketMinted") tokenId = parsed.args.tokenId;
    } catch { /* not ours */ }
  }
  if (tokenId === null) {
    throw new Error(`mintTicket tx ${tx.hash} emitted no TicketMinted — is ${await contract.getAddress()} a V4 contract with this event?`);
  }
  return {
    tokenId: tokenId.toString(),
    txHash: tx.hash,
    block: receipt.blockNumber,
    args: {
      eventId: eventId.toString(), to, price: price.toString(),
      buyerName, inscription, sponsorRef: sponsorRef.toString(), sectionRef: sectionRef.toString(),
    },
  };
}

/** Redeem a ticket at the door — flips the contract's redeem flag (never a
 *  burn); the keepsake gains its ADMITTED stamp on-chain. */
async function redeemTicket(contract, tokenId) {
  let tx;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try {
      tx = await contract.redeem(BigInt(tokenId));
      break;
    } catch (err) {
      const msg = String(err?.shortMessage || err?.reason || err?.message || "");
      if (/no such ticket/i.test(msg) && attempt < 5) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      throw err;
    }
  }
  const receipt = await tx.wait();
  return { tokenId: String(tokenId), txHash: tx.hash, block: receipt.blockNumber };
}

/** Hand an event's authority to a new address (organizer primary; the contract
 *  owner — our signer — is the recovery fallback the ADR promises). */
async function transferOrganizer(contract, eventId, newOrganizer) {
  if (!ethers.isAddress(newOrganizer)) throw new Error(`Not a valid address: ${newOrganizer}`);
  const tx = await contract.transferOrganizer(BigInt(eventId), newOrganizer);
  const receipt = await tx.wait();
  return { eventId: String(eventId), newOrganizer, txHash: tx.hash, block: receipt.blockNumber };
}

/** Read a ticket's metadata back out of the contract and decode it. */
async function getTicket(contract, tokenId) {
  // A just-minted token may not be visible on the reading node yet (RPC lag),
  // which reverts as "no such ticket". Retry the read a few times.
  let uri;
  for (let attempt = 1; attempt <= 5; attempt++) {
    try { uri = await contract.tokenURI(tokenId); break; }
    catch (err) {
      const msg = String(err?.shortMessage || err?.reason || err?.message || "");
      if (/no such ticket/i.test(msg) && attempt < 5) {
        await new Promise((r) => setTimeout(r, 1000 * attempt));
        continue;
      }
      throw err;
    }
  }
  const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
  const svg = json.image?.startsWith("data:image/svg+xml;base64,")
    ? Buffer.from(json.image.split(",")[1], "base64").toString()
    : null;
  return { metadata: json, svg };
}

module.exports = {
  ABI,
  PALETTE_INDEX,
  MAX_SPONSORS,
  MAX_SECTIONS,
  connect,
  normalizeSponsors,
  normalizeSections,
  buildEventArgs,
  sponsorTuples,
  createEvent,
  mintTicket,
  redeemTicket,
  transferOrganizer,
  getTicket,
};
