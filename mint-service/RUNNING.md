# Running the mint service

## The webhook secret — the thing that caused yesterday's grief

Per Stripe's docs, the CLI signing secret **does not change between restarts** of
`stripe listen` on the same machine + account. So the `400`s were NOT the secret
rotating — they were a mismatch introduced by hand: a stray character on paste,
a duplicated `STRIPE_WEBHOOK_SECRET` line, or the server reading `.env` before
the value was saved.

The fix is to set the secret ONCE, mechanically, and never hand-type it.

### One-time setup — set the secret without ever copy/pasting it

```bash
cd ~/ticklore-site/mint-service
SECRET=$(stripe listen --print-secret)      # prints the stable secret, no listener
sed -i '/^STRIPE_WEBHOOK_SECRET/d' .env      # remove any old/duplicate lines
echo "STRIPE_WEBHOOK_SECRET=$SECRET" >> .env
grep -c STRIPE_WEBHOOK_SECRET .env           # MUST print exactly 1
```

`--print-secret` prints the secret and exits. Capturing it into a variable and
writing it with a script means no stray characters, ever.

### Every session after that

```bash
# Terminal 1 — listener (leave running)
cd ~/ticklore-site/mint-service
stripe listen --forward-to localhost:3000/webhook

# Terminal 2 — server (leave running)
cd ~/ticklore-site/mint-service
node server.js
```

Order does not matter, because the secret is already correct in `.env` and is
stable. Restarting the listener does not break it.

### If you ever see 400 again

1. `grep -c STRIPE_WEBHOOK_SECRET .env` — if it prints 2+, that is the bug.
   Re-run the one-time setup above to collapse it to one line.
2. Restart the server (it reads `.env` only at startup).

## 2. Put that secret in `.env`

```bash
cd ~/ticklore-site/mint-service
sed -i '/^STRIPE_WEBHOOK_SECRET/d' .env
echo "STRIPE_WEBHOOK_SECRET=whsec_the_one_just_printed" >> .env
cut -c1-30 .env          # check names without exposing values
```

Expect exactly one line each for `STRIPE_SECRET_KEY=sk_test_`,
`STRIPE_WEBHOOK_SECRET=whsec_`, and `PUBLIC_URL=`.

## 3. Start the server LAST

```bash
cd ~/ticklore-site/mint-service
node server.js
```

Enter the keystore password. The server reads `.env` once at startup, which is
why it must come after step 2.

## 4. Buy a ticket

```bash
curl -s -X POST localhost:3000/checkout \
  -H 'Content-Type: application/json' \
  -d '{"eventKey":"sullivan-reunion"}'
```

Open the returned `url`. Pay with `4242 4242 4242 4242`, any future expiry, any CVC.

---

## Reading the listener output

| Listener shows | Meaning |
|---|---|
| `200` | Working. |
| `400` | Signing secret mismatch. `.env` does not match the running listener. Redo steps 1–3. |
| `500` | Server error. The server terminal has the reason. |
| nothing | Listener is not forwarding, or the server is not on port 3000. |

`400` on every event is nearly always a stale `whsec_`.

## Sandbox note

The Stripe CLI may report an account name from an unrelated business if that
account owns the sandbox. The label is cosmetic. What matters is that the
listener and the server are on the same account in the same mode.

Before Ticklore takes real money it needs its own Stripe account — separate
payouts, bank, and tax reporting. Two businesses in one account is painful to
untangle later.
