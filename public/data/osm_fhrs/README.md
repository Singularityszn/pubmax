# OSM fhrs:id links (London)

`london.json` says which Food Standards Agency (FSA) establishment each London
OpenStreetMap pub is, as OSM itself states it in the pub's `fhrs:id` tag. It is
the join key behind the food hygiene badge and holds nothing else: the FSA's
ratings are their own pack, `public/data/fsa_hygiene/`.

- **Source and licence:** OpenStreetMap, ODbL 1.0, © OpenStreetMap contributors.
- **Built by** `npm run build:osm-fhrs-links` from the committed UK
  Overpass snapshot (`data/osm/uk/raw/`). It fetches nothing.
- **Stamp:** `fetchedAt` is the snapshot's own `generatedAt`, never the day the
  links were re-derived. Registered as `osm_fhrs_links` in
  `data/freshness_registry.json`.
- **Shape:** `links` is a sorted list of `[osmRef, fhrsId, curatedVenueId | null]`.
  `osmRef` is the compact ref a `venue-uk-<ref>` id carries (`n123`, `w456`).
  `curatedVenueId` is the curated London venue the UK seed pack matched to that
  OSM object (`curatedRef`), or null.
- **Nothing is guessed.** A tag naming two establishments (`70278;100386`) is
  dropped and counted, and so is a curated venue two OSM objects both claim. A
  pub with no row has no tag, which says nothing about its hygiene.

Pin: `__tests__/fsaHygienePack.test.tsx` (the committed file equals a rebuild
from the committed snapshot).
