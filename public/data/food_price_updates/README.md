# Permissible-source FOOD price updates

Versioned, provenance-stamped price files for food dishes on the venue Menu tab
(`lib/food.ts` / `lib/foodPriceUpdates.ts`). Parallel to
`public/data/drink_price_updates/`.

**This lane has a producer again, and it is still declared retired.** On the
owner's decision of 17 Oct 2026, `npm run harvest:uk-food` reads London pubs'
own food menus and `npm run build:food-price-updates` publishes the reviewed
rows here (runbook `docs/UK_FOOD_HARVEST.md`). `data/freshness_registry.json`
keeps `retired: true` until the first reviewed publish lands, because a
producer that has not yet run has refreshed nothing; that same PR gives the
entry a staleness budget. Until then `/api/freshness` reports it as `retired`,
and every row carries its own `observedAt`, which `lib/priceUpdates.ts` never
presents as live.

What ships today is the single earlier Greene King import, which was never
repeated. Nothing writes these files except the build step above, which keeps
the price fact, its page, its observedAt and the first-party licence, and
leaves the menu's own words in the harvest ledger.

Retiring the lane retires its REFRESH and never this artifact's integrity: both
freshness readers still open `latest.json`, so a pack that goes missing or
stops parsing is still an unresolved breach.

## File naming

`prices_YYYYMMDD.json` - one file per publish, dated by its newest row's `observedAt`. `latest.json` is a stable alias.

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
