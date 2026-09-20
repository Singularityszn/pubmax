# Permissible-source price updates (RETIRED LANE)

**This lane is closed.** `data/freshness_registry.json` declares it
`retired: true`, so `/api/freshness` reports it as `retired` rather than as a
feed anybody owes a run. Nothing in this tree writes these files.

What was deleted, rather than switched off:

- `scripts/refresh_prices.mjs`, the hand-run publish;
- `scripts/price_source_fetchers.mjs`, whose `fetchFromSource()` returned `[]`
  by construction, so every run of that publish wrote nothing;
- the `refresh:prices` package script, and the slot the nightly local-refresh
  scheduler spent on it;
- the two `example-*` placeholder rows in `data/price_sources.json` `sources`,
  which are not sources.

**Why, and it is supply rather than permission.** Measured on the 2026-09-03
re-read recorded in `lib/harvest/sourcePolicy.ts`: Greene King and Wetherspoon
both permit automated reading and publish no web pint price at all, and the one
chain that does publish one (Nicholson's, Mitchells & Butlers) answers
`robots.txt` with a Cloudflare 403 and is refused on permission. A real
first-party parser therefore has nothing permissible to parse. Reviving this
lane is a captain SOURCE decision with a producer beside it, never a cadence
or a budget change.

## What still ships

`latest.json` stays, empty, and the Map still reads it (`components/PubMap.tsx`,
404-tolerant), so the sourced lane in `lib/venuePriceLane.ts` keeps its shape
and a future publish has somewhere to land. Its `generatedAt` is an **envelope
date**: it names the day the empty envelope was aligned to the bundled pint
dataset's own collection day, and it dates no observation, because there are no
rows to date.

The current price lanes that are NOT this one, and that do carry real dated
rows, are `public/data/drink_price_updates/`, `public/data/uk_prices/` and
community Pint Drops. Read `data/AGENTS.md` for which of them may colour a pin.

## Schema (unchanged, for a future publish)

```jsonc
{
  "version": 1,
  "generatedAt": "2026-07-03T12:00:00.000Z", // when this file was written (ISO-8601)
  "updates": [
    {
      "venueKey": "the churchill arms|119 kensington church st|51.50700|-0.19400",
      // Canonical grouping key = lib/venues.ts venueGroupingKey:
      //   `${pub_name}|${address}|${lat.toFixed(5)}|${lng.toFixed(5)}` (lower-cased,
      //   whitespace-collapsed). Targets exactly the venue the app groups by.
      "price": 6.5,                          // finite, >= 0 (0 allowed for a promo)
      "source": {
        "label": "The Churchill Arms — official site",
        "url": "https://www.churchillarmskensington.co.uk/" // absolute http(s)
      },
      "observedAt": "2026-07-01T00:00:00.000Z" // ISO-8601, not in the future
    }
  ]
}
```

A bare top-level array (`[ {…update…}, … ]`) is also accepted by the loader
(`lib/priceUpdates.ts` `parsePriceUpdates`), which drops malformed rows rather
than throwing.

## Governance (hard rules, still binding on any revival)

- **First-party / open sources ONLY.** Prices may come from pub or brewery
  official pages, or open-licensed datasets, and only through
  `data/price_sources.json`. **No scraping of competitor price-aggregator
  sites, ever.** The two governance tables are read together and the narrower
  answer binds (`__tests__/priceSourceGovernance.test.ts`).
- **Every price carries `source` + `observedAt`.** The venue detail attributes
  a refreshed price as **"sourced"** (`lib/priceUpdates.ts`
  `PRICE_UPDATE_PROVENANCE`), never as a community contribution.
- **Never present stale as live.** `observedAt` is always surfaced; a future or
  malformed timestamp is rejected by the loader.
