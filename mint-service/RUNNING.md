# Running the mint service

Three terminals. **Order matters.**

## 1. Start the Stripe listener FIRST

```bash
cd ~/ticklore-site/mint-service
stripe listen --forward-to localhost:3000/webhook
```

It prints:

```
> Ready! Your webhook signing secret is whsec_XXXXXXXX
```

**This secret is regenerated every single time the listener starts.** It is not
stable. If you restart the listener, the old one in `.env` is dead and every
webhook will come back `400`. Leave this terminal running.

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
