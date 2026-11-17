# London OSM restaurants

The map reads `manifest.json` and its immutable chunks only after the reader enables
**All restaurants**, or opens an explicit restaurant link. Existing curated restaurant
pins keep their separate Restaurants filter. Priced pins paint before this layer loads.

## Rebuild

Install the offline PBF parser once: `brew install osmium-tool`.

```sh
npm run fetch:uk-venues -- --london-restaurants
npm run build:london-venues
```

The collector downloads the [Geofabrik Greater London extract](https://download.geofabrik.de/europe/united-kingdom/england/greater-london.html)
through `sourcePolicy`. It records the PBF header replication timestamp, not the download
day, in `data/osm/uk/london_osm_restaurants.json`. `osmium tags-filter` selects only
`amenity=restaurant`. `osmium export` preserves each node, way or relation identity.
The collector retains named places inside the Greater London bounding box. Geometry
bounding-box centres locate ways and relations. They are not entrance claims.

The raw PBF remains ignored under `data/osm/uk/raw_venues/london-restaurants/`.
To replay an existing extract without downloading it:

```sh
npm run fetch:uk-venues -- --london-restaurants --from-pbf=/absolute/path/to/greater-london-latest.osm.pbf
npm run build:london-venues
```

Old cached Overpass results supply cross-check counts only. They never supply rows.
Neither the matrix website nor restaurant websites supply this layer.

## Published contract

The venue builder joins the fresh restaurant snapshot to the existing OSM venue packs.
It preserves the six-column venue shard format. The restaurant builder joins optional
OSM facts and appends a borough, cuisine and opening-hours value:

`[osmRef, name, address, lat, lng, kind, borough, cuisine, openingHours]`

`kind` is always `restaurant`. Empty optional tags stay empty. The borough comes from
the existing polygon lookup. No row carries a price or an alcohol claim. The manifest
and chunks use version 3. `observedAt` is the extract timestamp. `layer` identifies
the parent venue generation. Each response stays below 192 KiB, and the whole generated
layer stays below the existing venue layer ceiling of 5 MiB. The current 8,971-row
snapshot produces six chunks, totalling 1,153,689 bytes before compression. The initial
map requests none of them. Opt-in loads the chunks concurrently after the manifest.

The sheet shows only tagged facts, the snapshot date and the original OSM element link.
Opening hours are source text, not a claim that the venue is open now.

## Attribution

OSM data is © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright),
[ODbL 1.0](https://opendatacommons.org/licenses/odbl/1-0/). The map retains its OSM
attribution. Each restaurant sheet repeats the source and licence. Geofabrik distributes
the OSM extract under the same terms.
