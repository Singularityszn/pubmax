# Seed borough operator playbook

Goal: when a soft-launch guest opens the map on a seed patch, pins already show
honest people-logged prices (provisional mark at least; corroboration where
two independents logged). Grey first viewports kill trust.

## Seed set (Horizon 0–1)

| Patch | Why | Notes |
|---|---|---|
| Soho (Westminster) | Dense night demand | First viewport for many tourists and locals |
| Camden | Plan chips and Pint Index arrival | Keep campaign copy status-shaped, not gamified |
| Clapham (Lambeth) | Describe-first chip already works keyless | Good second-wave densify |
| Shoreditch (Hackney) | Cheap-pint asks | Do not market as “complete” early |

Monthly status target for in-product copy: **20 corroborated beer pints per
borough** (`SEED_BOROUGH_MONTHLY_TARGET` in `lib/boroughCoverageStatus.ts`).
That is a coverage floor, not a leaderboard.

## Before the cohort blast

1. Captain + 2–3 early drinkers each log a real pint in the same seed pubs.
2. Prefer different accounts so corroboration can fire (`COMMUNITY_PRICE_CORROBORATION_THRESHOLD`).
3. Confirm provisional marks appear; wait for a second voice before promising pin colour.
4. Open `/map` cold on phone width and check the first viewport is not empty grey.
5. Re-check `/pint-index` seed status strip after durable reads settle.

## Honesty rules

- Never seed fake corroboration or invent figures.
- Demo / curated prices may colour a band; they must not be described as people-logged.
- A failed community-price read may never be worded as “zero prices in this borough.”
- Keep Social beta off while densifying.

## Weekly operator loop

1. Read corroborated coverage for seed boroughs (PostHog + Pint Index status strip).
2. Top up the thinnest borough with real logs, not ads.
3. Only then widen the invite blast.
