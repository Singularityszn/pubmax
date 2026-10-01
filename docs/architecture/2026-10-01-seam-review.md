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

## 1743 GET /api/night-signals

**Still true:** yes. No web component fetches this route. A search for `/api/night-signals` in `components/`, `app/` (outside the route file), `e2e/`, `ios/` and `android/` finds no caller. The same string in TypeScript is the route plus three tests. `docs/CAPACITOR_WRAP.md` names `GET /api/night-signals` as the night-signal "went live" broadcast for registered iOS, Android, and web devices: the handler calls `maybeBroadcastNightSignalLive` in `lib/pushSender.ts`. That is a server fan-out, not a screen. `docs/CRON_PLANE_RUNBOOK.md` names the same GET as the feed an approved, in-window candidate joins beside the committed snapshot. The `night-signals/` token in the proxy matcher is the public directory `public/night-signals/` (six SVGs, listed in `lib/staticAssetPrefixes.mjs`). `/api/night-signals` stays on the `/api/:path*` matcher and is not that prefix.

**Seam decision:** keep. Do not delete the route. Do not add a web screen. The module is `GET` in `app/api/night-signals/route.ts`. Depth is one reviewed feed: the committed snapshot and the durable approved rows, merged in that handler. There is no second copy of the read, so there is no second adapter to introduce. The route is the public JSON adapter. Device push and the approved-claim join are callers of that handler.

The interface is the handler. The existing tests already call it the way those contracts describe, so this slice did not add another:

- `__tests__/nightSignalRoute.test.ts` calls `GET` with `entityId` and no durable store. That is the keyless public read: status 200, `version`, `asOf`, `durable: "ready"`, and the short cache window.
- `__tests__/nightSignalFeedApproved.test.ts` calls `GET` after a candidate is saved. An approved, in-window claim is in `claims`; a pending claim, a rejected claim, and an approved claim past its window are not. That is the deletion test for a feed that published an unreviewed row. The committed snapshot (`public/data/night_signals/latest.json`) holds `claims: []`, so the approved row joins an empty snapshot.
- `__tests__/pushEventHooks.test.ts` calls `GET` and asserts `maybeBroadcastNightSignalLive` runs without the response waiting on it. That is the device contract in `docs/CAPACITOR_WRAP.md`.

**Files changed:** none in the route or its tests. This section is the record.

**Fully resolved:** yes. The route stays. The doc cites the device caller and the approved-claim join, and the tests call the handler.

## 1809 GET /api/plans/anchor

**Still true:** yes. The route is still `app/api/plans/anchor/route.ts`. A search for `/api/plans/anchor` in TypeScript and JavaScript finds that file, `__tests__/planAnchorRoute.test.ts` (which imports `GET`), and the Oxford pack assertion in `__tests__/venueIndexTracing.test.ts` (line 252). No component, page, e2e spec, iOS shell, or Android shell fetches it. `components/plan/PlanComposer.tsx` keeps a local `planAnchor` and its fetches are `POST /api/plans/generate` (line 1770), `POST /api/plans` (line 1909), and `PATCH /api/plans/${planId}` (line 1957). That file is on the hard fence, so this run does not wire a caller.

`docs/API_CONTRACTS_THE_LOCAL.md` (line 628) lists `GET /api/plans/anchor` as a keyless contract: rate limit `plan-anchor` (60/60s, hashed per client) and the flat `PublicApiError` envelope. `docs/evidence/cold-start-bundle.md` uses the same GET as a cold-start measurement URL (lines 122 and 156). Line 184 records that the route is permanently reachable and rate limited now that `PUBMAX_ANCHORED_GENERATION` is retired, so it can prove Plan data loading on its own.

**Seam decision:** skip. The route stays. No caller is wired. The module is `GET` in `app/api/plans/anchor/route.ts`, which calls `resolvePlanningAnchor` (`lib/planningAnchor.server`). Depth is that one read-only preflight. There is no second copy of the read, so there is no adapter to add. Deleting the route would fail the documented contract and the cold-start URL, which is the deletion test this skip refuses. The interface is the handler. `__tests__/planAnchorRoute.test.ts` already calls `GET` the way a keyless client does: a conflict for an unknown venue, a bad query, and the per-IP `plan-anchor` budget. The only in-repo UI caller would be `components/plan/PlanComposer.tsx`, and that file is fenced.

**Files changed:** none. This section is the record.

**Fully resolved:** no. The filed question asked for a wire-or-delete call. The contract and the measurement URL keep the route, and the fenced composer is the caller that was not wired. A skip is not fully resolved.

## 1742 GET /api/contributors

**Still true:** yes. `app/contributors/page.tsx` (line 23) calls `enrichContributorBoard(await readContributorLeaderboard())`. `app/api/contributors/route.ts` (line 11) calls the same expression. Both import those two functions from `lib/contributorLeaderboardStore.ts`. There is no second copy of the read. A search for `/api/contributors` in TypeScript and JavaScript finds the route and `__tests__/contributorLeaderboardRoute.test.ts` (which imports `GET`). No component, page, e2e spec, iOS shell, or Android shell fetches the path. `components/contributors/` renders the board the page already loaded. It does not call the route.

**Seam decision:** keep. Do not delete the route. Do not add a client fetch of this app's own route. Do not invent a mobile caller. The module is `readContributorLeaderboard` and `enrichContributorBoard` in `lib/contributorLeaderboardStore.ts`. Depth is one board: the durable all-time aggregate when Supabase is configured, otherwise a degraded empty board, then avatar URLs on a ready board with entries. Two adapters sit on it, and both call it the same way:

- `app/contributors/page.tsx` is the server adapter. It passes the board to `ContributorRecord`.
- `app/api/contributors/route.ts` is the public JSON adapter. `GET` returns that board through `jsonNoStore`.

The interface is that call. `__tests__/contributorLeaderboardRoute.test.ts` calls `GET` the way a keyless client does. Process-memory price logs, Visit Reports, and weather Recommendations stay off the body, and an empty keyless read is `status: "degraded"` with `entries: []`. That is the deletion test for a route that invented a second tally from process memory. The page does not fetch the route, so a client fetch was not added.

**Files changed:** none. This section is the record.

**Fully resolved:** no. The filed question asked for a human wire-or-delete call. The page and the route already share one module, so this run settles the seam and leaves both adapters. A keep of that kind is not fully resolved.

## 1709 Convex migration shadow comparison

**Still true:** yes. `lib/convex/migration.ts` still exports `shadowRecordHash` and re-exports `canTransitionMigration` from `lib/convex/migrationTransitions.ts`. `recordShadowComparison` is still the internal mutation in `convex/migrations.ts` (line 70). Its handler inserts one row into `shadowReadComparisons`. A search for that name finds only the export: no app, script, or test calls the mutation. `shadowing` is still a batch status in `lib/convex/migrationTransitions.ts` (`running` may move to `shadowing`, and `shadowing` may move to `verified`) and in `convex/validators.ts`. `docs/architecture/convex-migration-runbook.md` (lines 14 to 18) says the frozen `planCompletions` scaffolding does not authorise import, shadow reads, cutover, dual-write, or a Plan runtime path. Lines 97 to 100 say this repository provides no deploy or import script, and any future migration needs a separately reviewed ticket plus explicit owner approval. The captain applies migrations.

**Seam decision:** skip. Do not edit `convex/**` or `lib/convex/**`. Pub Pal is off limits for this run. Do not drop the `shadowing` state. Do not add a migration. The module is `shadowRecordHash` in `lib/convex/migration.ts`. `recordShadowComparison` is the unused write beside it, not a second copy of the hash. Depth is that hash and that insert, both frozen. There is no second adapter, so this skip adds no port. Wiring a caller would be the shadow read the runbook does not authorise.

The interface is the hash and the transition the foundation test already calls. `__tests__/convexFoundation.test.ts` calls `shadowRecordHash` with two key orders and calls `canTransitionMigration("shadowing", "verified")`. `__tests__/convexContainment.test.ts` pins `shadowReadComparisons` on the grandfathered migration table list. Removing the table or the status would fail that fence, which is the deletion test this skip refuses.

**Files changed:** none. This section is the record.

**Fully resolved:** no. The filed question asked whether to deepen the shadow comparison or delete the scaffolding. The runbook keeps both, Pub Pal is fenced, and a skip is not fully resolved.
