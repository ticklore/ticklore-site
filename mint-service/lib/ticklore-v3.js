/**
 * lib/ticklore-v3.js — the multi-sponsor (V3) contract interface.
 *
 * Parallel to ticklore-v2.js, for the same reason ticklore-v2 was parallel to
 * ticklore: nothing runs against V3 until TICKLORE_CONTRACT_V3 is set, so the
 * live V2 demo is untouched while V3 is wired and tested. Reuses V1's
 * signer/keystore logic (getSigner) so key handling stays in one place.
 *
 *   V3 flow:  createEvent(name, venue, date, sponsors[], palette, inscr, soulbound) -> eventId
 *             mintTicket(eventId, to, price, buyerName, inscription, sponsorRef)     -> tokenId
 *
 * What changed from V2: an event now carries a LIST of sponsors, and each ticket
 * REFERENCES one of them by a 1-based sponsorRef (0 = no sponsor). That is the
 * shape the two product lanes need — Lane A passes no sponsors and ref 0; Lane B
 * lists its sponsors and each ticket points at the one it carries.
 *
 * Point it at the V3 contract with TICKLORE_CONTRACT_V3 (falls back to
 * TICKLORE_CONTRACT_V2, then TICKLORE_CONTRACT).
 */

const { ethers } = require("ethers");
const { getSigner } = require("./ticklore");

// Only the functions we call. Sponsors ride as a tuple[] — (leadIn, name).
const ABI = [
  "function createEvent(string name, string venue, uint64 date, (string leadIn, string name)[] sponsors, uint8 palette, bool inscriptionsAllowed, bool soulbound) returns (uint256)",
  "function updateEvent(uint256 eventId, string name, string venue, uint64 date, (string leadIn, string name)[] sponsors, uint8 palette, bool inscriptionsAllowed, bool soulbound)",
  "function mintTicket(uint256 eventId, address to, uint256 price, string buyerName, string inscription, uint256 sponsorRef) returns (uint256)",
  "function setAgent(uint256 eventId, address agent, bool allowed)",
  "function isEventAgent(uint256 eventId, address who) view returns (bool)",
  "function organizerOf(uint256 eventId) view returns (address)",
  "function eventIdOf(uint256 tokenId) view returns (uint256)",
  "function eventSponsors(uint256 eventId) view returns ((string leadIn, string name)[])",
  "function sponsorCount(uint256 eventId) view returns (uint256)",
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

// Matches the contract's MAX_SPONSORS.
const MAX_SPONSORS = 128;

async function connect({ password } = {}) {
  const rpcUrl = process.env.TICKLORE_RPC_V3 || process.env.RPC_URL;
  const address =
    process.env.TICKLORE_CONTRACT_V3 ||
    process.env.TICKLORE_CONTRACT_V2 ||
    process.env.TICKLORE_CONTRACT;
  if (!rpcUrl) throw new Error("Missing RPC_URL in .env");
  if (!address) throw new Error("Missing TICKLORE_CONTRACT_V3 (or _V2 / TICKLORE_CONTRACT) in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const signer = await getSigner(provider, { password });
  const contract = new ethers.Contract(address, ABI, signer);
  return { provider, signer, contract, network, address };
}

/** Normalize loose sponsor input into [{leadIn, name}] — drops empties, caps
 *  length + lengths, and accepts either the V3 field names or the old
 *  sponsorLabel/sponsorName single pair (so a pre-editor form still works). */
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
    .filter((s) => s.name.length > 0) // a sponsor with no name is meaningless
    .slice(0, MAX_SPONSORS);
}

/** Normalize an organizer's loose event input into on-chain arguments. */
function buildEventArgs(input) {
  const name = String(input.name || "").trim();
  if (!name) throw new Error("Missing event name");

  const venue = String(input.venue || "").trim().slice(0, 60);
  const sponsors = normalizeSponsors(input);

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

  return { name, venue, date, sponsors, palette, inscriptionsAllowed, soulbound };
}

/** tuple[] the contract expects, positional to avoid any name-matching ambiguity. */
function sponsorTuples(sponsors) {
  return sponsors.map((s) => [s.leadIn, s.name]);
}

/** Create an on-chain event. The caller (the connected signer) becomes organizer. */
async function createEvent(contract, input) {
  const a = buildEventArgs(input);
  const tx = await contract.createEvent(
    a.name, a.venue, a.date, sponsorTuples(a.sponsors), a.palette, a.inscriptionsAllowed, a.soulbound
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
    throw new Error(`createEvent tx ${tx.hash} emitted no EventCreated — is ${await contract.getAddress()} a V3 contract?`);
  }
  return {
    eventId: eventId.toString(),
    txHash: tx.hash,
    args: { ...a, date: String(a.date) },
    sponsorCount: a.sponsors.length,
  };
}

/** Mint one ticket against an existing event, carrying its assigned sponsor. */
async function mintTicket(contract, input) {
  const eventId = BigInt(input.eventId);
  const to = input.to;
  if (!to || !ethers.isAddress(to)) throw new Error(`Not a valid recipient: ${to}`);
  const price = BigInt(input.price ?? 0);
  const buyerName = String(input.buyerName || "").trim().slice(0, 32);
  const inscription = String(input.inscription ?? input.message ?? "").trim().slice(0, 42);
  const sponsorRef = BigInt(input.sponsorRef ?? 0);

  // On a public RPC the createEvent may not have propagated to the node that
  // estimates gas for this mint yet — which reverts as "no such event". The
  // failure is at estimate time (no tx broadcast), so retrying with backoff is
  // safe: there is no half-sent transaction to duplicate.
  let tx;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try {
      tx = await contract.mintTicket(eventId, to, price, buyerName, inscription, sponsorRef);
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
    throw new Error(`mintTicket tx ${tx.hash} emitted no TicketMinted — is ${await contract.getAddress()} a V3 contract with this event?`);
  }
  return {
    tokenId: tokenId.toString(),
    txHash: tx.hash,
    block: receipt.blockNumber,
    args: { eventId: eventId.toString(), to, price: price.toString(), buyerName, inscription, sponsorRef: sponsorRef.toString() },
  };
}

/** Redeem a ticket at the door — flips the contract's redeem flag (never a
 *  burn), which bakes the ADMITTED stamp into the on-chain art. Caller must be
 *  the event's organizer/agent (our minter is, for concierge events). */
async function redeemTicket(contract, tokenId) {
  // Same RPC-lag guard as elsewhere: a just-minted token may not be visible to
  // the estimating node yet. Failure is pre-send, so retrying is safe.
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
  connect,
  normalizeSponsors,
  buildEventArgs,
  sponsorTuples,
  createEvent,
  mintTicket,
  redeemTicket,
  getTicket,
};
