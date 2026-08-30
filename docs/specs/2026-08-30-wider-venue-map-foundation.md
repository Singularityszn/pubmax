# Wider Venue Map Foundation

## Goal

Show the existing wider London Venue Dataset on the map at street zoom. Keep it separate from curated Venues, UK base pubs, Pint Prices, Crawl Routes, cheapest buckets, and the Pint Index.

## Scope

- Stream only shards that intersect the settled viewport.
- Start loading at zoom 15.
- Show non-pub Venue names from the existing London pack.
- Do not draw `pub` rows. Curated and UK base layers already own pubs.
- Give curated pins and UK base pub pins higher visual and collision priority.
- Use one neutral source with no price, price band, freshness, or trust property.
- Fail closed. Invalid manifests, invalid shards, and failed requests produce no wider Venue labels and retry on a later settle.
- Keep resident shard count bounded.
- Enable only for London until a national wider Venue manifest is published.

## Data contract

Input remains `public/data/london_venues/manifest.json` plus its immutable shard files. Runtime rows use `LondonVenue` from `lib/londonVenueShards.ts`:

```ts
type LondonVenue = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
  kind: VenueKind;
};
```

Map features may contain only `id`, `name`, `address`, and `kind`. Geometry contains the public Venue coordinates.

## Map contract

- Source id: `wider-venues`.
- Label layer id: `wider-venues-label`.
- Minimum zoom: 15.
- Labels use MapLibre collision placement. They do not allow overlap and do not ignore placement.
- Layer is assembled before `uk-base-point` and curated `pubs-point`.
- No click or detail surface in this slice. Interaction follows after national data delivery and a stable Venue-detail contract.

## Verification

- Loader test proves viewport-only fetch, cache reuse, retry after failure, pub exclusion, and bounded residency.
- GeoJSON test proves exact property allow-list and absence of price authority.
- Scene test proves minimum zoom, collision settings, and layer order.
- Focused Vitest targets pass.
- Worktree remains clean after commit and push.

## Follow-up projects

1. Publish national wider Venue shards from the existing UK packs.
2. Add neutral Venue detail and search contracts.
3. Expand custom POI coverage beyond current city packs.
4. Restore reproducible harvest inputs and prove production overlay activation.
