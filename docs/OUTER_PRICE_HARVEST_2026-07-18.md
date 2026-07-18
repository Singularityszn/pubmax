# Outer-London price harvest — 2026-07-18

Cycle-6 PRD item 1. Branch `data/outer-price-harvest` (based on the unmerged
`data/outer-london-osm`, #315). Goal: honest **draught pint prices** for the new
Outer-London OSM presence pubs, which shipped `price_gbp: null` (unpriced pins).

**Evidence rules (absolute).** A price is accepted only with an explicit
first-party source (the pub's OWN website/menu page), an observed-at date, and a
licence-respecting collection. Every accepted £ value was **verbatim-validated**:
it had to appear literally in the first-party page text that was scraped, or it
was dropped as a possible hallucination. Prices were also band-guarded to a
plausible London pint range (£3.00–£9.50). **No invented, guessed, or
LLM-summarised prices.** No aggregator scraping.

## What ran

- `scripts/harvest_outer_london_prices.mjs` — bucketed the 273 unpriced OSM rows
  that carry a `website` tag; skipped known chains whose web pages publish **no**
  per-drink prices (Wetherspoon, Mitchells & Butlers brands, Stonegate/Craft
  Union, Greene King, Great Local Pubs, Slug & Lettuce — prices live only in
  their Order & Pay apps / image-only menus); Firecrawl-scraped each independent
  (homepage + best drinks page), extracted draught pints with a strict schema,
  then verbatim-validated + band-guarded each price.
- `scripts/apply_outer_london_prices.mjs` — applied only the manually-reviewed
  survivors to `pint_prices_app_dataset.json` (cheapest draught pint → the OSM
  row's `price_gbp`, provenance stamped into `comment` / `data_quality_notes` /
  `pub_url` / `scraped_at_values`) and merged the per-drink rows into the
  sanctioned store `public/data/drink_price_updates/latest.json`.
- Per-venue result log: `data/osm/outer_price_harvest_log.json`.

## Honest outcome

Web-published draught **pint** prices are extremely rare for this cohort — the
same finding PR #308 and the prior Firecrawl probes reported. Chains publish
none on the web; most independents run image-only menus or list no drink prices.

**Firecrawl credits were exhausted mid-sweep**, so coverage is partial: of 210
independent targets, **105 were actually evaluated** and **105 were never
scraped** (blocked by `Insufficient credits`). Those 105 are the follow-up queue
when credits refresh — they are NOT confirmed price-less.

| Class | Count |
|---|---|
| Unpriced OSM rows (total) | 660 |
| — with a `website` tag | 273 |
| Chains skipped (no web prices, app-only) | 63 |
| Independents evaluated | 105 |
| — priced (verified) | **2** |
| — no price published | 97 |
| — real fetch error (500 / DNS) | 6 |
| Independents credit-blocked (unevaluated) | 105 |

Raw extraction found 4 candidates; 2 passed manual pint review, 2 were dropped:

- **DROPPED — SALT Woolwich** (`saltbeerfactory.co.uk`): extracted drink name
  contaminated (`… | BIG POTATO GAMES`); the £3.25 / £4.00 values are SALT's
  third / two-third measures, **not pints**; the venue→brewery-site match is also
  dubious.
- **DROPPED — The City Barge** (`citybargechiswick.com`): a single generic
  "Stout £5.00" — too thin to assert as a specific named pint, and could not be
  re-verified (credits exhausted).

### Priced (applied)

| Borough | Pub | Cheapest pint | Draught menu | Source |
|---|---|---|---|---|
| Newham | Tattoo Bar | £6.00 Aspall Draught Cyder | 6 draught lines £6.00–£6.80 (Estrella, Poretti, Brooklyn IPA, 1644 Blanc, Guinness Microdraught Pint) | https://tattoo-bar.co.uk/menu |
| Greenwich | Boom Battle Bar (The O2) | £5.00 BOOM Lager | house draught | https://boombattlebar.com/uk/theo2/ |

## Per-borough hit-rate (independents only)

| Borough | OSM pins | w/ website | indie evaluated | credit-blocked | priced |
|---|---:|---:|---:|---:|---:|
| Barking and Dagenham | 23 | 4 | 1 | 2 | 0 |
| Brent | 65 | 18 | 3 | 10 | 0 |
| Enfield | 60 | 14 | 0 | 6 | 0 |
| Greenwich | 88 | 48 | 37 | 0 | 1 |
| Haringey | 84 | 47 | 0 | 44 | 0 |
| Hounslow | 71 | 27 | 23 | 0 | 0 |
| Kingston upon Thames | 61 | 32 | 25 | 0 | 0 |
| Newham | 68 | 22 | 8 | 8 | 1 |
| Sutton | 43 | 18 | 8 | 0 | 0 |
| Waltham Forest | 97 | 43 | 0 | 35 | 0 |
| **Total** | **660** | **273** | **105** | **105** | **2** |

Priced-count before → after: every Outer-London OSM borough was **0 → 0** except
**Newham 0 → 1** and **Greenwich 0 → 1**.

## Method by source class

- **Chains (63):** logged as no-web-price without spending credits — prices are
  in-app only (proven by probes: Ember/Vintage/O'Neill's = M&B; Craft
  Union/Slug & Lettuce = Stonegate; Great Local Pubs; Wetherspoon; Greene King
  image menus).
- **Independents (105 evaluated):** Firecrawl homepage + drinks-page scrape →
  strict JSON extraction of draught pints → verbatim + band validation → manual
  review of survivors.
- **Unpriced pins stay unpriced.** A real pub with no price beats an invented
  one — no `price_gbp` was set for any venue without a verified first-party pint.

## Validation

- `npm run validate-data`: PASS (all 12 datasets; pint dataset 3773 rows, slim
  1919 venues, drink updates 3375 rows).
- `npx vitest run`: 346 files / 3097 tests passed. Affected suites
  (`venuesSlim`, `venueCanonicalization`) green.
- `npm run build:slim`: canonical unchanged (0 new duplicate clusters); the two
  priced venues now carry `cheapestPrice` in `venues_slim.json`.

## Follow-up (next credit window)

Re-run `scripts/harvest_outer_london_prices.mjs` to cover the 105 credit-blocked
independents — concentrated in **Haringey (44)** and **Waltham Forest (35)**,
which received zero independent coverage this run.
