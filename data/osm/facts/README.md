# London pub facts from OpenStreetMap

`london_pub_facts.json` holds what OpenStreetMap states about each London pub
that a pub sheet prints: opening hours, wheelchair access, live sport, outdoor
seating, beer garden, real ale, dogs, the menu link, Facebook, Instagram and X,
and operator, brand and brewery. Each value is the verbatim OSM tag.

## Licence

This pack is derived from OpenStreetMap and is licensed under the
[Open Database License (ODbL) 1.0](https://opendatacommons.org/licenses/odbl/1-0/).
Data © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright).

The pack holds OSM data only. Keep data from other sources out of this file.
The venue routes join it to other packs at runtime by OSM id, so the ODbL
share-alike applies to this file and not to the other packs.

Every surface that shows these facts shows the ODbL credit beside them
(`components/map/VenueOsmDetails.tsx`).

## Shape

`{ version, licence, source, bbox, extractedAt, counts, rows }`.

- `extractedAt` is the oldest planet stamp among the raw chunks the rows came
  from. `data/freshness_registry.json` (`osm_pub_facts`) reads it.
- Each row is `{ osmId, readOn, ...facts }`. `readOn` is the planet day of the
  chunk that the row came from. `checkDate` and `hoursCheckDate` are the
  mapper's `check_date` and `check_date:opening_hours` tags.
- A tag that OSM does not state is not in the row. A missing tag is unknown,
  never "no".

## Refresh

No network. The pack is built from the committed raw chunks in
`data/osm/uk/raw/`:

```bash
npm run fetch:uk-pubs          # refresh the raw chunks (network)
npm run build:osm-pub-facts    # rebuild this pack from them (offline)
```

The reader is `lib/osmPubFacts.server.ts`. The display rules are in
`lib/osmPubFacts.ts`.
