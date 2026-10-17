# Wikidata history (London pubs)

`london.json` holds what Wikidata states about the London pub items OSM names
(`public/data/osm_wikidata/london.json`). Keyed by QID; it holds no OSM data.

- **Source and licence:** Wikidata (https://www.wikidata.org/), CC0 1.0, read
  through the Wikidata Query Service with a descriptive User-Agent.
- **Built by** `npm run build:wikidata-history`: batches of 100 items, one
  second apart. A failed batch writes nothing.
- **What it keeps:** best- and normal-rank statements for inception (P571, at
  its own precision: a year, a decade or a century), heritage designation
  (P1435), architectural style (P149) and architect (P84), on items Wikidata
  types as a pub (P31/P279* Q212198) and not as a brand (Q431289). A value with
  no English label is dropped.
- **How it is shown:** one closed template per property
  ("Inception recorded as 1520."), the Wikidata chip, the day the pack was read
  and a link to the exact statement (`https://www.wikidata.org/wiki/<QID>#<P>`).
  A pub with no row shows nothing.
- **Freshness:** registered as `wikidata_history` in
  `data/freshness_registry.json` (class `episodic`, stamp field
  `retrievedAt`). First built 17 Oct 2026: 439 of the 798 linked items carry
  at least one kept statement.

Pin: `__tests__/wikidataHistory.test.tsx`.
