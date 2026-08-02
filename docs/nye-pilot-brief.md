# Ticklore — Code Brief: NYE Gala Pilot (claim-code ticketing)

**Context:** first live Ticklore pilot. New Year's Eve gala, **firm capacity 150**, **general admission**
(no seating/tables). Tickets sell **~3 months** (opening November). Two channels sell from the SAME
150-cap pool:
1. **Online** — buyer pays by card, keepsake mints directly.
2. **Cash/in-person** — ~5–6 volunteer sellers carry **pre-printed claim-code stubs**. Buyer pays cash,
   takes the stub, later **scans the QR and enters their own email** to claim their keepsake.

The claim-code flow already exists (admin can pre-generate codes and email/print batches; buyer scans
→ enters email → keepsake mints). This brief covers the gaps found while planning the pilot.

---

## 1. Claim codes must be RANDOM, not sequential (security — check this first)
The printed code is a **bearer instrument**: whoever scans it first gets the ticket.
- **Verify the underlying claim code is random/unguessable** (e.g. a high-entropy token). If codes are
  sequential or predictable, someone could guess an unclaimed code and steal a ticket. If they're
  currently predictable, **fix before the pilot.**
- Re-scanning an already-claimed code must show a **clear "already claimed"** state (with when/So the
  door can adjudicate a dispute), not a generic error and not a second mint.

## 2. Printable label ≠ claim code (new field)
Add a **human-readable label** stored alongside each code, printed next to the QR on the stub:
- Format: **COLOR + NUMBER**, e.g. `BLUE 07`, `RED 22`.
- **Each color restarts at 1** (Blue 1–30, Red 1–30, Green 1–30, Yellow 1–30, White 1–30) — NOT
  continuous 1–29 / 30–59. Self-describing, no arithmetic, and a 6th color can be added later without
  renumbering.
- Pilot batching: **5 colors × 30 = 150** (5 chosen because stock already exists and divides evenly).
- Admin needs to **set the color/label and number range when generating a batch**, and see the label
  in every admin view. Label is for humans (inventory, reconciliation, tracing a disputed stub); the
  random code is for the machine.

## 3. Ticket lifecycle states (the important change)
Currently a code is effectively only **unclaimed → claimed (on scan)**. That's not enough: **cash is
collected at sale, but the scan may happen weeks later or never** — so a sold-but-unclaimed stub looks
identical to a never-sold one, and the "how many left?" number goes wrong against a firm 150.

Add a middle state:

| State | Meaning | Who sets it |
|---|---|---|
| **Generated** | code exists, printed, not distributed | admin |
| **Issued** | handed to a named seller (in a color block) | admin/gatekeeper |
| **Sold** | seller reports cash collected (buyer hasn't scanned yet) | seller or gatekeeper |
| **Claimed** | buyer scanned + entered email → keepsake minted | buyer (automatic) |

- **"Sold" does NOT need to be real-time** — weekly seller check-ins are fine. It just has to be
  recordable so remaining-capacity math is trustworthy.
- Track **which seller holds which block** so a disputed stub is traceable.

## 4. Admin capacity view (the number the committee will ask for daily)
One screen showing, against the **150 cap**:
- Sold online (minted)
- Claimed via code
- **Sold-but-unclaimed** (outstanding stubs in the wild)
- Issued-but-unsold (with sellers)
- Unissued / buffer remaining
- **True remaining = 150 − (online + claimed + sold-unclaimed)**

⚠️ **Enforce the 150 cap ACROSS BOTH CHANNELS.** Online must not be able to sell into capacity that
outstanding stubs already represent.

## 5. Manual claim-on-behalf (door override)
Some cash buyers will arrive on Dec 31 holding a stub they never scanned. Add an **admin/door action**:
look up a code (by label or scan) → enter the buyer's email → mint the keepsake on the spot. Needed
rarely, but definitely needed — and these are exactly the people who should leave holding a real
keepsake for pilot photos/proof.

## 6. Buffer / reserve
Print 150 but **distribute only ~140**; hold ~10 back (comps, venue, late sponsor asks, surprises).
Admin should be able to mark a block as **reserve** so it isn't counted as sellable inventory but still
exists to release later. Firm capacity with zero slack is where plans break.

## 7. Nice-to-have (only if cheap)
- **Mid-campaign reallocation:** pull unsold stubs back from a slow seller and re-issue to another (or
  release online) — planned checkpoint ~Dec 15. Just needs re-assigning a block's holder.
- **Door fallback list:** printable list of claimed tickets + names for the "I bought one but never got
  the email" case.

---

### Not in scope for this pilot
No seating/tables (GA only). No sponsor attribution needed unless the gala adds sponsors later. No
Stripe Connect — pilot runs LLC-as-merchant, single party.

### Success criteria
- Impossible to oversell 150 across both channels.
- No two people can ever be sold the same code.
- At any moment, admin can state true remaining capacity with confidence.
- **Every attendee — cash or online — ends up holding a real minted keepsake**, not just paper.

---
---

# PART 2 — Door Check-In / Redeem (not built yet)

**Status:** the V2 contract already has a `redeemed` flag and check-in logic (flag, never a burn — the
keepsake survives being used). What does **not** exist is the door side: a scanner a volunteer can use,
and a redeem action distinct from claim.

## 1. Redeem ≠ Claim (keep these strictly separate)
Two different operations that must never be confused:

| | **Claim** (exists) | **Redeem** (to build) |
|---|---|---|
| When | Any time after cash sale | At the door, night of |
| Input | Unclaimed **stub** code | The buyer's **minted keepsake** |
| Action | Buyer enters email → mints | Validate → mark `redeemed` |
| Who | Buyer, self-serve | Door staff |

⚠️ **The door must scan the minted keepsake, NOT the paper stub.** A paper stub can be photographed and
forwarded to five people. If the door scanner accepts stub codes, all five get in. The stub's job ends
at claim; after that the keepsake is the credential.

⚠️ The QR visually "fading" after claim is a **display state, not enforcement** — it does not stop a
screenshot. Enforcement is the `redeemed` flag, server-side.

## 2. Door scan endpoint
Scan → look up ticket → return exactly one of three results:
- **VALID** — correct event, not yet redeemed → mark `redeemed`, return holder name + ticket label.
- **ALREADY USED** — return **timestamp + holder name** so staff can adjudicate a dispute on the spot.
- **NOT FOUND / WRONG EVENT** — code isn't a ticket, or belongs to another event.

Redeem must be **idempotent-safe**: a double-tap or double-scan must not produce a confusing second
state; it should just report ALREADY USED with the original timestamp.

## 3. Door view (phone web page — no app install)
- Opens in a phone browser; camera scan.
- **Huge colour-coded result** readable at arm's length in a dark room: green VALID / red ALREADY USED
  or NOT FOUND. Volunteers, at a party, at night.
- Show holder name + label (e.g. `YELLOW 12`) on success so staff can greet by name.
- Running count on screen: **checked in / total**.

## 4. Staff access — NOT the master key
Door volunteers must not hold the wallet that can mint. For the pilot, a **door-only login or a
per-event scan link** with redeem-only permission is sufficient. (This is the "separate staff roles"
item already flagged in the plan — pilot-grade version.)

## 5. Manual lookup fallback (will 100% be needed)
Search by **name** or **label** ("Yellow 12") and redeem manually — for the dead phone, the deleted
email, the guest who never scanned their stub. Pair with the **claim-on-behalf** action from Part 1 so
door staff can mint + redeem in one motion for someone holding only paper.

## 6. Offline tolerance (pilot-critical)
Venue wifi on New Year's Eve will be saturated. If every scan needs a live round-trip, there will be a
line at the door.
- Minimum: pre-download the valid-ticket list to the device before doors open; validate locally; queue
  redemptions and sync when connectivity returns.
- If that's too much for the pilot, at least make failures **fast and obvious** rather than hanging,
  and keep the manual list as the backstop.

## 7. Strictness — a judgement call for pilot #1
A 150-person community gala is **low fraud risk** — these are neighbours, not scalpers. Recommend the
scanner **flags duplicates but lets a human decide**, rather than hard-blocking a guest at a party.
Record everything; let staff override. Tighten later for third-party events.

### Success criteria (door)
- Every attendee scans in under ~3 seconds, in the dark, on volunteer-operated phones.
- A duplicate is caught and shown with enough info (name + time) to resolve it politely.
- Nobody is turned away because their phone died — manual lookup always works.
- Door staff never touch a key that can mint arbitrarily.
