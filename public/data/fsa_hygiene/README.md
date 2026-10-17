# FSA food hygiene ratings (London)

`london.json` holds the Food Standards Agency's own Food Hygiene Rating Scheme
(FHRS) answer for every establishment a London OSM pub names in its `fhrs:id`
tag (`public/data/osm_fhrs/london.json`). Keyed by FHRSID; it holds no OSM data.

- **Source and licence:** Food Standards Agency, FHRS open data
  (https://ratings.food.gov.uk/open-data, read through the keyless API at
  https://api.ratings.food.gov.uk), Open Government Licence v3.0. Attribution:
  "Food hygiene ratings from the Food Standards Agency. Contains public sector
  information licensed under the Open Government Licence v3.0."
- **Built by** `npm run build:fsa-hygiene`: every London local
  authority's establishments in pages of 200, one second apart by default
  (`--delay-ms` may slow it), then any named id still missing. A failed read
  writes nothing.
- **Shape:** `ratings` maps FHRSID to `[rating, ratingDay | null, authority | null]`.
  `rating` is one of `0`-`5`, `Exempt` or `AwaitingInspection`; every other
  status and Scotland's FHIS scheme are left out and counted. `retrievedAt` is
  the day the FSA was read, and the sheet prints it beside the rating.
- **Freshness:** the `fsa_hygiene_london` row in
  `data/freshness_registry.json` (class `episodic`, stamp field `retrievedAt`).
  A rebuild commits the pack and any change to that row together, because the
  freshness gate fails on a registered artifact that is not on disk. A pub this
  pack has no row for is answered live by `/api/hygiene`: a pub OSM links to an
  FHRSID by that id, and only an unlinked pub by the name-and-postcode match in
  `lib/foodHygiene.ts`.

Pin: `__tests__/fsaHygienePack.test.tsx`.
