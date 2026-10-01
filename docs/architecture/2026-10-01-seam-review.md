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

## 1646 Bar Tab and Ledger venue reads

**Still true:** it was, until this change. Both `app/bar-tab/[id]/page.tsx` and `app/ledger/[id]/page.tsx` defined `VenueReadResult`, `readVenueDataset`, and `readVenue`, and each parsed `public/data/pint_prices_app_dataset.json` on its own. A search for those three names now finds none. `app/bar-tab/[id]/opengraph-image.tsx` still calls `resolveCanonicalVenueId`. That file was not part of this seam.

**Seam decision:** deepen. The module is `lookupVenueDetail` in `lib/venueDetailIndex.ts`. Depth is one venue read. Two adapters sit on it, and both call it the way `app/api/venue/[id]/route.ts` does:

- `app/bar-tab/[id]/page.tsx` calls it from the page and from `generateMetadata`.
- `app/ledger/[id]/page.tsx` calls it from the page and from `generateMetadata`.

No new port. `missing` renders the existing not-found card. `unavailable` renders the existing read-unavailable surface. The module asks `lookupCanonicalVenueId` first and does not cache a failed read, so the next request reads again. The pages do not call `resolveCanonicalVenueId`. That function turns an unreadable alias file into the original id, and the not-found card would swallow it.

The interface is the page render. `__tests__/venuePageReadUnavailable.test.tsx` calls each page the way a request does. An unreadable alias file on a pub that is already in the dataset answers unavailable, the next request reads the file again, and a missing id still gets the not-found card. A famous-venue seed the old dataset index did not hold (`bar-american-bar-savoy`) now opens. That case is the deletion test for the private dataset reader: the old pages rendered the not-found card for it.

The folded menu enrichment, famous-venue seeds, and harvest overlays can change what a page shows. For the Prospect of Whitby (`venue-16pnwmm`) they did not reach the header, the pint price rows, or the photo wall. Shots and the cold-process times are in `docs/evidence/venue-detail-convergence/README.md`.

**Files changed:** `app/bar-tab/[id]/page.tsx`, `app/ledger/[id]/page.tsx`, `__tests__/venuePageReadUnavailable.test.tsx`, `docs/evidence/venue-detail-convergence/`.

**Fully resolved:** yes. One module remains, both pages call it, the adapted test proves unavailable and missing through the page, and the six before shots and six after shots are recorded.
