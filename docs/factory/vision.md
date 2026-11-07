# PUBMAXX vision

PUBMAXX is becoming the social app and night-out system for Pubmaxxers, venues,
and the places around them. It combines consumer discovery, social planning,
and venue tools in one ecosystem. Pubs, restaurants, and other places are not
an advertiser layer added later. They are part of the product's centre of
gravity.

## Start with a real place

We start in London, where a dense Venue Dataset can make a night feel alive.
North Wales follows. We earn each new geography with enough local depth to make
discovery, a Crawl Route, and a social night useful.

PUBMAXX helps people choose a night, find a venue, make a plan, bring friends
in, and keep a Night Memory. The point is intentional social exploration: the
life around a drink matters more than alcohol quantity.

## First 100

The first 100 Pubmaxxers form a culture, not a sales funnel. A friend referral
is a mark of honour. It gives recognition and belonging. It never becomes a
paywall, a capability grant, or a reason to restrict an honest product read.

## Venue-first business

Venues are the first revenue rail. Pubs, restaurants, and other places can get
useful operator tools as that channel matures. Drinkers pay for nothing in the
consumer product. Year in Pints is free forever.

## Taste is the build bar

PUBMAXX should feel considered, playful, clear, and good on a phone. Taste and
UX set the build bar. A working feature is not enough when its copy, spacing,
states, or touch behaviour make a night harder to understand.

## Honesty is constitutional

PUBMAXX does not invent prices, hours, heritage, availability, or social
activity. Every claim names its Provenance. A Sourced fact, Contributor Pint
Drop, Anecdote, and Community observation remain distinct. Missing data stays
missing. Thin nights stay thin. The product earns trust by showing what it
knows, what it does not know, and who contributed it.

This is the shape of PUBMAXX: consumer joy and venue usefulness in one London-
first ecosystem, expanded only when the experience and the evidence are ready.

## Anti-goals

These guide product choices. They moved here from the root `AGENTS.md`.

- **Honest path anti-goals (London night OS first).** Do not ship a Twitter-for-pubs growth engine; the UK-wide hunt for the cheapest pint may be marketed (captain decision 3, 1 Nov 2026), but every claim shows a real price with its date, a city with no prices says so, and London stays the deep, complete city; do not add Stripe Checkout or payments theatre before venue trust density; do not build AI that fabricates prices, hours or pub lore (heritage and plan generate fail closed to grounded or scarcity answers); do not claim "we beat Stripe" in marketing or investor copy. THREE STANDING COMMITMENTS ride with these. (1) A REFERRAL IS A MARK OF HONOUR, NEVER A FEATURE: a milestone confers recognition and nothing in the product may branch on it (`lib/referrals.ts`, fence `__tests__/referralMarkLaw.test.ts`). The old capability-grant model is deleted, not switched off, in TypeScript and in SQL. (2) THE ANNUAL YEAR IN PINTS WRAP IS FREE FOREVER: it is a person's own year read back to them, so it may never sit behind a price, a tier, a referral count or an account upgrade. (3) FIRST REVENUE COMES FROM VENUES, NEVER DRINKERS: a drinker pays for nothing, and no drinker-facing paywall, membership or metered read may be built before the venue rail earns. Platform prep is ADR-only: `docs/adr/0011-venue-operator-rail.md`, `docs/adr/0012-entitlement-ledger-contract.md`. Ops checklist: `docs/growth/HORIZON0_OPS_CHECKLIST.md`. Extend `docs/plans/PLG_STRATEGY.md` waves rather than inventing a parallel roadmap.
