# Permissible-source DRINK price updates

Versioned, provenance-stamped price files for individual drinks on the E1
**drinks menu** (`lib/drinks.ts`) — the per-drink counterpart to
`public/data/price_updates/` (which refreshes a venue's single cheapest-pint
baseline). Community drink ratings/observations remain the live signal — a
fresher community observation always beats an update here (see
`lib/drinkPriceUpdates.ts` `mergeDrinkPriceUpdates`).

## File naming

`prices_YYYYMMDD.json` - one file per publication, written by
`scripts/refresh_drink_prices.mjs`. `latest.json` is a stable alias always
pointing at the newest file (the client can fetch it directly and tolerate a
404 if nothing has ever been generated).

## Schema

```jsonc
{
  "version": 1,
  "generatedAt": "2026-07-07T00:00:00.000Z", // newest observation stamp for a reviewed import (ISO-8601)
  "updates": [
    {
      "venueKey": "the churchill arms|119 kensington church st|51.50700|-0.19400",
      // Canonical grouping key = lib/venues.ts venueGroupingKey:
      //   `${pub_name}|${address}|${lat.toFixed(5)}|${lng.toFixed(5)}` (lower-cased,
      //   whitespace-collapsed). Targets exactly the venue the app groups by.
      "drinkName": "Doom Bar",
      "category": "beer", // matches the E1 drinks taxonomy (lib/drinks.ts)
      "priceGbp": 5.29,   // finite, >= 0 (0 allowed for a promo)
      "source": {
        "label": "J D Wetherspoon — official site",
        "url": "https://www.jdwetherspoon.com/pubs/all-pubs/the-example",   // absolute http(s)
        "licence": "All rights reserved — first-party publisher of its own pub menus/prices; attributed use only."
      },
      "observedAt": "2026-07-01T00:00:00.000Z" // ISO-8601, not in the future
    }
  ]
}
```

A bare top-level array (`[ {…update…}, … ]`) is also accepted by the loader.

## Reviewed one-off imports

The automatic workflow retrieves Wetherspoons pages. It does not promise a
snapshot refresh. A bounded reviewed import can publish facts from an already
permitted Young's microsite through the same writer:

```sh
node scripts/refresh_drink_prices.mjs \
  --reviewed-input data/enrichment/firecrawl/london/eagle-drinks-reviewed-20261013.json \
  --reviewed-sha256 <reviewed-receipt-sha256> \
  --source-pdf <preserved-source-pdf> \
  --scratch <review-output-directory>
```

The receipt checksum pins the reviewed facts. The PDF checksum pins their
captured source. The writer checks the curated venue, recorded publisher,
source-policy fence and live robots permission before writing. It rejects
duplicate identities and mismatched sources or venues. It preserves earlier
rows and their observation dates. Remove `--scratch` only after reviewing the
output. This path creates no schedule and changes no source permission.

Every new row receives a deterministic `itemId` from its venue, item, category
and stated serving. That ID uses a separate namespace from legacy rating
references. A supplied ID must match those fields exactly. Legacy rows without
`itemId` retain their existing IDs. An unknown serving cannot replace a glass,
bottle or pint price. Duplicate explicit IDs are rejected.

A publisher's explicit `alcohol-free` category can supply `low-no` when numeric
ABV is absent. It never supplies a numeric `0%`, and stated numeric ABV keeps
precedence. The Eagle receipt contains 22 GBP price atoms, including both
125ml/750ml wine pairs and twelve AF-labelled price atoms. Unconfirmed-currency
wine figures and drink calorie observations remain outside this price import.

## Governance (hard rules)

- **First-party / permissible sources ONLY.** See `data/price_sources.json`
  `drinkSources` — a chain publishing **its own** pub menus (Wetherspoons' own
  site/app for its own pubs) is first-party and permissible. Competitor price
  aggregators, review sites (Vivino, Untappd, etc.), or any site whose
  robots.txt/ToS forbids automated access are **never** permissible.
- **Every price carries `source` (label + url + licence) + `observedAt`.** The
  drinks menu attributes a refreshed price as **"sourced"**
  (`lib/drinkPriceUpdates.ts` `DRINK_PRICE_UPDATE_PROVENANCE`), never as a
  community contribution.
- **Never present stale as live.** `observedAt` is always surfaced; a future or
  malformed timestamp is rejected by the loader.
- **Merge precedence**: a fresher community observation for the same drink row
  always wins over a sourced update — this layer only fills in absent a live
  community signal.

## Why this file contains demo rows

The flagship permissible source named in the PRD — Wetherspoons' own site — is
currently a **documented stub** in `scripts/refresh_drink_prices.mjs`
(`fetchFromDrinkSource`): no live network fetch/parse has shipped because doing
so responsibly requires first confirming robots.txt/ToS allow it and pinning a
stable per-pub parse target (see the `notes` field on the `wetherspoons-official`
entry in `data/price_sources.json`).

`latest.json` may also contain dated first-party menu observations from other
reviewed lanes. Demo fixtures are labelled as demo in the app and must not be
presented as live venue prices. The UK price bundle re-checks source permission
when it builds, so a row from a refused host cannot become a listed price.
Nicholson's rows were removed from all tracked update snapshots on 2026-09-22
after a live robots.txt re-read returned an unreadable 403 challenge.
