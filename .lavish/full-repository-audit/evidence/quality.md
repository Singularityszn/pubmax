# Implementation quality review

Pinned commit: `04b73e834`. Scope: targeted static causal review of discovery, price comparison, What's-On readers, transport, and representative map complexity. No application edits, broad suite execution, or browser walkthroughs performed by this reviewer. Follow-up isolated function proofs cover Q-05 and Q-06. This is not exhaustive semantic review of app/components/lib; coverage JSON distinguishes complete reads from partial traces and structural scans.

## Q-01 [P1] Discover rejects every contemporary music listing

**Confirmed static defect.** `components/discovery/MusicTonightLane.tsx:54-56` calls `.filter(isValidWhatsOnRow)`. Array.filter passes `(row, index, array)`; `lib/whatsOn.ts:177-178` accepts `(value, now = Date.now())`. The row's index therefore overrides the clock. `lib/whatsOnRowShape.mjs:141-143` requires `observedAt <= now`, so any real 2026 listing is rejected against 0-7 milliseconds after epoch. Component returns null with no visible error. Discover mounts the component without provided rows, so this affects its normal path. Tonight's providedRows mode avoids this particular filter.

**Reproduce:** supply one otherwise-valid music response whose observedAt is yesterday to the self-fetching lane. Network succeeds but heading/card never renders. Directly compare `[row].filter(isValidWhatsOnRow)` with `[row].filter(row => isValidWhatsOnRow(row))`.

**Test gap:** `__tests__/musicTonightLane.test.ts` reads source text and asserts API URL, thin-coverage copy, and freshness prop names. It never executes response admission or verifies a visible card. Correct strings coexist with a completely dead feature.

**Remedy:** wrap predicate in a unary callback. Add rendered self-fetch-mode regression with real validator and past observedAt; invalid future rows must remain excluded. Keep source fences only for constraints that are genuinely structural.

## Q-02 [P1] Half-pint and other-measure observations become cheap-pint rankings

**Confirmed static defect.** `app/discover/DiscoverPageClient.tsx:200-209` projects every priced drop into TonightDrop but discards `measure`. Public `GET /api/pint-drops` returns visible non-pint drops too (`app/api/pint-drops/route.ts:616-623`); store DTO explicitly retains the measure (`lib/pintDropsStore.ts:587-600`). `lib/leaderboard.ts:301-314` then admits any finite numeric price within 24 hours. No pint predicate exists in that path.

A real £2.60 **half** becomes a £2.60 entry under "Recently logged cheap pints". The exact same projected rows also feed `computeThenVsNow`, where a half can become a large supposed price reduction. This contradicts the explicit pint-only policy in `lib/drinkMeasure.ts` and `lib/pintDropShared.ts`.

**Test gap:** `__tests__/tonightBoard.test.ts` creates fixtures from TonightDrop, whose type cannot carry the missing measure. Ranking tests cannot expose boundary information discarded before they run. Add API-shaped half/other/pint/legacy fixtures through the actual Discover projection and assert only pint and legacy-pint rows reach pint calculations; preserve half/other on venue observation surfaces.

**Remedy:** retain measure in DTO projection and enforce `measureIsPint` at the canonical ranking/comparison boundary. Never scale half prices into invented pint prices.

## Q-03 [P2] Then-vs-Now reports price movement between different drinks

**Confirmed static semantic defect, independent of Q-02.** `lib/thenVsNow.ts:79-88` compares a venue's cheapest baseline against its most recent priced observation using venueId alone. `lib/discoverBoard.ts:45-49,85-89` retains neither baseline drink identity nor serving; ThenVsNowDrop likewise has neither. Even after removing halves, a baseline £4 house lager and a later £7 premium stout produces "Up £3 (75%)" (`components/discovery/ThenVsNowCard.tsx:43-48`) although no drink's price changed. Ranking by absolute delta promotes precisely these unlike comparisons.

**Test gap:** arithmetic tests validate this computation but never assert comparability. They encode venue equality as sufficient evidence.

**Remedy:** either preserve drink/serving identity and date in both observations and calculate movement only for comparable observations, or change the feature into explicitly separate observations without delta/percentage/increase claims. Unknown identity must not imply comparability. This requires a product decision on whether actual historical price movement is a supported promise.

## Q-04 [P2] Expired deals stay painted while Discover is idle

**Confirmed static lifecycle gap; browser proof pending.** `components/discovery/DealsTonightLane.tsx:98-106` re-reads Date.now only during render. Its own state changes solely on initial cache/network loading, its effect depends only on `provided`, and Discover supplies no ticking clock. After requests settle, a displayed deal can cross endsAt without any React render, retaining "Happening now" and its card until unrelated state changes/navigation. `WhatsOnUrgencyBadge` is also a pure render-time clock read. Comments claim deals leave the lane when they close, but no mechanism schedules that update.

**Reproduce:** deliver a valid deal ending in 30 seconds, wait past expiry without interacting, inspect card/urgency. Use fake timers in a mounted integration test to avoid real waits.

**Remedy:** schedule the nearest relevant start/end transition with cleanup and refresh on visibility restoration; share a bounded clock with urgency captions. Do not add per-card polling or network requests.

## Structural concern: map coordination has outgrown one component

**Measured concern, not an independently proven user defect.** PubMap is 6,610 lines with 98 useState calls and 51 effect/layout-effect calls; PubMapCanvas is 4,270 lines with 37 effects. PlanComposer is 2,319 lines with 26 state calls; AdminClient is 2,606 lines with 42 state calls. Counts are textual structural measurements, not semantic complexity scores.

PubMap keeps opening-location resolution, arrival/session restoration, canvas retry, venue index and detail state, selection notices, price lanes, overlays, and viewport state inside the same orchestration component. Numerous existing extracted leaf policies are a strength, but the parent still owns transitions across all these concerns. More extraction of helpers alone will not resolve ownership.

**Recommendation:** after behavioral regression coverage, separate arrival/session state, map data loading, and visual panel coordination into cohesive controllers with explicit inputs and transition outcomes. Keep canonical venue/filter state in one owner. Preserve URL restoration, selected-venue hydration, and failed-canvas retry journeys while deleting parallel booleans, rather than creating another generic state framework. Do not bulk-refactor during audit.

## Existing concern confirmed, lower priority

`accountOnboardingClient.ts:74-94` and `authedFetch.ts:261-276` repeat abortable delay mechanics; `surfaceDataCache.ts` carries another variation. Their outward contracts differ (boolean refusal versus rejection), so blindly replacing them with one signature risks behavior changes. A shared abort-rejecting primitive plus explicit local conversion is viable if cancellation tests retain each call site's contract. Existing issue #1745 already names the first pair; avoid duplicate work.

## Review limits and positive observations

Q-01 through Q-04 were statically traced here; parent owns independent runtime confirmation. Q-05 and Q-06 have isolated runtime proof below, with fixtures and limits recorded. Parent owns browser coverage and final severity reconciliation. No account or production writes performed. Store measure preservation, public visibility gating, source-specific freshness, durable-store fallback reporting, abort handling, and transient surface retry are substantive existing safeguards. The two discovery bugs arise where those safeguards are lost at consumer boundaries, not from absence of the underlying policies.

## Q-05 [P2] Draft expiry revives its rollback mirror and changes precedence

**Confirmed by isolated execution of production writer, reader, and arbitration functions.** `lib/planDraft.ts:234-244` falls back to V1 whenever V2 is invalid, including expired; `lib/planRouteDraft.ts:461` repeats that policy. Both writers always persist the timeless V1 mirror alongside V2. At TTL+1, a draft created by today's app is therefore reclassified as legacy with unknown savedAt, rather than retaining its known age or expiring. `lib/planDraftArbitration.ts:153-162` gives a legacy Plan time precedence over a newer intake specifically because its age is unknown.

**Observed proof:** a Sept 20 draft read after its 24-hour TTL returns legacy=true and savedAt=null. Writing fresh Sept 21 intake then running actual arbitration selects Sept 20 18:00 rather than Sept 21 19:00. Route draft similarly returns its stop as legacy after its TTL. This proves loss of age and precedence at the persistence boundary; it is not a claim that a stale signed route proof becomes trusted.

**Test gap:** `__tests__/planDraftArbitration.test.ts:168-173` tests expiry with rawV1 explicitly null, although the production writer has just populated it. Migration and expiry are tested separately, missing their composition.

**Remedy:** distinguish absent V2 from rejected/expired V2; do not relabel a known-age mirror as age-unknown legacy. If preserving expired work is desired, retain its expired metadata and show recoverable work without silently preferring yesterday's time. Test roundtrip writer -> TTL advance -> reader -> arbitration, including fresh intake, old-only V1, corrupt V2, and partial storage writes.

## Q-06 [P2] Native Back bypasses document-bound picker dismissal

**Confirmed event-propagation defect using jsdom and actual native Back helper; device behavior still needs emulator proof.** `lib/nativeBackGesture.ts:84-87` dispatches Escape on window. `components/map/PersonaLensPicker.tsx:157-158`, `CitySwitcher.tsx:172-173`, and `ZonePicker.tsx:95-96` attach Escape listeners to document. A window-originating event does not descend into document. Therefore those handlers cannot claim native Back, and the helper falls through to history or another window-level surface handler rather than closing the picker first. Persona picker is rendered in mobile layer controls at `components/PubMap.tsx:5660`.

**Observed proof:** actual dispatchDismissKey and performBackAction with a document Escape listener invoke history once without invoking that listener. A control Escape event dispatched from a button reaches document and is prevented. The listener fixture mirrors picker behavior; no Capacitor plugin or Android emulator was exercised.

**Remedy:** dispatch synthetic keyboard Back through a DOM target whose propagation reaches the same handlers as real keyboard Escape, or consistently register dismissible popovers through the existing shared hook. Verify one Back closes the innermost picker, next Back closes containing sheet, then navigation. Avoid multiple listeners consuming one Back.

## Isolated proof evidence

`artifacts/audit/quality-proofs.mts` executes real production functions with in-memory Storage and jsdom event targets. `artifacts/audit/quality-proofs.json` records assertions and fixture limits. Command: `node_modules/.bin/tsx artifacts/audit/quality-proofs.mts`. Exit 0. No application changes, no broad test suite, no native build or account writes.

## Native release readiness

Pinned committed association files still carry `TEAMID.com.pubmaxx.app` and `REPLACE_WITH_PLAY_APP_SIGNING_SHA256`. These are explicit documented setup placeholders, not newly discovered code bugs. They cannot prove signed universal/App Links or native OAuth return working. Real team/signing identities and device proof remain release requirements. Simulator/browser results cannot discharge them.

## Test inventory, automated classification only

Every one of 1,623 tracked test/spec files under `__tests__` was lexically inventoried. Coverage JSON records filesystem-read, render-call, and direct product-import signals. Classification is heuristic, not semantic review, pass evidence, or an assessment that every source fence is bad. Source/data contracts are useful for generated/native integration and prohibited imports; they cannot alone prove user behavior, as Q-01 demonstrates.

Counts: 171 source/data-contract candidates without recognized product imports or render calls; 315 mixed filesystem-reading and behavior candidates; 203 rendered-behavior candidates without filesystem reads; 868 module-behavior candidates without filesystem reads/render calls; 66 other/indirect cases. Review these as an inventory to prioritize inspection, not as measured code coverage. Existing manually inspected tests retain their stronger status in the same ledger.

## Q-07 [P1] Slim map pins bypass explicit accessibility and amenity requirements

**Confirmed using actual filtering functions.** `lib/filterMapVenues.ts:18-26` turns off garden, low/no, sports, water, heritage and all three accessibility requirements for every venue with `prices: []`. This includes known-false amenity hints as well as unknown access. `components/map/ControlRail.tsx:475` promises that unknown access is hidden; `lib/venueAccessibility.ts` and normal `filterVenues` implement that positive-evidence contract. The map wrapper contradicts it, so checking step-free access can still show venues with no confirmed step-free access. Venues without price rows can remain in this bypass even after other evidence is hydrated.

**Proof:** synthetic slim venue with false garden/low-no/sports hints and no accessibility evidence returns zero matches through filterVenues, one through filterMapVenues for each of requireBeerGarden, requireNonAlcoholic, requireLiveSports, requireStepFree, requireAccessibleToilet, requireSeatedService. Existing filterMapVenues tests exercise food/cocktails but omit these constraints.

**Remedy:** preserve explicit evidence requirements for slim pins, using available slim hints; unknown accessibility must fail the facet rather than be assumed. If detail hydration is needed, expose loading/unknown state without presenting unmatched venues as filtered results. Test both no-price and priced cohorts with true/false/unknown evidence.

## Q-08 [P2] Native Back requests navigation twice when map planner/detail is open

**Confirmed hook/helper interaction, native browser scheduling untested.** `components/map/pubmap/useMapKeyboardShortcuts.ts:46-55` consumes Escape by calling dismissLogIntent/onBack but never prevents default. PubMap wires onBack to surface navigation (`components/PubMap.tsx:4041`), whose back operation requests browser history. `lib/nativeBackGesture.ts` then sees an unclaimed event and requests history again. This differs from Q-06: here the window listener does run but fails to claim its action.

**Proof:** render actual keyboard hook with planningOpen=true in jsdom, run actual performBackAction/dispatchDismissKey, and count navigation callbacks: two requests. Callback stands in for the traced surface-history operation; whether a particular browser coalesces those requests or skips two entries needs device proof. The log picker path can also dismiss the picker then navigate.

**Remedy:** claim Escape whenever handling it, and test native Back against active map surfaces and nested controls. One event must produce exactly one dismissal or history transition.

## Q-09 [P2] Blocked storage crashes even an empty map persistence effect

**Confirmed actual hook mounted in React.** `components/map/pubmap/useBuiltIdsPersistence.ts:9-14` accesses localStorage and removes/writes a key without a guard. PubMap mounts this hook unconditionally at `components/PubMap.tsx:3202`. A browser rejecting localStorage access throws SecurityError even with zero built stops; quota failures can throw on writes. `lib/safeStorage.ts` already defines the intended graceful fallback but this extraction bypasses it.

**Proof:** localStorage getter fixture throws SecurityError. Mounting the actual hook with [] causes a React error boundary to catch SecurityError. This proves effect failure, not a browser-specific storage policy; no real user storage was touched.

**Remedy:** use existing safe storage boundary for both getter access and mutations. Preserve usable map and in-memory plan when persistence unavailable. Test denied storage and quota write failures against hook behavior.

Extra proof command: `node_modules/.bin/tsx artifacts/audit/quality-extra-proofs.mts`; exit 0. Results and fixture limits in `artifacts/audit/quality-extra-proofs.json`.

## Additional navigation and performance review limits

Read map seed/URL hydration, first-pin scheduling, warmup, secondary stream hold, offline cache and filter/navigation helpers. Abort/cancel boundaries are present across these seams; inspection does not prove every React ordering. `alt=mocktail` is explicitly a separate kind-of-night label, while `low=1` sets low/no constraint, so the drink selector retaining its default Pints is not independently classified as a defect. Q-07 remains a separate filtering defect.

Potential hypothesis requiring user journey reproduction: mapSurfaceOpenTransition revisiting a lower surface pushes browser history while keeping logical stack length unchanged; home navigates by negative logical length. A repeated-surface path may therefore fail to reach root. Not promoted to confirmed finding: reachability and actual popstate sequence remain unproved.

Performance boundaries reviewed at source seams (map first-pin stream policy, deferred secondary stream release and bounded warmup deduplication). Route-budget metadata inspected, but no performance measurements run in this lane. Existing budgets and source fences alone do not establish production performance. Parent owns executed performance/build evidence.

## Parent-suite failure triage, unresolved

Read complete e2e/desktop-map-chrome-fit.spec.ts and e2e/drawer-route-chip-reachable.spec.ts plus current error contexts. Reduced-motion failure had already passed planner hidden, venue shown and single-open-drawer assertions, then timed out requesting closed planner boundingBox. SpringDrawer source keeps desktop wrapper mounted, so this is not clearly a stale selector. Planner/venue Back case exhausted 120 seconds with venue shown and Back to Plan an outing present; snapshot alone does not identify failed action. Route-chip click found visible/enabled/stable last-train button and stalled after scrolling into view; keyboard predicate and Hide focus-return also timed out. These are real failed checks, but current evidence does not distinguish resource contention, browser responsiveness/focus interaction, and product defect. Parent will run isolated checks. No new confirmed finding from these snapshots and no app/test modifications.

### Q-07 reachability challenge resolved: desktop planner, not phone Filters

Current mounted control path: desktop MapToolbar Plan an outing (`components/map/MapToolbar.tsx:413`, wired at `components/PubMap.tsx:6211`) invokes togglePlanning/openPlanning (`:2068-2097`), setting planningOpen=true. plannerPanel (`:5147`) mounts ControlRail only when !mobileViewport (`:5157-5162`) with current filters and setFilters. Its Accessible venues section is unconditional (`components/map/ControlRail.tsx:471-508`); Step-free entry sets requireStepFree at :485, Accessible toilet sets requireAccessibleToilet at :495. The two lens wrappers at `lib/mapExperienceLens.ts:49-64,98-115` preserve those fields, and `components/PubMap.tsx:2814` then calls filterMapVenues. No stylesheet rule targeting accessibilityFilters hides it. Thus Q-07 is reachable from the desktop planner. Phone Filters does not mount these controls; the defect must not be described as a phone accessibility-toggle failure. Browser interaction remains parent-owned; this is complete source-path evidence plus earlier production-filter seam proof.

Q-09 rechecked: exact unguarded operations are localStorage.setItem at `components/map/pubmap/useBuiltIdsPersistence.ts:11` and removeItem at :13, reached by unconditional `components/PubMap.tsx:3202`. No guard surrounds effect execution.

## Bounded CI, generation, and native entrypoint pass

No new confirmed application defect promoted in this pass. This is source/side-effect review, not an executed CI/native release result.

- `package.json` makes verify a mutating local gate: validate-data's prehook rebuilds slim/city/seed/UK outputs, and build additionally copies MapLibre worker modules and writes Discover board. canonicalize:venues can rewrite committed price data and cumulative aliases. Running these against a live-serving checkout can expose intermediate output; use isolated checkout/output, as parent does.
- `scripts/canonicalize_venue_dataset.mjs` preserves existing aliases, fails on malformed prior JSON, and publishes aliases before canonical dataset using atomic per-file renames. Its imported matching algorithm was not reviewed in this pass.
- London slim generator publication section (`scripts/build_slim_index.mjs:813-846`) writes manifest before removing/replacing old cell files. Interrupted generation or concurrent serving can see partial output. This is a local build/development operational concern, not proven production deployment defect; Vercel immutable completed builds are a different publication boundary. UK base publication stages a directory and carries source fetchedAt/pub/bar counts before calling its publication helper. That helper and complete generators remain unreviewed here.
- Discover board generator imports production grouping/ranking, uses dataset observation date rather than build clock, refuses empty ranks/baselines, and writes public/data/discover/board.json. MapLibre copy script copies two worker modules directly from installed maplibre-gl to public/vendor/maplibre; package-lock and library provenance belong to dependency review, not evidence of manually reviewed vendor code.
- CI separates unit, coverage, RLS and production build. Main CI has no validate-data/deadcode/resilient-audit step equivalent to local verify; do not equate a green CI workflow with full local verify. Browser workflow runs selected law journeys on PR/push; full five Chromium projects run only schedule/manual, so PR green is not whole-browser-suite evidence. No native build job was present in inspected workflows. Performance workflows were inventoried but not read in this pass.
- RLS runner refuses missing PostgreSQL by default; PUBMAX_RLS_ALLOW_SKIP=1 explicitly admits a skip. This entrypoint does not itself inspect Vitest's executed/skipped counts after spawning; individual harness and parent run evidence still matter. No databases were started in this lane.
- e2e:seed loads local environment and creates an admin Supabase client; its policy permits remote Supabase when run locally with explicit PUBMAX_E2E_LOGIN and development environment. The CI remote prohibition is not a universal local-production safety fence. Thus do not invoke this command merely because the app origin is localhost. Parent's audit remains production-read-only; a disposable database and explicit target isolation are required. Only seed entrypoint/policy reviewed, not full teardown mutation traversal.
- Native build scripts synchronize Capacitor, so they modify generated native configuration/plugin manifests. Android command assembles debug APK and JVM unit tests; iOS script builds Debug iphonesimulator with CODE_SIGNING_ALLOWED=NO. These cannot establish release signing, APNs, verified links, OAuth roundtrip, or production privacy declarations. Android deliberately builds without Firebase/upload-key and logs that resulting push/signing capability is absent. Existing placeholder association identifiers remain release setup blockers, not fabricated runtime passes.
- capacitor.config.ts defaults to remote production origin but accepts PUBMAX_NATIVE_SERVER_URL at sync time; release operator must verify generated binary configuration has production origin and no local override. Bundled offline.html is configured for main-frame failure. No signed archive/device/emulator execution performed here.

### Generator coverage explicitly incomplete

Complete script reads in this pass: canonicalize_venue_dataset.mjs, build_discover_board.mjs, copy_maplibre_worker.mjs, rls/run-session-tests.mjs, android/build.mjs, ios-simulator.mjs. Partial provenance/publication reads only: build_slim_index.mjs, build_city_slim_index.mjs, build_pubmaxxing_seed.mjs, build_uk_base_shards.mjs. Not semantically reviewed here: build_uk_place_index.mjs, build_uk_pub_search_index.mjs, build_london_venue_shards.mjs, build_london_desk_index.mjs, build_price_estimate_baselines.mjs, build_heritage_listings.mjs, build_uk_price_bundle.mjs, build_price_bands.mjs, build_pint_index_snapshot.mjs, export_app_dataset_json.py, gen-native-app-icons.mjs, gen-brand-assets.mjs, gen-store-screenshots.mjs, fetch/harvest/refresh/enrichment families and generator helper modules. Other review lanes may cover portions; reconcile their ledgers before assigning whole-project status. Generated output filenames and origin comments are provenance leads, not complete generator correctness proof.

### Q-04 independent mounted-component proof

Actual DealsTonightLane mounted in React/jsdom with one production-validator-approved supplied row, ending one minute after synthetic initial clock. Node's built-in mock timers advanced Date/setTimeout/setInterval by two minutes. The lane still contained the expired deal and “Happening now”. Forcing a parent rerender at that same later clock removed the lane completely. Network calls: zero. Next Link, urgency badge, production validators, and all deal decisions remained real; CSS imports alone were replaced with empty presentation modules. Parent Tonight/Discover components were not mounted, so incidental parent rerenders can refresh sooner; this proves the lane does not independently retire an idle expired deal, not that every full-page session retains it indefinitely.

Evidence: `artifacts/audit/quality-deal-expiry-proof.mts` and `.json`. Command `node_modules/.bin/tsx artifacts/audit/quality-deal-expiry-proof.mts`, final exit 0. Initial harness attempts encountered absent optional fake-timer package and missing jsdom self global; final harness uses Node mock timers and browser self alias. No dependency installation, tracked test, application edit, or browser suite.
