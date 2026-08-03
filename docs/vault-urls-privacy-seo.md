# Ticklore — Vault URLs, Privacy Model & SEO (Handoff to Code)
**Version 2** — supersedes v1. Key change: vault visibility is **private by default**, organizer-controlled, and split into a public shell vs. a gated interior.
(Delivered by the project room 2026-08-02; committed verbatim. Reconciliation against built code lives in HANDOFF.md.)
## 0. The core model
| Layer | Contents | Access | Indexable |
|---|---|---|---|
| **Event Page** (the plaque) | Event name, organizer, date, city, venue, sponsor names/logos, optional approved hero image | Public *only if organizer opts in* | Only if public |
| **Vault Interior** (behind the door) | Attendee photos, faces, names, written memories, rosters, video, addendum content | Ticket-gated, always | Never |
The ticket is the key to the interior. The Event Page is the plaque on the outside of the building.

## 1. Visibility model — PRIVACY BY DEFAULT
Three states per event: `private` (DEFAULT: plaque not reachable without ticket/token) · `unlisted` (plaque by direct link, noindex) · `public` (plaque indexable, in sitemap). **Interior is ticket-gated in ALL states — no configuration makes faces/memories public.** Public is a one-way door (must be stated plainly in UI at the moment of choice — deliberate friction, do not smooth it out). No account-level public default; every event opts in individually. Sponsor proof-of-placement for private/unlisted events = post-event sponsor report (PDF), not search — both paths must exist.

## 2. Vault URL structure — DECIDE BEFORE MAINNET
Target: `https://ticklore.com/vault/<organizer-slug>/<event-slug>`. Private/unlisted events additionally require an unguessable access token — a slug alone must never reach a private Event Page. Slug rules: lowercase a-z0-9-, collapse hyphens, max 60/segment, reserved words (admin, api, app, vault, event(s), login, auth, static, assets, checkout, webhook, health, sitemap, robots), collisions append -2/-3, year suffix recommended, 301s on change, slug history from day one, old slugs never reused.
⚠️ OPEN DECISION (Alex, before mainnet): on-chain slug (A) vs stable ID on-chain + off-chain resolver (B, recommended) vs middle path (Arweave canonical pointer on-chain; ticklore.com as changeable front door). Nothing else in the vault path gets built until settled.

## 3. Permanence vs privacy — FLAGGED, NOT SOLVED
Arweave is undeletable. NEVER write vault-interior content to Arweave unencrypted — not for any event, including public ones. Until the dedicated design session: permanent core = non-personal event facts only (name, date, organizer, sponsor attribution, provenance). Off-chain interior storage is acceptable for the December pilot. Open question (Alex, trust not legal): does an attendee appearing in a photo get a say, or the organizer alone?

## 4. Indexing controls
app.ticklore.com: X-Robots-Tag noindex,nofollow on ALL routes + robots.txt Disallow /. ticklore.com: robots.txt allows + sitemap ref; verify no leftover noindex from the password-gate era; self-canonical on every page; one hostname (no www), 301 the rest. /vault/ never blanket-allowed; only public events in sitemap; interior noindex unconditionally + auth (robots.txt is a request, not a control).

## 5. Marketing page SEO scaffolding
Unique title (≤60ch, "| Ticklore"), meta description (~155ch), one h1, OG (title/description/image 1200x630 absolute/url/type), twitter:card summary_large_image, homepage Organization JSON-LD.

## 6. Event Page template (generated)
title "{Event} — {Organizer} | Ticklore"; description "The permanent record of {Event}, {Month Year}."; h1; hero og:image or branded fallback; canonical. OG/meta render ONLY for public events — private/unlisted get minimal head (link previews are a leak vector). Public events add Event JSON-LD. Public pages: sponsor names as crawlable text; city/state visible text; NEVER attendee names/faces/ticket-holder data on any Event Page in any state.

## 7. Sitemap
Build-time generated; marketing + public Event Pages only; regenerate on publish/visibility change; on flip to private ALSO submit removal via Search Console; referenced from robots.txt; submit GSC + Bing at mainnet.

## 8. Performance
Lazy-load below fold; WebP w/ fallback; explicit width/height; lang=en; alt text everywhere (interior photos: from event context, never attendee names).

## 9. Out of scope
High-volume ticketing keywords, paid links, blog infra, product/pricing structured data.

## Priority order (from the project room)
1. Visibility model + private-by-default (BLOCKS PILOT) · 2. URL/slug decision + utility (BLOCKS MAINNET, needs Alex) · 3. noindex app domain (10 min) · 4. canonicals+hostname on marketing · 5. title/desc/OG audit · 6. Event Page template w/ conditional meta · 7. sitemap w/ visibility filter · 8. perf pass. Items 3–5 are same-day and decision-independent.
