#!/usr/bin/env node
/**
 * mint.js — mint one Ticklore ticket from the server side.
 *
 * WHY THIS EXISTS
 * ---------------
 * TickloreTicket.mintTicket() is owner-only. Only the wallet that owns the
 * contract can create tickets. That key can NEVER go in a browser — anything
 * shipped to a browser can be read by anyone who opens developer tools.
 *
 * So the buyer's browser never touches the blockchain. It only takes payment.
 * This script is the back office: it holds the key and does the minting.
 *
 *     browser → Stripe → [this code] → contract → email
 *
 * Everything else (Stripe checkout, email delivery, the web UI) bolts onto
 * either end of this. This is the piece in the middle that has to be ours.
 *
 * KEY HANDLING
 * ------------
 * This reads the same encrypted Foundry keystore you already created with
 * `cast wallet import`, and asks for the password at runtime. No private key
 * is ever written to a file, an environment variable, or shell history.
 *
 * For production that changes again — see NOTES at the bottom.
 *
 * USAGE
 *   node mint.js --to 0xRecipient --event "The Sullivan Family Reunion" \
 *                --tier "General" --price 2500 --date 2026-07-22
 */

require("dotenv").config();
const fs = require("fs");
const os = require("os");
const path = require("path");
const readline = require("readline");
const { ethers } = require("ethers");

// The only four functions this script needs. A full ABI would work too, but
// listing just what we call keeps it obvious what this code can and cannot do.
const ABI = [
  "function mintTicket(address to, string eventName, uint64 eventDate, string tier, uint256 pricePaid, uint256 donationAmount, uint64 transferUnlock, bool nonTransferable) returns (uint256)",
  "function nextTicketId() view returns (uint256)",
  "function tokenURI(uint256 ticketId) view returns (string)",
  "event TicketMinted(uint256 indexed ticketId, address indexed to, string eventName)",
];

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 2) {
    const key = argv[i];
    if (!key.startsWith("--")) throw new Error(`Unexpected argument: ${key}`);
    out[key.slice(2)] = argv[i + 1];
  }
  return out;
}

function requireArg(args, name, hint) {
  if (!args[name]) {
    throw new Error(`Missing --${name}${hint ? ` (${hint})` : ""}`);
  }
  return args[name];
}

/** Ask for a password without echoing it to the screen. */
function promptHidden(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    const onData = (char) => {
      if (["\n", "\r", "\u0004"].includes(char.toString())) {
        process.stdin.removeListener("data", onData);
      } else {
        // Repaint the prompt so the typed characters never appear.
        readline.clearLine(process.stdout, 0);
        readline.cursorTo(process.stdout, 0);
        process.stdout.write(question);
      }
    };
    process.stdin.on("data", onData);
    rl.question(question, (value) => {
      rl.close();
      process.stdout.write("\n");
      resolve(value);
    });
  });
}

// ---------------------------------------------------------------------------
// Signer
// ---------------------------------------------------------------------------

/**
 * Two ways to get a signer, in order of preference:
 *
 *   1. An encrypted Foundry keystore, unlocked with a password at runtime.
 *      Nothing sensitive touches the disk in plain text. This is the default.
 *
 *   2. MINTER_PRIVATE_KEY from the environment. Only for a local test chain,
 *      where the keys are public knowledge anyway.
 */
async function getSigner(provider) {
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
    const password = await promptHidden(`Password for keystore "${keystoreName}": `);
    process.stdout.write("Decrypting…\n");
    const wallet = await ethers.Wallet.fromEncryptedJson(json, password);
    return wallet.connect(provider);
  }

  if (process.env.MINTER_PRIVATE_KEY) {
    console.warn("⚠  Using MINTER_PRIVATE_KEY from the environment.");
    console.warn("   Acceptable for a local test chain only. Never for real funds.\n");
    return new ethers.Wallet(process.env.MINTER_PRIVATE_KEY, provider);
  }

  throw new Error(
    "No signer configured. Set KEYSTORE_NAME (preferred) or MINTER_PRIVATE_KEY in .env"
  );
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);

  const rpcUrl = process.env.RPC_URL;
  const contractAddress = process.env.TICKLORE_CONTRACT;
  if (!rpcUrl) throw new Error("Missing RPC_URL in .env");
  if (!contractAddress) throw new Error("Missing TICKLORE_CONTRACT in .env");

  const to = requireArg(args, "to", "recipient wallet address");
  const eventName = requireArg(args, "event", 'e.g. "The Sullivan Family Reunion"');
  const tier = args.tier || "General";

  if (!ethers.isAddress(to)) throw new Error(`Not a valid address: ${to}`);

  // Price is in whole cents, matching the contract. 2500 = $25.00.
  // Storing money as an integer avoids decimal rounding errors entirely.
  const price = BigInt(args.price ?? 0);
  const donation = BigInt(args.donation ?? 0);

  // Event date as a unix timestamp. Defaults to now if not supplied.
  const eventDate = args.date
    ? Math.floor(new Date(args.date).getTime() / 1000)
    : Math.floor(Date.now() / 1000);
  if (Number.isNaN(eventDate)) throw new Error(`Could not read --date "${args.date}"`);

  // When the ticket becomes transferable. Platform minimum is 30 days after
  // the event; the organizer may set it later but never earlier.
  const unlockDays = Number(args.unlockDays ?? 30);
  const transferUnlock = eventDate + unlockDays * 24 * 60 * 60;

  // Permanently non-transferable, for sensitive events such as a private
  // support group or a closed community gathering.
  const nonTransferable = args.nonTransferable === "true";

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();
  const signer = await getSigner(provider);
  const ticklore = new ethers.Contract(contractAddress, ABI, signer);

  console.log("");
  console.log("  Network   :", network.name === "unknown" ? `chain ${network.chainId}` : network.name, `(${network.chainId})`);
  console.log("  Contract  :", contractAddress);
  console.log("  Minter    :", await signer.getAddress());
  console.log("  Recipient :", to);
  console.log("  Event     :", eventName);
  console.log("  Tier      :", tier);
  console.log("  Price     :", price === 0n ? "Free" : `$${(Number(price) / 100).toFixed(2)}`);
  console.log("  Unlocks   :", new Date(transferUnlock * 1000).toISOString().slice(0, 10),
              nonTransferable ? "(overridden — permanently non-transferable)" : "");
  console.log("");

  const balance = await provider.getBalance(await signer.getAddress());
  if (balance === 0n) {
    throw new Error("Minter wallet has no ETH — it cannot pay gas. Top it up from a faucet.");
  }

  process.stdout.write("Minting… ");
  const tx = await ticklore.mintTicket(
    to, eventName, eventDate, tier, price, donation, transferUnlock, nonTransferable
  );
  console.log("sent.");
  console.log("  tx hash   :", tx.hash);

  const receipt = await tx.wait();

  // Read the ticket id out of the event rather than guessing it. Two mints
  // racing each other would make any assumption about the id wrong.
  let ticketId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = ticklore.interface.parseLog(log);
      if (parsed?.name === "TicketMinted") ticketId = parsed.args.ticketId;
    } catch { /* not one of ours */ }
  }

  console.log("  block     :", receipt.blockNumber);
  console.log("  gas used  :", receipt.gasUsed.toString());
  console.log("");
  console.log(`✓ Ticket #${ticketId} minted to ${to}`);

  if (network.chainId === 84532n) {
    console.log("");
    console.log(`  https://sepolia.basescan.org/nft/${contractAddress}/${ticketId}`);
  }

  return ticketId;
}

main().catch((err) => {
  console.error("\n✗ " + err.message);
  process.exit(1);
});

/* ---------------------------------------------------------------------------
 * NOTES — what changes before real money
 * ---------------------------------------------------------------------------
 *
 * 1. A password prompt does not survive a webhook. Once Stripe is calling this
 *    automatically, nobody is standing there to type it. At that point the key
 *    moves into a managed signer — AWS KMS, Google Cloud KMS, or a service like
 *    Privy's server wallets — where the server can request a signature without
 *    ever holding the key itself.
 *
 * 2. The minting wallet should not be the contract owner. Add AccessControl to
 *    the contract with a separate MINTER_ROLE, so a compromised server key can
 *    be revoked without losing ownership of the contract. Already on the
 *    punch list in BUILD-LOG.md.
 *
 * 3. Idempotency. Stripe retries webhooks. Without a guard, one payment can
 *    mint two tickets. Record the Stripe payment id alongside the ticket and
 *    refuse to mint twice for the same id.
 * ------------------------------------------------------------------------- */
