/**
 * lib/ticklore.js — everything that talks to the contract.
 *
 * Shared by the CLI (mint.js) and the HTTP server (server.js) so the minting
 * logic exists in exactly one place. When this moves into a Next.js app later,
 * this file moves with it largely unchanged.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { ethers } = require("ethers");

// Only the functions we actually call. Keeping the ABI minimal makes it
// obvious at a glance what this code is and is not able to do.
const ABI = [
  "function mintTicket(address to, string eventName, uint64 eventDate, string tier, uint256 pricePaid, uint256 donationAmount, uint64 transferUnlock, bool nonTransferable) returns (uint256)",
  "function checkIn(uint256 ticketId)",
  "function nextTicketId() view returns (uint256)",
  "function tokenURI(uint256 ticketId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function tickets(uint256) view returns (string eventName, uint64 eventDate, string tier, uint256 pricePaid, uint256 donationAmount, bool used, uint64 transferUnlock, bool nonTransferable, address originalHolder)",
  "event TicketMinted(uint256 indexed ticketId, address indexed to, string eventName)",
];

const PLATFORM_MINIMUM_UNLOCK_DAYS = 30;

/** Ask for a password without echoing it to the screen. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const onData = () => {
      readline.clearLine(process.stdout, 0);
      readline.cursorTo(process.stdout, 0);
      process.stdout.write(question);
    };
    process.stdin.on("data", onData);
    rl.question(question, (value) => {
      process.stdin.removeListener("data", onData);
      rl.close();
      process.stdout.write("\n");
      resolve(value);
    });
  });
}

/**
 * Unlock the minting wallet.
 *
 * Preferred path is the encrypted Foundry keystore, unlocked with a password
 * typed at runtime — no private key is written to disk, environment, or shell
 * history. The raw-key path exists for local test chains, where every key is
 * public knowledge anyway.
 */
async function getSigner(provider, { password } = {}) {
  const keystoreName = process.env.KEYSTORE_NAME;

  if (keystoreName) {
    const file = path.join(os.homedir(), ".foundry", "keystores", keystoreName);
    if (!fs.existsSync(file)) {
      throw new Error(
        `Keystore "${keystoreName}" not found at ${file}\n` +
        `   Create it with:  cast wallet import ${keystoreName} --interactive`
      );
    }
    const json = fs.readFileSync(file, "utf8");
    const pw = password ?? await promptHidden(`Password for keystore "${keystoreName}": `);
    const wallet = await ethers.Wallet.fromEncryptedJson(json, pw);
    return wallet.connect(provider);
  }

  if (process.env.MINTER_PRIVATE_KEY) {
    console.warn("⚠  Using MINTER_PRIVATE_KEY from the environment.");
    console.warn("   Acceptable for a local test chain only. Never for real funds.\n");
    return new ethers.Wallet(process.env.MINTER_PRIVATE_KEY, provider);
  }

  throw new Error("No signer configured. Set KEYSTORE_NAME (preferred) or MINTER_PRIVATE_KEY in .env");
}

/**
 * Connect to the network and unlock the wallet once.
 *
 * The server calls this at startup and reuses the result for every request.
 * Unlocking per-request would mean a password prompt per ticket sold, which
 * is obviously not workable.
 */
async function connect({ password } = {}) {
  const rpcUrl = process.env.RPC_URL;
  const address = process.env.TICKLORE_CONTRACT;
  if (!rpcUrl) throw new Error("Missing RPC_URL in .env");
  if (!address) throw new Error("Missing TICKLORE_CONTRACT in .env");

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const signer = await getSigner(provider, { password });
  const contract = new ethers.Contract(address, ABI, signer);

  return { provider, signer, contract, network, address };
}

/**
 * Turn loose input into the exact arguments the contract expects, and reject
 * anything invalid before it costs gas.
 *
 * Note what is NOT here: any attempt to strip dangerous characters out of the
 * event name. The contract escapes them properly at render time, so an event
 * really can be called  Mom & Dad's "50th"  and come out intact.
 */
function buildTicketArgs(input) {
  const { to, eventName, tier = "General" } = input;

  if (!to) throw new Error("Missing recipient address");
  if (!ethers.isAddress(to)) throw new Error(`Not a valid address: ${to}`);
  if (!eventName || !eventName.trim()) throw new Error("Missing event name");

  // Money is whole cents, matching the contract. Integers only — floats and
  // currency are a bad combination.
  const price = BigInt(input.price ?? 0);
  const donation = BigInt(input.donation ?? 0);
  if (price < 0n || donation < 0n) throw new Error("Amounts cannot be negative");

  const eventDate = input.date
    ? Math.floor(new Date(input.date).getTime() / 1000)
    : Math.floor(Date.now() / 1000);
  if (Number.isNaN(eventDate)) throw new Error(`Could not read date "${input.date}"`);

  // Platform rule: a ticket never unlocks sooner than 30 days after the event.
  // Enforced here as well as in policy so a bad caller cannot undercut it.
  const requestedDays = Number(input.unlockDays ?? PLATFORM_MINIMUM_UNLOCK_DAYS);
  const unlockDays = Math.max(requestedDays, PLATFORM_MINIMUM_UNLOCK_DAYS);
  const transferUnlock = eventDate + unlockDays * 86400;

  return {
    to,
    eventName: eventName.trim(),
    eventDate,
    tier: tier.trim(),
    price,
    donation,
    transferUnlock,
    nonTransferable: input.nonTransferable === true || input.nonTransferable === "true",
  };
}

/** Mint one ticket. Returns the ticket id and transaction details. */
async function mintTicket(contract, input) {
  const a = buildTicketArgs(input);

  const tx = await contract.mintTicket(
    a.to, a.eventName, a.eventDate, a.tier,
    a.price, a.donation, a.transferUnlock, a.nonTransferable
  );
  const receipt = await tx.wait();

  // Read the id from the event rather than assuming it. Two mints landing in
  // the same block would make any guess wrong.
  let ticketId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = contract.interface.parseLog(log);
      if (parsed?.name === "TicketMinted") ticketId = parsed.args.ticketId;
    } catch { /* not one of ours */ }
  }

  // A mined transaction with no TicketMinted event means the mint did not
  // actually happen. The usual cause: the address in TICKLORE_CONTRACT has no
  // contract code on this network, so the transaction ran as a no-op — it
  // succeeds (status 1, zero logs) and reverts nothing. Fail loudly here rather
  // than hand back a null id that a caller might present as a real ticket.
  if (ticketId === null) {
    throw new Error(
      `Mint transaction ${tx.hash} was mined in block ${receipt.blockNumber} but ` +
      `emitted no TicketMinted event. The contract at ${await contract.getAddress()} ` +
      `is not responding as a TickloreTicket on this network — check TICKLORE_CONTRACT ` +
      `and RPC_URL (GET /health confirms whether nextTicketId() decodes).`
    );
  }

  return {
    ticketId: ticketId?.toString() ?? null,
    txHash: tx.hash,
    block: receipt.blockNumber,
    gasUsed: receipt.gasUsed.toString(),
    args: { ...a, price: a.price.toString(), donation: a.donation.toString() },
  };
}

/**
 * Read a ticket's metadata back out of the contract and decode it.
 *
 * Worth understanding what this proves: the JSON and the image are generated
 * by the contract on demand. Nothing is stored on a server of ours. If this
 * company disappeared tomorrow, this call would still work.
 */
async function getTicket(contract, ticketId) {
  const uri = await contract.tokenURI(ticketId);
  const json = JSON.parse(Buffer.from(uri.split(",")[1], "base64").toString());
  const svg = json.image?.startsWith("data:image/svg+xml;base64,")
    ? Buffer.from(json.image.split(",")[1], "base64").toString()
    : null;
  return { metadata: json, svg };
}

module.exports = {
  ABI,
  PLATFORM_MINIMUM_UNLOCK_DAYS,
  connect,
  getSigner,
  buildTicketArgs,
  mintTicket,
  getTicket,
  promptHidden,
};
