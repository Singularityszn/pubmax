# Permissible-source FOOD price updates (RETIRED LANE)

Versioned, provenance-stamped price files for food dishes on the venue Menu tab
(`lib/food.ts` / `lib/foodPriceUpdates.ts`). Parallel to
`public/data/drink_price_updates/`.

**This lane is closed.** `data/freshness_registry.json` declares it
`retired: true`, so `/api/freshness` reports it as `retired` rather than as a
feed anybody owes a run. The pack still SHIPS and is still read: every row
carries its own `observedAt`, and `lib/priceUpdates.ts` never presents one as
live.

No script in this tree refreshes these files. The pack contains three reviewed
imports: the preserved July 2026 Greene King rows, 42 Eagle dishes,
and 48 dishes from The New Inn and The Narrowboat.
The first-party additions were captured on 13 October 2026.
`scripts/firecrawl_greene_king_prices.mjs` writes the DRINK pack beside
this one and deliberately drops every food section (`mapSectionToCategory`
returns `null` for them), and `scripts/harvest/uk-prices/render.mjs` writes the
uk-prices overlay. Writing a generator is a captain decision, not a budget or a
status change.

Retiring the lane retires its REFRESH and never this artifact's integrity: both
freshness readers still open `latest.json`, so a pack that goes missing or
stops parsing is still an unresolved breach.

## Reviewed imports

`prices_20260711.json` retains the original 2,530 rows unchanged.
`prices_20261013.json` and `latest.json` contain those rows plus 42 dishes from
[The Eagle's official menu](https://www.theeaglew12.co.uk/food-drink),
27 from [The New Inn](https://www.newinnealing.com/food-and-drink),
and 21 from [The Narrowboat](https://www.thenarrowboatpub.com/food-and-drink).
The source snapshots contain 2,620 rows in total.
Every previous observation date remains unchanged.
Their envelope stamp is the actual newest captured input timestamp.

The Eagle matches `venue-1hz0avt` at 215 Askew Road, W12 9AZ.
The new rows retain their source URL and capture date.
They contain price and calorie facts without publisher descriptions or inferred dietary tags.
[The source receipt](../../../data/enrichment/firecrawl/london/menu-review-20261013.json)
records the permission check, runtime item IDs, and the 42 matched source calorie observations.

[The second October receipt](../../../data/enrichment/firecrawl/london/menu-batch2-review-20261013.json)
records 48 matched prices, 47 calorie values, and 18 explicitly tagged dietary rows.
The publisher's item attributes and labelled filter values identify the dietary tags.
Page-wide filters, ingredient lists, and optional variants do not supply base-dish tags.
The New Inn Scotch Egg's literal `240247kcal` stays quarantined.
Its price remains included, with calories unknown.
Four add-on prices and two unpriced variant notes remain outside runtime dish rows.

Optional `caloriesKcal` holds the number stated for that menu item.
It is not a health rating or a per-person calculation.
Portion wording in each item name stays unchanged.
The runtime menu retains separate `caloriesProvenance`, including its source URL,
so a later price-only update cannot redate an earlier calorie fact.
This import does not add an automatic producer or revive the refresh lane.

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

First-party permissible sources only. See the `greene-king-official` and
`youngs-official` entries in `data/price_sources.json` `drinkSources`.
