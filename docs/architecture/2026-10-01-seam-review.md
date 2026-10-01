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

## 1691 Email provider configured check

**Still true:** yes, for the delivery seam. `docs/EMAIL_DIGEST.md` says delivery is `lib/emailProvider.ts`, the no-op stays active until keys, and nothing is sent today. `resendEmailProvider.send` still throws (`lib/emailProvider.ts`). `.github/workflows/weekly-digest.yml` still comments out the Monday cron (`schedule:` is commented). What is no longer true: `scripts/send_weekly_digest.mjs` no longer defines its own `isEmailProviderConfigured`. That local function duplicated `isResendConfigured` because the script cannot import TypeScript. A search for `process.env.RESEND_API_KEY && process.env.EMAIL_FROM` finds the boolean only in `lib/emailProviderConfigured.mjs`.

**Seam decision:** partial deepen. The module is `lib/emailProviderConfigured.mjs`, plain ESM, with the `lib/emailProviderConfigured.d.mts` sidecar (the `lib/brandMark.mjs` pattern). Depth is one boolean: both `RESEND_API_KEY` and `EMAIL_FROM` are non-empty. Two adapters sit on it:

- `scripts/send_weekly_digest.mjs` imports `isEmailProviderConfigured` and gates the batch on it.
- `lib/emailProvider.ts` `isResendConfigured` is the typed view. `selectEmailProvider` and `resendEmailProvider.send` call that view.

The interface is that check. `__tests__/emailProvider.test.ts` calls `isEmailProviderConfigured` the way the script does: both keys absent, and both keys set. The same cases through `isResendConfigured` are the deletion test for a second copy of the boolean. HTTP stays unimplemented. The send method still throws. No mail is sent. The cron stays off.

**Files changed:** `lib/emailProviderConfigured.mjs`, `lib/emailProviderConfigured.d.mts`, `lib/emailProvider.ts`, `scripts/send_weekly_digest.mjs`, `__tests__/emailProvider.test.ts`.

**Fully resolved:** no. The HTTP transport stays a stub on purpose.
