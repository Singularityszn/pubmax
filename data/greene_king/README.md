# Greene King menu scrape drops

Local-only staging area for first-party Greene King menu payloads. No script
in this tree merges these drops today: `scripts/merge_greene_king_menus.mjs` is
not in the tree, so `public/data/food_price_updates/latest.json` advances only
by hand and carries no staleness budget. The row `food_price_updates` in
`data/freshness_registry.json` owns that contract. Never commit API keys
(`FIRECRAWL_API_KEY` etc.).

## Layout

```
data/greene_king/
  README.md                 (this file)
  osm_city_pubs.json        city OSM GK pubs (name/address/lat/lng/menuUrl)
  raw/                      optional drink menu scrapes
    {slug}.menu.json        { name, menuUrl, city?, lat?, lng?, address?, markdown, scrapedAt }
  food/                     optional food interact / markdown drops
    {slug}.interact.txt     ### **Starters** / * **Item**: £x.xx
    {slug}.json             { text|markdown, menuUrl, venueKey?|name+lat+lng, scrapedAt }
```

## Workflow

1. Scrape a pub menu page (outside this repo / with your own key) into markdown.
2. Drop the JSON under `raw/` (drinks) and/or interact text under `food/`.
3. Publish the rows into `public/data/food_price_updates/` by hand, in
   the schema `public/data/food_price_updates/README.md` names. The merge
   script this step once named is not in the tree; adding one is a captain
   decision, not a budget change.

## Firecrawl notes

First-party scrapes use Firecrawl against `greeneking.co.uk` only (allowlisted
as `greene-king-official` in `data/price_sources.json`). Menu pages often
default to **food** (`## Main Menu`); drink sections need a Drinks filter click
(interact) or appear on drink-default pubs. Store the API key in the
environment (`FIRECRAWL_API_KEY`) — never commit it.

## Venue keys

Updates use `name|address|lat|lng` (lower-cased, whitespace-collapsed) — the
same formula as `lib/venues.ts` `venueGroupingKey` / `venueCoordsGroupingKey`.
City venues have **no** city-id salt on the update key; `venueMenuLookupKeys`
also accepts `venue.id` as an alias.
