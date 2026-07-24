# Deploying TickloreTicket to Base Sepolia

This is the "it's alive" milestone — the first time a Ticklore ticket exists
somewhere other than a test. Base Sepolia is a **testnet**: a full working copy
of Base that runs on worthless play money. Everything behaves exactly like the
real network. Nothing costs anything. Mistakes here are free.

Work through it in order. Roughly 20 minutes the first time.

---

## Before you start

You need three things:

1. **A wallet** (MetaMask or similar) with a Base Sepolia address.
2. **Test ETH** from a faucet — free, fake, takes a minute.
3. **An RPC URL** — your connection to the network. Free from Alchemy.

---

## Step 1 — Get an RPC URL

An RPC endpoint is your phone line to the blockchain. You don't run a copy of
Base yourself; you ask someone who does.

1. Sign up at **alchemy.com** (free tier is plenty).
2. Create a new app. Chain: **Base**. Network: **Base Sepolia**.
3. Copy the HTTPS URL. It looks like
   `https://base-sepolia.g.alchemy.com/v2/AbC123...`

---

## Step 2 — Get test ETH

Deploying costs gas even on a testnet. The ETH is fake but the transaction is real.

Use a Base Sepolia faucet — Coinbase, Alchemy, and others run them. Paste your
wallet address, wait a minute, and a small amount arrives. You need very little;
a deploy costs a fraction of it.

Check it landed: your wallet should show a Base Sepolia balance above zero.

---

## Step 3 — Store your key safely

**Do not put your private key in a file. Do not paste it into a chat. Do not
put it in `.env`.**

Foundry can hold your key in an encrypted keystore protected by a password.
The key is stored scrambled on disk; nothing can use it without the password,
and it never appears in plain text anywhere.

```bash
cast wallet import tickloreDeployer --interactive
```

It will ask for your private key, then a password to encrypt it. From then on
you refer to the wallet by name — `tickloreDeployer` — and type the password
when you deploy.

> **Where does the private key come from?** MetaMask → account menu → Account
> details → Show private key. Do this once, paste it into the prompt above, and
> then never handle it again.
>
> Use a **fresh wallet** for this, not one holding real money. A testnet
> deployer wallet should have nothing in it but play money.

---

## Step 4 — Fill in your settings

```bash
cd contracts
cp .env.example .env
```

Open `.env` and paste in your Alchemy URL. Leave `TICKLORE_OWNER` blank for now —
it defaults to your own wallet, which is what you want on testnet.

`.env` is gitignored. It will not be committed.

---

## Step 5 — Deploy

```bash
cd contracts
source .env

forge script script/Deploy.s.sol:Deploy \
  --rpc-url $BASE_SEPOLIA_RPC \
  --account tickloreDeployer \
  --sender YOUR_WALLET_ADDRESS \
  --broadcast
```

Enter your keystore password when prompted.

When it finishes, it prints your contract address:

```
=======================================================
 TickloreTicket deployed
=======================================================
 Address    : 0x....
 Owner      : 0x....
 Collection : Ticklore Ticket
 Symbol     : TCKL
```

**Save that address.** Put it in `.env` as `TICKLORE_CONTRACT`. Everything
downstream points at it — the explorer link for your pitch, the backend that
mints after a Stripe payment, the door-scanning app.

---

## Step 6 — Verify the source code (recommended)

Verification publishes your Solidity source to the block explorer so anyone can
read what the contract actually does. For an investor conversation this is the
difference between "trust me" and "read it yourself."

Get a free API key at basescan.org, add it to `.env`, then:

```bash
forge verify-contract \
  --chain base-sepolia \
  --etherscan-api-key $BASESCAN_API_KEY \
  --constructor-args $(cast abi-encode "constructor(address)" YOUR_OWNER_ADDRESS) \
  YOUR_CONTRACT_ADDRESS \
  src/TickloreTicket.sol:TickloreTicket
```

---

## Step 7 — Mint the first ticket

This is the part worth doing slowly.

```bash
source .env

forge script script/MintDemo.s.sol:MintDemo \
  --rpc-url $BASE_SEPOLIA_RPC \
  --account tickloreDeployer \
  --sender YOUR_WALLET_ADDRESS \
  --broadcast
```

Then open:

```
https://sepolia.basescan.org/token/YOUR_CONTRACT_ADDRESS
```

You should see **Ticklore Ticket (TCKL)**, one item, and the ticket drawing
itself — teal card, gold border, event name, price, ticket number. That image
is not hosted anywhere. No server of ours is involved. The contract generates
it from scratch every time someone asks.

That is the whole thesis, working.

---

## Troubleshooting

**"insufficient funds for gas"** — the faucet hasn't landed yet, or you're
pointed at the wrong network. Check your wallet shows a Base Sepolia balance.

**"nonce too low"** — a previous transaction is still pending. Wait a minute
and retry.

**Verification fails** — deployment still succeeded; the contract is live.
Verification is cosmetic and can be redone at any time.

**Wrong owner** — if you deployed with the wrong owner address, just deploy
again. Testnet deployments are free and disposable. There is no cleanup needed.

---

## What this does and doesn't prove

**Proves:** the contract compiles, deploys, mints, records data correctly, and
renders its own artwork on a real network. Phase 1 of the roadmap, complete.

**Does not prove:** that it's safe to handle real money. Before a live event
with real payments, the plan calls for a third-party security audit, an
emergency pause switch, and separate staff roles so door staff can scan tickets
without holding the master key. Those are deliberate later steps, not oversights.
