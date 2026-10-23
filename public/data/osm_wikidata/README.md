# OSM wikidata links (London)

`london.json` says which Wikidata item each London OpenStreetMap pub is, as OSM
itself states it in the pub's `wikidata` tag. It is the join key behind the
pub's Wikidata history and holds nothing else: Wikidata's statements are their
own pack, `public/data/wikidata_history/`.

- **Source and licence:** OpenStreetMap, ODbL 1.0, © OpenStreetMap contributors.
- **Built by** `npm run build:osm-wikidata-links` from the committed UK Overpass
  snapshot (`data/osm/uk/raw/`). It fetches nothing.
- **Stamp:** `fetchedAt` is the snapshot's own `generatedAt`. Registered as
  `osm_wikidata_links` in `data/freshness_registry.json`.
- **Shape:** `links` is a sorted list of `[osmRef, qid, curatedVenueId | null]`.
  `osmRef` is the compact ref a `venue-uk-<ref>` id carries (`n123`, `w456`).
- **Nothing is guessed.** A tag that is not one item id, an item that is the
  pub's own `brand:wikidata`, and an item two London pubs both name (a chain or
  a brand, not a building) are dropped and counted. Whether an item is a pub at
  all is Wikidata's to say: the history read keeps only items Wikidata types as
  a pub and not as a brand.

Pin: `__tests__/wikidataHistory.test.tsx`.
