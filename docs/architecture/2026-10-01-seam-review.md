# Seam review, 1 October 2026

Outcomes for the seven architecture seams on `fm/pubmax-arch-gnhf`. One section per issue. A skip is not fully resolved.

## 1843 Great-circle distance

**Still true:** no. `lib/haversine.ts` and `scripts/lib/geo.mjs` are not two masters. A search for `EARTH_RADIUS` finds the radius only in `lib/greatCircle.mjs`. The great-circle `Math.asin` lives in that same module. `lib/weatherDaylight.ts` uses `Math.asin` for solar altitude, not for distance.

**Seam decision:** deepen. The module is `lib/greatCircle.mjs`, plain ESM, with the `lib/greatCircle.d.mts` sidecar (the `lib/brandMark.mjs` pattern). Depth is one formula. Two adapters sit on it:

- `lib/haversine.ts` is the typed view. Map and nearest call `haversineKm` with GeoJSON `[lng, lat]` tuples. `lib/nearby.ts` `nearestVenueIds` is that caller.
- `scripts/lib/geo.mjs` is the scalar adapter scripts already import. It keeps `haversineMeters`, latitude-first `haversineKm`, and `haversineKmLngLat`.

`lib/samePubIdentity.ts` calls `haversineMeters` from `@/lib/greatCircle.mjs` (line 10). App code does not import `scripts/lib/geo.mjs` for this seam. The interface is those three call shapes. `__tests__/haversine.test.ts` calls the module the way `samePubIdentity` and the scripts do (latitude first), and the way nearest does (`[lng, lat]`). London to Edinburgh is pinned at `533652.20033900486` metres, the result the old pair already shared (`__tests__/scriptGeo.test.ts`). That pin is the deletion test for a second formula: a drifted adapter fails the shared number. The older behavioural cases (zero, symmetry, one degree of latitude, King's Cross to Waterloo, antipodes) stay.

`scripts/build_city_night_areas.mjs` and `scripts/lib/ukPlaceIndex.mjs` stay thin adapters. The night-areas comment still says the formula has one owner in `scripts/lib/geo.mjs` and that the local function only names `{ lat, lng }` arguments. That shape was left.

**Files changed:** `lib/greatCircle.mjs`, `lib/greatCircle.d.mts`, `lib/haversine.ts`, `scripts/lib/geo.mjs`, `lib/samePubIdentity.ts`, `__tests__/haversine.test.ts`.

**Fully resolved:** yes. One master remains, and the callers compile through the shared cases.
