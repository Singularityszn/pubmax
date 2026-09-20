# Permissible-source FOOD price updates (RETIRED LANE)

Versioned, provenance-stamped price files for food dishes on the venue Menu tab
(`lib/food.ts` / `lib/foodPriceUpdates.ts`). Parallel to
`public/data/drink_price_updates/`.

**This lane is closed.** `data/freshness_registry.json` declares it
`retired: true`, so `/api/freshness` reports it as `retired` rather than as a
feed anybody owes a run. The pack still SHIPS and is still read: every row
carries its own `observedAt`, and `lib/priceUpdates.ts` never presents one as
live.

No script in this tree writes these files, and the earlier claim that they are
"harvested by hand" outlived the last harvest: every row in the pack carries
the same single import, which was never repeated. `scripts/firecrawl_greene_king_prices.mjs` writes the DRINK pack beside
this one and deliberately drops every food section (`mapSectionToCategory`
returns `null` for them), and `scripts/harvest/uk-prices/render.mjs` writes the
uk-prices overlay. Writing a generator is a captain decision, not a budget or a
status change.

Retiring the lane retires its REFRESH and never this artifact's integrity: both
freshness readers still open `latest.json`, so a pack that goes missing or
stops parsing is still an unresolved breach.

## File naming

`prices_YYYYMMDD.json` - one file per import. `latest.json` is a stable alias.

## Schema

```jsonc
{
  "version": 1,
  "generatedAt": "2026-07-11T00:00:00.000Z",
  "updates": [
    {
      "venueKey": "prospect of whitby|57 wapping wall, e1w 3sh|51.50710|-0.05113",
      "itemName": "Fish & Chips",
      "category": "mains", // one of FOOD_CATEGORIES in lib/food.ts
      "priceGbp": 19.95,
      "source": {
        "label": "Greene King — official site",
        "url": "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu",
        "licence": "All rights reserved — first-party publisher; attributed use only."
      },
      "observedAt": "2026-07-07T12:00:00.000Z"
    }
  ]
}
```

## City venue keys

Same formula as London `venueGroupingKey`:
`${name}|${address}|${lat.toFixed(5)}|${lng.toFixed(5)}` (lower-cased,
whitespace-collapsed) — **no city-id salt**. City slim pins recover address
from `filterHints.searchText` so updates attach without `VenuePrice` rows.
`venue.id` is also accepted as a lookup alias by `venueMenuLookupKeys`.

## Governance

First-party / permissible sources ONLY. See `data/price_sources.json`
`drinkSources` entry `greene-king-official`.
