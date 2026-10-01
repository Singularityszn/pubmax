# V0 recovery receipt

Recorded 30 September 2026. The R14-R17 local production build used `ab1b289da`, including account recovery (`1afa4c1fd`), remembered Near-me location recovery (`81603cb19`), permanent native permission coverage (`b6eb0b680`), warm measurement residue cleanup (`985058033`), and immediate Map key rendering (`ab1b289da`). R14 evidence was also captured on a build based on `cdd45bd6a` with the account split then uncommitted. The fresh R18 local production build used committed test head `5de246205` plus uncommitted R18 production changes and served on port 3351 ([build log](r18-build-server.log)). These are local builds, not releases. The wider recovery remains open.

## Source change

`AuthProvider` imports [`AccountOnboardingHost`](../../../components/identity/AccountOnboardingHost.tsx) directly. The eager host owns onboarding status, status load cancellation, the CSS import, and focus handling. Its dialog frame stays mounted while the form chunk loads or fails. Only the input fields load through the dynamic import. The reconnect path reloads automatically only when `hasUnsavedUserInput(document)` is false.

[`AccountOnboarding.tsx`](../../../components/identity/AccountOnboarding.tsx) keeps its compatibility exports: default host, `AccountOnboardingLoadError`, `canSubmitCheckedHandle`, and synchronous `AccountOnboardingForm`.

## Current source checks

- Focused account and auth suite: 12 files, 148 tests passed. Log: `/tmp/pubmaxx-account-form-focused-r4.log`.

  ```sh
  ./node_modules/.bin/vitest run __tests__/accountOnboardingPresentation.test.tsx __tests__/accountOnboarding.test.ts __tests__/accountOnboardingRace.test.ts __tests__/authProviderBootstrapRace.test.tsx __tests__/authCallbackConfirmation.test.tsx __tests__/contributionAuthProvider.test.ts __tests__/privateIdentityEditor.test.ts __tests__/voiceComplianceAudit.test.ts __tests__/accountBoundFetch.test.ts __tests__/useReconnectRecovery.test.ts __tests__/deploymentSkewRecovery.test.ts __tests__/focusTrapVisibility.test.ts > /tmp/pubmaxx-account-form-focused-r4.log 2>&1
  ```

- ESLint on the host, frame, and browser spec plus global TypeScript check passed. TypeScript output: `/tmp/pubmaxx-account-form-r14-types.log`.

  ```sh
  ./node_modules/.bin/eslint components/identity/AccountOnboardingHost.tsx components/identity/AccountOnboardingFrame.tsx e2e/account-onboarding-chunk-recovery.spec.ts && ./node_modules/.bin/tsc --noEmit > /tmp/pubmaxx-account-form-r14-types.log 2>&1
  ```

- `next build` completed and local `next start` served the result on port 3351. Log: `/tmp/pubmaxx-persistent-recovery-r14.log`. The build used the local deployment version. It is not a release.

  ```sh
  node /tmp/pubmaxx-start-recovery.cjs
  ```

- The browser recovery spec passed against the production build at 390 px and 1440 px. It finds the real form script by its `accountOnboardingHandle` response body. It fails every form-script request in the first document, then verifies reload recovery. The authenticated status read runs before the form chunk. `AuthProvider` restores the same bearer token after reload without another fixture seed. The test captures a POST with that bearer and a body containing only `handle`. Blank optional fields are omitted. The browser uses auth and HTTP doubles, not a real identity provider.

  ```sh
  PW_PORT=3351 PW_SKIP_WEBSERVER=1 npm run test:e2e -- e2e/account-onboarding-chunk-recovery.spec.ts --workers=1 --project=chromium --output=/tmp/pubmaxx-account-chunk-browser-r14-results
  ```

  Log: `/tmp/pubmaxx-account-chunk-browser-r14.log`.

## Scoped resource measurements

The host-local R14 fixture reuses the project performance helpers and initial Chromium storage state. It measured three rendered routes and two redirects, not the full route set.

```sh
PW_PORT=3351 ./node_modules/.bin/tsx /tmp/pubmaxx-perf-scoped-fixture.mjs r14-fixture > /tmp/pubmaxx-r14-perf-fixture.log 2>&1
```

All five home samples measured 1,010 KiB decoded JavaScript and 45 requests. The home ceiling remains 1,010 KiB and 46 requests. `/tonight` measured 1,226 KiB and 62 requests, with CLS 0.0177. `/social?tab=discover` measured 1,282 KiB and 65 requests, with CLS 0.0384. `/discover` and `/drinks` each redirected with status 308, one request, and zero decoded JavaScript. Raw output: `/tmp/pubmaxx-r14-perf-fixture.log`. Structured samples: `/tmp/pubmaxx-perf-scoped-r14-fixture.json`.

The scoped probe visits Home, Tonight, then discovery. The full gate visits additional routes first. Both use the same measurement helpers and readiness boundary; their resets retain service-worker and cache state. In R8, the full gate measured Tonight at 1,024 KiB and discovery at 1,080 KiB, while the scoped probe measured 1,284 KiB and 1,340 KiB. That earlier 260 KiB gap matches the scoped Supabase and outbox chunks. Cache and timing effects are a possible cause; the saved full-gate log cannot prove which resources fell outside its boundary. The scoped R14 figures alone do not establish a new regression or predict the full-gate verdict.

## Map before evidence

The preserved R14 production build reproduced the stale-location bug at 390 px. Chromium's actual permission state was `granted`; its simulated current fix was `[-0.09, 51.515]`. The fixture seeded a six-day-old saved viewport and a 24-hour-old remembered fix at `[-0.21, 51.54]`. One `getCurrentPosition` call and one location watch ran. The saved fix and camera stayed at the old position. The reader dot received the current coordinates in its source, but had no rendered point in that view. Seven map marks remained tappable; no uncaught page errors occurred.

[Readings](map-before-r14.json) and [screenshot](map-before-r14.png) capture the result. The driver served the original committed `map-first-paint-init.js` through one route override, because public files otherwise come from the already-ported source tree. The compiled map component came from the preserved build. This proves the old browser behaviour, not physical-device GPS or the new port.

The first temporary-directory run failed to resolve the project's TypeScript alias before any browser launched. Supplying `TSX_TSCONFIG_PATH` fixed that harness issue; the diagnostic then exited zero. Its command was:

```sh
TSX_TSCONFIG_PATH=/Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/tsconfig.json node --import /Users/karanmanoharan/.codex/worktrees/v0-integration/pubmaxx/node_modules/tsx/dist/loader.mjs /tmp/pubmaxx-location-browser-r14-before.mjs http://localhost:3351 --diagnostic --timeout-ms=30000
```

The before browser closed and its owned production server exited after SIGTERM.

## Map after evidence

The fresh R15 production build includes `81603cb19`. The strict comparison used the same saved state and simulated fix, without an old-script override. Actual Chromium permission queries confirmed each state. The driver exited zero; all contexts closed. Log: `/tmp/pubmaxx-map-after-r15-browser.log`.

| Permission | Automatic position calls / watches | Remembered fix | Camera | Tappable marks |
| --- | --- | --- | --- | --- |
| Granted | 2 / 1 | Fresh `[-0.09, 51.515]` | Fresh fix, zoom 16 | 8 |
| Denied | 0 / 0 | Expired fix removed | Saved view retained | 7 |
| Prompt | 0 / 0 | Expired fix removed | Saved view retained | 7 |

The granted reader dot rendered at the fresh fix. An explicit Near-me tap in the denied state made one native request, showed the permission-denied message, and kept seven tappable marks. All three states had zero uncaught page errors. [Readings](map-after-r15-location-browser.json), [granted](map-after-r15-location-granted.png), [denied](map-after-r15-location-denied.png), [prompt](map-after-r15-location-prompt.png), and [denied tap](map-after-r15-location-denied-tap.png) preserve the result. This proves simulated browser geolocation and rendered UI, not physical-device GPS.

The eight focused map files passed 186 tests. Scoped lint and global TypeScript passed after moving the existing camera-ownership predicate into `lib/pubMap.ts`, preserving its Boolean semantics. Logs: `/tmp/pubmaxx-map-port-{green,lint,types}-r15-r2.log`.

## R15 full-gate evidence

`npm run verify` passed in R11 on the production source now committed in R15. Log: `/tmp/pubmaxx-recovery-full-verify-r11.log`. It recorded 18,518 tests passed and 6 skipped, 82.8% statement coverage, 475 PostgreSQL RLS tests, and two separate shared-memory runs with 10 tests each. Lint reported 17 existing complexity warnings and zero errors. Freshness still reported stale `area_news`; `night_signal_candidates`, `weather`, and `whats_on` could not be measured without credentials.

The full 47-route performance gate passed against R15 with unchanged budgets and measurement boundaries. Log: `/tmp/pubmaxx-final-perf47.log`; results: `/tmp/pubmaxx-final-perf47-results`.

| Route | Decoded JavaScript (KiB) | Requests | LCP (ms) |
| --- | --- | --- | --- |
| Home | 1,010 | 45 | 508 |
| Map | 3,197 | 134 | 184 |
| Tonight | 966 | 55 | 172 |
| Discovery | 1,021 | 55 | 196 |

Home measured identical JavaScript and request counts in five samples. The full gate passed in 11.9 minutes. The higher scoped Tonight/discovery figures above remain separate evidence; they did not predict this full-session verdict.

## Warm Map regression

The R15 default five-sample CWV sweep completed in 17.1 minutes with one failed test. Every mobile warm Map sample failed to exercise More, so its reported 16 ms INP was not a valid interaction measurement. Median LCP was 11,584 ms and CLS was 0.531. [Full log](cwv-before-r15.log) preserves all route and product timing samples.

The attributed browser pair then reproduced the cause using the same mobile throttles and helpers. Inherited layers state measured LCP 11,980 ms, CLS 0.531, and no successful primary action. At 11.3 seconds, the sheet moved from y=572/height=272 to y=82/height=762 as the delayed Map key body appeared. Clearing only the preceding More action's saved `openSheet` preserved warm cache and other session fields: LCP 1,184 ms, CLS 0.007, and an actual trusted More click. [Readings](map-warm-before-r15.json), [restored sheet](map-warm-before-r15.png), and [cleared action residue](map-warm-cleared-r15.png) preserve the comparison.

Two separate changes address this. MapKey now imports with PubMap so restored controls can paint their body without an empty chunk boundary. Product sheet restoration remains unchanged. The CWV fixture clears only saved `layers` intent for exact `/map`, matching its existing warm-cache-only contract; other sheet intent, camera, filters, rows, unrelated storage and caches remain intact. Nine unit cases captured one expected failure on the original helper, then passed after the fix. The four focused files passed 46 tests; scoped lint and global TypeScript passed. The fresh R16 production build passed the same attributed pair. Restored layers intent remained `layers`, with LCP 10,192 ms and CLS 0.007. The automatic restore correctly keeps the underlying More button blocked by the modal; that diagnostic INP floor is not an interaction result. The cleared-residue arm made a trusted More click and measured LCP 2,620 ms, CLS 0.007 and INP 72 ms. Both showed the full Key body and the same final 633.7 px sheet height. [Readings](map-warm-after-r16.json), [restored sheet](map-warm-after-r16.png), and [clean warm start](map-warm-cleared-r16.png) preserve this after proof. Restored controls remain slow under the simulated slow-4G profile; no claim that this load meets the 2.5-second target is made.

Fresh full `npm run verify` R12 passed on this source before its commits: 18,527 tests passed, 6 skipped, 475 RLS tests, separate shared-memory 10+10 tests, and 82.8% statement coverage. Lint remained at 17 existing complexity warnings and zero errors. Log: `/tmp/pubmaxx-recovery-full-verify-r12.log`. R16 completed the production build and served on private port 3351. Its fresh 47-route performance gate passed in 12.0 minutes with unchanged budgets. [Full output](perf47-after-r16.log) records the five Home samples at 1,010 KiB and 45 requests, Map at 3,202 KiB and 133 requests, Tonight at 966 KiB and 55 requests, and discovery at 1,021 KiB and 55 requests. Map adds 5 KiB of decoded JavaScript and removes one median request versus R15; the Home figures remain identical. The first R16 default five-sample CWV run passed two tests in 15.2 minutes under the original validity guards. [Output](cwv-legacy-guard-r16.log) is historical diagnostic evidence. It measured warm mobile Map at LCP 1,204 ms, INP 80 ms and CLS 0.007, and first painted mobile pins at 11,055 ms. The stricter guard rerun passed two tests in 15.4 minutes. [Full output](cwv-strict-after-r16.log) and [measured table](cwv-strict-after-r16.json) preserve the result. All 90 route samples exercised their primary actions and had finite, non-negative readings. All product timing samples passed the same validity checks. Warm mobile Map measured LCP 1,188 ms, INP 88 ms and CLS 0.007. Mobile first pins took 11,027 ms, selected venue details 8,292 ms, editable plans 1,685 ms and acknowledged saves 1,207 ms. These are median local measurements; map readiness and direct venue details remain slow. The full five-project browser suite completed with 1,283 passed, six failed and 24 skipped in 24.8 minutes. [Full log](five-project-before-repair.log) and [six failure artifacts](five-project-failures/) preserve the run. The keyboard zoom test expected fewer than 135 rows and observed 221; it failed before reaching the kind filter. Four wine/cocktail primary and backup journeys timed out waiting for a conditional Night Mode exit while the full route was already present. Home smoke expected a Demo label instead of the current named listed-price attribution. At that R17 snapshot, source-only test repairs were drafted; focused browser reproduction and a fresh full-suite run remained required. The R18 results below update that status. [Failure context](venue-list-failure-context.md) preserves the actual browser result. Source diagnosis suggested changing streamed inventory might invalidate the count assumption, but focused browser reproduction was still required at that point. The suite was not green at that snapshot.

The four permanent native-location cases passed against R15 in 10.4 seconds. The first run had two fixture failures: detaching CDP before navigation reset the granted and denied overrides to prompt. Keeping the session until context teardown fixed that fixture issue; actual permission queries and native calls remain exercised. Logs: `/tmp/pubmaxx-map-permanent-r15{,-r2}.log`.

## Performance sample validity

Guard-only commit `58d6b5f84` rejects invalid samples before a median can hide them. Every vital sample must have a successful primary interaction and finite, non-negative readings. Product timings use the same validity rule. Empty sample sets fail. Present measured rows containing NaN, Infinity, negative, null or missing metrics fail; deliberately absent rows in partial sweeps remain unmeasured, and valid zero readings remain accepted. Budgets, tolerances, throttles, sample counts and measurement timing are unchanged. At that guard-only snapshot, the production app build remained `ab1b289da`.

The original aggregation and comparison paths produced [40 expected failing vital cases](cwv-vitals-validity-red.log) and [13 expected failing product timing cases](cwv-product-validity-red.log). After repair, [92 focused tests passed](cwv-validity-green.log). Independent source review found no concrete issue. Fresh full `npm run verify` R13 passed: 18,583 tests, six skips, 475 RLS tests, separate shared-memory 10+10 tests, and 82.81% statement coverage. Lint reported 17 existing complexity warnings and zero errors. Log: `/tmp/pubmaxx-recovery-full-verify-r13.log`.

## Full-browser repair evidence

This section records the R17 snapshot. Its open bars and focus findings were addressed locally in R18 below; the R17 five-project results remain historical.

The first five-configuration run failed: 1,283 passed, six failed and 24 skipped out of 1,313 cases. Its [full log](five-project-before-repair.log) and six failure contexts remain preserved. All four wine/cocktail journeys saved and reloaded correctly, then waited for a Night Mode exit button outside the active window. Home expected an obsolete Demo label. The map case captured 135 initial rows and expected fewer after zoom, but secondary inventory joined and produced 221 rows.

The unchanged primary-browser diagnostic found correct membership after native zoom. A controlled network schedule then reproduced the exact 135-to-221 count failure using real secondary response bodies released unchanged. Service workers were blocked only in that attribution run so the route interceptor owned the network schedule. Camera zoom advanced from 12 to 15. Every original coordinate was accounted for; 118 original rows moved outside and disappeared, with no original outside row left. Bars off removed all three curated bar rows while 63 unpriced base bars remained. Source review confirmed separate data-layer wiring, but found no reader-facing exception to the generic Venue types control. That product inconsistency remained open in the R17 snapshot; R18 applied kind visibility across both layers, as recorded below. [Default readings](map-list-default-r17.json), [controlled readings](map-list-controlled-stream-r17.json), [zoom screenshot](map-list-controlled-stream-r17-after-zoom.png), and [filter screenshot](map-list-controlled-stream-r17-after-filter.png) preserve that historical evidence. Full raw traces remain in the ignored artifact archive named by each receipt.

Three test-only repairs stabilized the covered contracts in the R17 snapshot; the broader base-bar filter inconsistency was not fixed by them at that point. Map now requires settled native zoom, a nonempty set of original points outside the viewport, their exact removal, changed membership, actual curated bar removal and a retained pub. Plan waits for the member route, then waits for and exits Night Mode when the saved start time falls inside the product window. Every price-source, save, reload, backup, PATCH and swap assertion remains. Home checks the named answer article, price, drink, publisher, collection date and exact decoded source path, including empty query and fragment. The first focused run passed 30 cases and rejected equivalent encoded commas in that last URL assertion. The corrected [focused rerun passed all 31 cases](core-focused-after-r17.log), including adjacent Night Mode and mobile controls. Scoped lint reported zero errors and zero warnings. Production source and build were unchanged at that R17 snapshot.

Fresh `npm run verify` passed after these R17 repairs: 18,583 tests, six skips, 475 disposable PostgreSQL RLS tests, separate shared-memory 10+10 cases, TypeScript, dead-code, skip and dependency gates. Global lint had 17 warnings and zero errors; the three changed browser specs had zero warnings. Statement coverage was 82.8%. [Full source log](source-verify-after-r17.log) preserves the result. Commit `5de246205` contains only those three browser test files. The R17 production build was `ab1b289da`. The fresh five-configuration run finished in 20.8 minutes: 1,288 passed, one failed and 24 skipped. All six original failures passed. [Full output](five-project-after-test-repair-r17.log) and [drawer failure context](drawer-focus-failure-r17.md) preserve the remaining failure. The suite was not green at that snapshot.

## Drawer focus attribution

The remaining full-run failure occurs before opening the drawer: a live `.first()` locator changes its target when secondary venues arrive. A normal diagnostic passed both the original and stable-ID arms, so it alone did not reproduce the race. A controlled schedule then held real secondary responses until Museum Tavern was focused and released their bodies unchanged. Service workers were blocked only to make the route interceptor own that schedule. In the original arm, the first row changed from Museum Tavern to Dolphin Tavern as the list grew from 135 to 1,081 and then 2,917 rows. Museum Tavern stayed connected, unblocked, focused and at the same DOM identity 8 throughout the failed assertion. Native focus was not lost.

The stable-ID arm changed only locator identity before focus. It passed chosen focus, drawer Close focus and Escape returning to the exact Museum Tavern row, with DOM identity 6 retained. [Normal receipts](drawer-focus-default-r17.json), [controlled receipts](drawer-focus-controlled-stream-r17.json), [original failure screenshot](drawer-focus-controlled-stream-r17-original-failure.png) and [stable-ID screenshot](drawer-focus-controlled-stream-r17-stable-id.png) preserve the distinction. Exact raw traces are retained in the ignored archive paths named by the receipts. The R17 permanent test repair was still a draft at that snapshot. R18 applied stable venue identity and passed the focused browser suite below; the full five-project rerun remains pending.

## R18 local map and recovery proof

R18 before logs captured the remaining map and hook failures. The GL case first confirmed a painted and tappable pub and bar, then Bars off left 64 UK base bar rows in the list; a separate outside-banner path reached the base-led state with Filters absent ([rows](r18-rows-before.log), [GL cases](r18-gl-before.log)). The screenshot is after the Bars-off interaction and is not the before-failure evidence ([IAB after screenshot](r18-bars-off.png)). The two streaming-hook tests also failed when a pending read settled after a kind change and when city and kind changed together ([before](r18-hook-before.log)). The local source repair now applies kind visibility across curated and UK base layers, preserves the base-led filter controls after pan, and keeps current kind policy when asynchronous reads settle.

The final focused browser run passed all 13 cases in 1.3 minutes. It covers streamed list membership, base and curated kind chips, cold bar restoration, painted-mark hide and re-enable assertions, base-led controls, and stable-ID drawer focus ([final log](r18-focused-browser-final.log)). The first run had 12 passes and one failure in the second-pub price scenario ([initial log](r18-focused-browser-initial.log), [failure context](r18-focused-browser-initial-failure.md)). The product's half-height sheet correctly blocked opening another pub. The permanent test now expands the sheet before entering £9.90, collapses it, performs a native header-drag peek, then opens another pub while checking that the original sheet remains connected. The full-to-half-to-peek scenario passed in 9.9 seconds. It also checks price reset, absence of a stamp or error, intercepted submission status 201, and cold restoration. Auth, onboarding and the price-submit transport are HTTP doubles in this case; real MapLibre paint and native sheet gestures are exercised. This does not prove durable price writes, bill recovery or real-provider authentication. No product sheet or focus-trap policy changed. An interrupted diagnostic has no verdict ([log](r18-second-pub-diagnostic-interrupted.log)); its conditional header-drag diagnostic is separate from the permanent forced sequence ([log](r18-second-pub-drag-peek.log)).

The two streaming-hook tests now pass ([after log](r18-hook-after.log)); the nine-file focused unit run passed 84 tests ([log](r18-focused-units.log)). The hook-scoped lint completed cleanly ([log](r18-hook-lint.log)). These hook cases use a controlled loader, rendered React and a fake map; GeoJSON is real, but MapLibre native rendering is not exercised. The current four-case Chromium permission run passed in 11.7 seconds using actual browser permission states and CDP-simulated coordinates ([log](r18-native-location-final.log)). This is simulated browser geolocation, not physical-device GPS.

The final current-source `npm run verify` passed after the permanent browser gesture change. It reports 18,588 tests passed and 6 skipped; 1,740 test files passed and 1 was skipped; 475 PostgreSQL RLS tests across 49 files; separate shared-memory runs of 10+10; and coverage of 82.81% statements, 76.06% branches, 87.65% functions and 86.68% lines. Global lint had 17 complexity warnings and zero errors. Freshness reported one stale `area_news` advisory and three feeds it could not measure; those feeds are not reported fresh. No high or critical audit findings were reported. [Final source log](r18-source-verify-final.log) is the current dirty-source result. The earlier R18 verify predates the final test gesture change ([prior snapshot](r18-source-verify-before-final-test-edit.log)). Post-gesture scoped TypeScript and lint logs are also preserved ([types](r18-type-after-gesture.log), [lint](r18-lint-after-gesture.log)); lint had zero errors and one complexity warning. The initial scoped lint failure is retained as historical evidence ([initial log](r18-scoped-lint-initial.log)).

The 47-route resource gate passed in 12.1 minutes with current R18 source ([final log](r18-perf47-final.log)). Reported medians were Home 1,010 KiB / 45 requests / 512 ms LCP, Map 3,203 / 135 / 184, Tonight 966 / 55 / 180, Plan 1,031 / 45 / 168, and Places 821 / 39 / 168. Home ceilings remain 1,010 KiB / 46 requests / 800 ms; Map ceilings remain 3,400 / 160 / 900. LCP is lab page LCP, not map-pin readiness. Budgets, profiles, retries and validity checks were unchanged. The first R18 invocation skipped because `PUBMAX_PERF_BUDGET` was missing ([skip log](r18-perf47-missing-budget-skip.log)); it is not a pass. The R18 source gate does not cover the full five-project browser suite. The fresh local R18 production build was created from `5de246205` plus uncommitted R18 production changes; it is not a production deployment. No PR, push, shared SQL change or merge is recorded here. The full five-project suite and current-head PR gate remain pending. The current strict default-five CWV sweep failed, as recorded below. No PostHog policy decision is recorded here.

## R18 strict CWV failure and runtime release

The unchanged strict default-five CWV phase completed with exit 1: one failed test and one passed in 15.6 minutes. All 18 route cells contained five valid samples, giving 90 successful primary interactions with finite, non-negative readings. All eight product cells contained five finite, non-negative samples, giving 40 product measurements. The failure is real gate evidence: cold mobile Home LCP was 2,648 ms against 2,641.6 ms allowed; INP was 376 ms against 184 ms allowed. No baseline recording, tolerance, retry, profile or validity change was applied. [Full output](r18-cwv-strict-final.log), [median artifact](r18-cwv-strict-final.json) and [raw sample validation](r18-cwv-validity-and-verdict.json) preserve the result.

Warm mobile Map measured LCP 1,232 ms, INP 88 ms and CLS 0.007. Mobile first painted pins took 11,110 ms and selected details 8,354 ms; editable plans took 1,676 ms and acknowledged saves 1,231 ms. Desktop equivalents were 4,682, 3,881, 901 and 503 ms. Map readiness and selected details remain slow. The independent [selected-detail source receipt](r18-selected-venue-latency-source.md) identifies a loading waterfall and proposes a diagnostic; it establishes source ordering, not runtime causation or an implemented repair. The [host CPU snapshot](r18-cwv-host-cpu.txt) records concurrent load, but does not prove the Home failure was environmental. The independent [Home source review](r18-home-cwv-source.md) confirms the relevant Home source paths are unchanged from R16 and identifies hydration, decode and scheduler hypotheses. Four of five cold INP samples exceeded the allowance; source equality does not excuse the current failure. Native attribution is prepared but unrun.

The owned server was stopped with SIGTERM after the coordinator's 07:27 UTC cleanup boundary. Resume after compaction occurred at 07:30:40 UTC. Starter exit was 143; known measurement, worker, Chromium and server PIDs were absent, and ports 3351/3352 had no listeners. The late cleanup is recorded without claiming deadline compliance. No further runtime phase was started. [Dirty source manifest](r18-source-manifest.json) identifies the nine source/test files in this candidate. The [PostHog ordering receipt](r18-posthog-source-ordering.md) is conditional source review; human identity policy remains pending and no root analytics patch was applied.

## R19 recovery and scope refresh

The coordinator's current turn stopped with a model-capacity error. It was resumed on the user's requested Sol High model; the new turn was confirmed active. Owner worktrees and test handles were preserved. The friend runtime was subsequently released. Root received a bounded diagnostic lease from 08:04:51 through 08:25 UTC and explicitly released it process-free at 08:23 UTC. Coordinator audit gate owns the next runtime slot.

A live GitHub read confirmed remote `main` is `76de20674da64604af22872ff42ee08fca7f156a`, matching fetched `origin/main`; the integration is zero commits behind and 287 ahead. Nine PRs and 32 issues remain open ([issue inventory](r19-open-issues.txt)). PR approval or hosted checks do not establish the integration candidate's gate or production release.

The [dependency receipt](r19-dependency-compatibility.md), [installed inventory](r19-dependency-installed-inventory.json) and [registry inventory](r19-dependency-registry-inventory.json) distinguish lock consistency from release freshness and compatibility. All 70 installed direct packages match the lock; 67 match current registry latest metadata. Two patch updates await validation; the TypeScript major needs parser and structural skip-gate migration. No package or source change was made in this phase. The [open-issue source audit](r19-open-issue-source-audit.md) identifies query prefetch loss, legacy Bar Tab/Ledger readers, price-cap qualification copy, misleading parked-digest activation instructions and a clock-dependent feed cache contract. It also identifies documented APIs and a frozen migration scaffold that cannot be deleted from absent in-tree callers alone. These are source findings and reproduction candidates, not runtime bug fixes or issue-closeout authority. The refreshed [Astra/PlanAstra requirements matrix](r19-requirement-coverage.md) is complete as a source/evidence inventory; it identifies actual v0 requirements, unaccepted design proposals and gaps without claiming release completion. The [used-skill inventory](r19-skill-source-inventory.json) records resolved paths and hashes for 13 relevant skill names. Greploop is absent locally; differing project/global copies are preserved. This establishes availability and content differences, not upstream freshness or duplication. No skill update or removal was performed.

## R19 native attribution, unchanged R18 source

The original R18 production build and nine-file source manifest stayed unchanged. Three five-sample mobile diagnostics completed with exit zero, no recorded errors and successful primary actions in every sample. The reference uses the installed vitals helpers without extra observers; attribution adds native Event Timing, LCP, long-frame and resource observers. Observer overhead prevents using attribution as a replacement gate. All slow first samples remain included.

| Diagnostic | Median LCP (ms) | Median INP (ms) | Raw evidence |
| --- | --- | --- | --- |
| Home reference | 1,432 | 88 | [Report](r19-home-reference/report.json), [viewed screenshot](r19-home-reference/after.png) |
| Home attribution | 1,436 | 96 | [Report](r19-home-attribution/report.json) |
| Selected venue attribution | 8,732 | 56 | [Report](r19-selected-attribution/report.json), [viewed screenshot](r19-selected-attribution/after.png) |

The selected screenshot names Princess Louise, shows estimated £6.50 and the Overview tab. The probe's `heading:null` reflects a heading-selector mismatch, not missing venue identity. Its final LCP is the address, “Camden, Greater London”. Later four runs show the canonical venue response finishing before six inspector JavaScript and 17 stylesheet requests begin; those 126.3 KiB finish roughly two seconds later. Inspector acquisition waits through roughly 600 ms of browser-observed API request, queue and transfer time. This is not 600 ms of server processing; overlapping it does not guarantee that much LCP improvement. MapLibre download and map rendering overlap that interval. This identifies serialized inspector acquisition and contention, not a slow API server or a proven hard dependency on map readiness. The [native analysis](r19-native-analysis.md) details resource and input ordering. Concurrent warming of the existing Inspector import is a candidate requiring a controlled browser reproduction and comparison before any source repair.

Home's first attributed interaction measured 288 ms total: 3.2 ms input delay, 2.2 ms processing and approximately 282.6 ms until presentation. No nearby long task establishes an expensive click handler. The first photo loaded at 2,506 ms and painted at 3,576 ms, with stylesheets and the heading also late. These readings do not isolate image decode, hydration or host scheduling as the cause. The narrower unchanged Home reference passing median does not clear the strict R18 default-five failure (2,648 ms LCP and 376 ms INP). No Home patch is justified by these traces alone.

Initial diagnostic startup failures are preserved: temporary TSX top-level-await parsing and callback `__name` serialization errors occurred before measured samples. The final [driver](r19-native-driver.ts.txt) loads a self-contained [compiled observer](r19-native-probe.js.txt), generated from the [probe source](r19-native-probe.ts.txt). Installed helpers, budgets, sample counts and production code were not changed. The archived source uses `.txt` suffixes so evidence does not enter the application TypeScript or lint graph. Host snapshots are diagnostic metadata, not evidence that scheduler noise caused a product failure.

All three browser drivers closed their contexts. Owned Next PID 64875 and deadline watchdog PID 69847 exited after termination; report PIDs 72357, 92502 and 99356 were absent and ports 3351/3352 had no listeners. Explicit release reached the coordinator before the 08:25 UTC cutoff. No runtime, package installation, index, push, PR, migration or deployment followed this slot.

## R20 loading-order repair and current candidate

The API/slim-held production diagnostic reproduced the original order: the real selected-venue response and slim core were held, no Inspector mounted, and no Inspector code request started within five seconds. [Original RED](r20-inspector-order-red/report.json) and its [executed source](r20-order-red-source.mjs.txt) are preserved. Root then added only a best-effort import of the existing Inspector module at the existing detail-request guard. The literal dynamic renderer, skeleton, server ID validation, selection cancellation, auth, price trust and map readiness remain unchanged. Invalid or missing non-base IDs may speculatively request static assets; this does not authorize data or change their notice.

The first, module-first version passed the [real held-response ordering diagnostic](r20-inspector-order-green/report.json): one API and one Inspector acquisition, no selected record delivered before assets started, actual Princess Louise/estimated £6.50, native Overview focus, Escape and usable map marks after the modal closed. A permanent case in `e2e/map-performance.spec.ts` learns the owning chunk from served markup and holds all actual slim carriers, including whole-index fallback. Its [Chromium run](r20-inspector-permanent-green.log) passed one case in 3.3 seconds. [Ninety-four existing unit cases](r20-warm-focused.log), scoped lint and global TypeScript passed on that version.

### Rendering independence and the failed pin oracle

The baseline MapLibre hold showed the named Inspector, estimated price and Overview before any canvas existed. Its subsequent 25-second tappable-pin assertion failed. The [first failure](r20-inspector-map-hold/report.json) remains a failure. A [second diagnostic](r20-inspector-map-hold-r2/report.json) preserved that same failed assertion and overall exit 1, then separately captured the state: real painted map, no fallback, settled selected camera, `aria-modal=true` and a body/html hit stack. Native Escape removed the modal and immediately exposed 44 tappable marks with the same camera centre. [Failed-oracle screenshot](r20-inspector-map-hold-r2/failed-original-oracle.png) and [native-close control](r20-inspector-map-hold-r2/after-release.png) were viewed. This establishes modal hit-test blocking; the control does not convert the original oracle failure into a passing run or prove every selected-camera contract.

### Timing and dispatch-order follow-up

Five module-first selected samples completed with valid actions, finite non-negative metrics and no errors. Median LCP was **9,044 ms**, INP **80 ms**, versus R19 attribution's **8,732 / 56**. [Raw samples](r20-selected-module-first/report.json) and [native assessment](r20-selected-native-analysis.md) show the same Inspector cohort at 129,346 bytes versus 129,363 previously. Assets now start before the API, but the API's browser queue grows from roughly 340 ms to 1,040 ms; server response remains about 2-3 ms. Neither a speed gain nor a causal regression verdict is supported by these separate runs.

The final source candidate instead dispatches the existing public detail request and registers its continuation **before** warming the same Inspector import. The [fresh API-first build](r20-api-first-build-server.log) passed compilation and TypeScript. Its five-sample attempt started too late to finish the bounded slot: the deadline stopped it after **two samples, exit 130**. [Partial report](r20-selected-attribution/report.json) retains 10,028/72 and 8,948/168 ms LCP/INP; there is **no five-sample median or performance verdict**. The current [ten-file source manifest](r20-source-manifest.json) includes the R18 repair, final API-first warm and permanent ordering case. Module-first unit/ordering/timing passes cannot stand in for final API-first gates. Final ordering, sample comparison, full strict CWV and full five-project browser suite remain pending.

Home's additional [native five-sample trace](r20-home-frame-trace/report.json) completed with median 1,436 ms LCP and 96 ms INP, retaining the first 2,572/304 sample. Extra tracing adds overhead; own unit/TypeScript work at 09:04:53 overlaps the last sample. An external self-hosted Actions performance browser, rooted in `actions-runner-pubmax-2`, had a profile born 09:00:02 and remained active after our slot. It overlapped R20 timing despite the agent-lane lease. This is an observed host confound, not proof that host load caused a failure. Raw native traces stay in the ignored artifact archive identified by [path and hashes](r20-home-native-trace-archive.json), keeping 81 MB of raw events out of the source tree. The [native frame assessment](r20-home-native-analysis.md) establishes the clock mapping for all five samples. The first interaction spent about 3.7 ms waiting for input processing and 2.6 ms in its handler; roughly 294.6 ms remained before presentation. A GPU flush spans 225 ms of wall time but roughly 2 ms of thread CPU. The hero AVIF decode takes about 2 ms. These observations identify a presentation lead, not its cause. External runner overlap and tracing overhead prevent a causal verdict. No Home source patch was made and strict R18 remains red.

### Cleanup and remaining scope

The enforced deadline fired at 09:11:15 UTC. Owned driver PID 87491 exited 130, Next 84097 and its starter exited 143, and watchdog 93608 exited zero. All earlier six report PIDs were absent; ports 3351/3352 had no listeners. Explicit release reached the coordinator at 09:11:29, before the 09:12 cutoff. A later profile audit traced live Chromium 44622 through Node 44621 and the Actions runner rather than the integration checkout; it was left untouched. No live Playwright profile rooted in the integration remained. The [terminal receipt](r20-terminal-receipt.json) records session exits and partial-versus-complete measurements. No new runtime followed release.

[Copy findings](r20-product-copy-findings.md) identify price-cap qualification, unsupported future city pricing and an unmeasured signup duration; browser fit and corrections are pending. The [complexity leaf plan](r20-complexity-leaf-plan.md) names bounded existing-owner extractions with black-box coverage, without raising the threshold or adding public interfaces. They are source proposals, not completed cleanup. Night Signals' keyless cache policy also needs actual expiry/moderation route proof before repair. Compatible dependency patches and skill freshness work remain pending. No index, push, PR, merge, shared migration or deployment occurred in this slot.

## R21 acceptance reconciliation

The [full issue acceptance reconciliation](r21-issue-acceptance-reconciliation.md) corrects the title-only R19 scope: #1639 concerns accessibility qualification, while price-cap copy is separate. #1641 also requires a bounded dedupe set and measured intent counts; #1646 requires page evidence at three widths and cold-process timing. The [query-intent reproduction procedure](r21-query-intent-repro-plan.md) separates the public Discover control from the verified-only Nearby control and specifies actual before/after network counts; it remains unrun. The [source-only receipt](r21-source-only-receipt.json) confirms all ten R20 application/test hashes stayed unchanged. No application fix or issue closeout follows from this source-only inspection. [PlanAstra section 8.9](../../plans/PlanAstra.md#89-measurement-preserve-the-28-day-outcome-and-the-reporting-limits) now acknowledges the existing private aggregate and disposable PostgreSQL proof while retaining the unverified live migration/reporting boundary; no metric implementation or production SQL was added.

## R22 parked-digest documentation

The [digest documentation correction](r22-digest-documentation-correction.md) removes the claim that keys activate the current scaffold. Configured transport and audience lookup remain unimplemented; CLI/workflow wording still needs its own correction. No delivery or account action occurred.

## R23 final API-first source and browser gates

The final API-first candidate passed the actual five-case Chromium run in 6.2 seconds: concurrent Inspector acquisition, bogus selection, failed lookup, alias resolution and valid selection ([browser log](r23-order-parity.log)). The permanent acquisition test holds real same-origin data carriers and releases their unchanged bodies. The unavailable lookup case uses a 503 transport double; it does not prove a live provider outage or real-account authentication.

Current `npm run verify` exited zero: 18,588 tests passed, six skipped; 1,740 files passed, one skipped; 475 disposable PostgreSQL RLS cases across 49 files; separate shared-memory runs of 10+10. Coverage remained 82.81% statements, 76.06% branches, 87.65% functions and 86.68% lines. Lint reported zero errors and 17 complexity warnings. The stale `area_news` advisory and three unmeasurable durable feeds remain disclosed, with live providers unmeasured ([source log](r23-source-verify.log)). This gate includes the PlanAstra and parked-digest documentation corrections. All ten application/test hashes match the final R20 candidate ([terminal receipt](r23-terminal-receipt.json)).

Source and browser jobs ended with exit zero; the owned server ended 143 after deliberate shutdown. At 10:34:32 UTC both test ports were free, and all three owned job records were inactive. Root released the heavy-test phase and requested the next bounded slot for the queued documentation follow-up. No R23 timed cohort ran: an independently owned Chrome renderer still made host quiescence uncertain. The prior strict CWV failure remains unresolved. Current full five-project testing, controlled timing comparison and publication gates remain pending.

The [all-alcohol source inventory](r22-all-alcohol-source-coverage.md) separates 4,643 listed bundle rows from 2,960 beer estimates and fixtures. Only 30 listed rows record serving size. These are dated records, not verified current offers. The [publisher-row source trace](r23-publisher-row-source-path.md) found that Sydney Arms uses a UK-base identity whose sheet does not consume listed bundle prices; actual browser reproduction remains pending. A shot-category classification concern also remains open. Neither finding authorises invented prices or direct edits to generated data.

## R23 full five-project regression and follow-up

Both primary and keyless profiles were freshly built through the declared Playwright config. Compilation and TypeScript passed. All 2,461 recorded application, component, library, browser-test and config/package hashes remained unchanged through the run ([build identity](r23-fullfive-build-receipt.json)). The full suite exited **1** after 23.5 minutes: **1,284 passed, five failed, 24 skipped, three did not run** ([original log](r23-fullfive-original.log), [terminal and cleanup](r23-fullfive-terminal-receipt.json)). This is a failed gate.

The first two failures concern intermediate drawer geometry and retained content across protocol round trips ([diagnosis](r23-drawer-failure-diagnosis.md)). The mobile Discover failure is a strict CSS locator matching two sections, including a hidden one ([diagnosis](r23-discover-failure-diagnosis.md)). Original contexts remain in [the failure directory](r23-fullfive-failures/). After original runtime cleanup, three test-only corrections were applied: explicit content readiness, the existing controlled browser-clock idiom with atomic frame samples, and a visible accessible-region locator. Exact geometry, lifecycle and Back-state checks remain; no retry or tolerance was added. The [focused seven-case follow-up](r23-drawer-discover-fixed.log) passed in 46.7 seconds with exit zero. Global TypeScript and scoped lint exited zero, with no scoped lint warnings ([types](r23-after-clock-types.log), [lint](r23-after-clock-lint.log), [terminal receipt](r23-focused-terminal-receipt.json)). These passes do not clear the failed full run or supply a final full-source gate for the edited tests.

All heavy jobs ended by 11:18:46 UTC; the owned server ended 143. The 11:22 watchdog found no active jobs. A source-only screenshot archive repair delayed the explicit release notice until after 11:23:44, so it is not reported as on-time notice. Ports were confirmed free again at 11:24:08. Generated screenshots were preserved under this proof directory and their original tracked paths restored.

The two late failures remain open: Manchester location readiness left its action disabled as Checking, and service-worker takeover did not reach the required phone pin reveal. Source review identifies a possible unstable location-callback effect loop and a local-data/target-worker revision mismatch in the cache fixture. Actual native participation still needs confirmation; production guards and failed results remain unchanged. The three unrun cases are not passes. Current strict performance, corrected full five-project rerun, final source gate and publication remain pending. No deployment or shared SQL change occurred.

## R24 native diagnosis on unchanged application source

The bounded native slot ran from 11:50:07 UTC until process-free release at 11:56:57 UTC, before the 11:57:30 cleanup cutoff. The existing fresh R23 application artifact was reused with the declared server environment; all 2,461 source hashes matched except the three corrected browser specs ([source comparison](r24-preflight-source.json)). No application/test patch, build, full source gate, timing cohort or index operation ran in this slot. All six owned jobs ended, recorded process groups were absent, and ports 3351/3352 were free ([terminal receipt](r24-terminal-receipt.json)).

**Location loop reproduced.** Real Chromium permission was granted with a simulated Manchester point, not physical GPS. Pass-through instrumentation recorded 49,740 granted permission queries and 49,735 native position requests in 21.8 seconds: 49,734 succeeded, none errored, one remained pending. The marker appeared, but the action returned to disabled Checking after 6,925 button transitions. This is not a passing location journey ([counts](r24-gps-native.json), [screenshot](r24-gps-native.png)). The inline parent callback changes identity after a successful location update, recreates `checkNearby`, and restarts its granted-permission effect. A stable parent callback is the bounded correction candidate; its fresh-build native verification remains pending. The initial `.ts` loader failed before browser launch ([loader log](r24-gps-ts-loader-error.log)); the first `.mts` probe then failed instrumentation with `__name` undefined ([probe error](r24-gps-probe-error.json)). Neither attempt is acceptance evidence. The corrected capture had zero page errors.

**Cache fixture mismatch reproduced.** The original service-worker spec ran unchanged with native tracing and failed the same post-takeover phone reveal assertion ([original RED](r24-sw-original-red.log)). Its target controller installed and activated with `v=rollout-target-…`. The trace recorded actual origin core JSON with revision `local`, followed by a page-frame request to the unversioned core failing `net::ERR_FAILED`; direct origin reads after failure still returned 200 and revision `local` ([native summary](r24-sw-native-summary.json), [origin reads](r24-sw-origin-revision.json)). The last native frame shows the map retry state ([frame](r24-sw-native-last-frame.jpeg)). Source revision checks explain rejection under the mismatched fixture version. Use the served revision for `v` and a separate rollout nonce before rerunning; production worker validation must remain intact. The full reveal array was not captured, so this does not clear any separate reveal-baseline race. Full native trace remains at the temporary path recorded in the summary.

**Published wine delivery missing.** A fresh signed-out phone context opened the actual Sydney Arms base venue. Its existing per-venue price GET returned 200 with empty community arrays; the sheet showed NO PRICE YET and existence-only copy. The published representative Rioja £10.50 / 250ml quote was absent ([actual response and text](r24-base-price-native.json), [screenshot](r24-base-price-native.png)). The approved bundle contains that dated quote and the separate £5.25 / 125ml quote. The correction should deliver published quotes through the existing per-venue read, separately from community observations, without another browser request, inferred measures, curated promotion or changed pin authority. Implementation and native after-proof remain pending.

After the native slot was released, the stable parent location callback and the served-revision cache fixture correction were applied as source-only candidates ([diff](r24-minimal-source-candidates.patch.txt), [hashes and limits](r24-source-candidate.json)). They preserve the existing location/watch-latch effects and the production worker code. Static diff checking passed; no type, lint, build or native after-run has occurred. The R23 application artifact is now older than this source and must be rebuilt for acceptance. The published-price implementation is still a temporary draft, not an applied fix.

An official npm metadata refresh still reports `ai` 7.0.123 and `@ai-sdk/otel` 1.0.123 as available patches. TypeScript 7.0.2 remains outside the latest installed lint parser's declared `>=4.8.4 <6.1.0` peer range ([metadata](r24-dependency-refresh.json)). No package, lockfile or installed dependency changed in this phase.

An independent [source review of the three R23 test corrections](r24-three-test-source-review.md) found no weakened core assertions. It distinguishes visible-region locator correctness from removal of hidden duplicate DOM, and notes the existing one-minute clock-advance side effect. It did not rerun tests. The original full regression, strict CWV failure and pending final gates remain unchanged.

## Earlier and pending evidence

The failed fake-timer attempts remain in `/tmp/pubmaxx-account-form-focused-r1.log` and `/tmp/pubmaxx-account-form-focused-r2.log`. The R13 browser attempt remains in `/tmp/pubmaxx-account-chunk-browser-r13.log`. Its first aborted chunk was automatically retried by Turbopack. The earlier diagnosis used a bundle-analyzer runtime copy that differed from the production runtime. Those attempts do not establish a persistent cache defect. R14 intercepts the actual production form script and exhausts retries before reloading.

`npm run verify` passed in R10, before the final CSS import move to the host and the strengthened browser proof. It is prior-snapshot evidence, not a current-source full verify. Log: `/tmp/pubmaxx-recovery-full-verify-r10.log`.

R10 recorded 18,497 tests passed and 6 skipped, with 82.8% statement coverage. It ran 475 RLS tests and two shared-memory harness runs with 10 tests each. Lint reported 17 complexity warnings and zero errors. Freshness reported stale `area_news`. It could not measure `night_signal_candidates`, `weather`, and `whats_on` without credentials.

Still pending:

- Complete the full `chromium`, `chromium-keyless`, `chromium-gl`, `chromium-sw-gl`, and `chromium-no-gl` rerun on the current source candidate.
- Diagnose and fix the cold mobile Home CWV failure, then complete a fresh strict default-five sweep with unchanged budgets and valid samples.
- Complete the final API-first controlled timing comparison; acquisition and selection parity passed in R23, but module-first timings do not prove a speed gain.
- Complete the current-head PR gate.

The integration contains 14 migration scripts and 14 rollback scripts beyond the fetched main. The 475 local RLS tests exercise the migration chain; they do not establish live database state. No integration PR, push, production deploy, shared SQL change, or merge is recorded here. Real-provider sign-in and physical-device GPS remain unproved. The wider recovery remains open.

Older issue source review found #1843 distance calculation and #1812 outbox rollback addressed. For #1814, build and validation withhold expired famous-venue rows rather than failing: 17 expired records are absent from slim data, while 71 remain current through 25 October 2026. The expired records still need source re-verification; this inspection was source-only.

## R25 price tests prepared

Four [tests-only files](r25-price-tests-only-source.json) are applied to source. They have not run. The [production patch](r25-base-price-production-draft.patch.txt) remains an unapplied draft, awaiting tests-only RED in the next granted runtime slot. Native R24 already recorded the missing Sydney Arms wine quotes. Review corrected React polling and reused canonical label normalization. The base-only published-beer extension is drafted, with [supplemental tests](r25-base-price-beer-tests-only.patch.txt) applied. Its default still excludes beer on curated surfaces; unknown beer measures remain explicit and unranked. Production projection code remains unchanged. No package, index or publication step ran. The new GPS callback and SW fixture candidates still require a fresh build and native verification.


The [skill provenance review](r25-skill-refresh-review.md) compared six shared files with public upstream main. It preserves project overlays and corrects an earlier false missing-companion claim. Local update timestamps alone do not establish freshness. The two project GNHF mirrors now link their Agents table to the existing official upstream section ([source receipt](r25-gnhf-link-source.json)); no custom policy or installed skill collection was overwritten. Current human and AGENTS instructions govern invocation.


## R25 current source and native results

Published-price production code is now applied. The [tests-only original run](r25-price-original-red.log) recorded 29 failures and 106 passes. The first applied run passed 135 tests; the equivalent branch cleanup passed 138 ([focused final](r25-price-final-green.log)). An old price-copy fence assumed ternary punctuation; retaining its exact words and order without that punctuation passed the [51-case follow-up](r25-price-lane-format-followup.log). Type inference and copy-fence failures are retained ([type](r25-source-gate-type-red.log), [copy](r25-source-gate-copy-fence-red.log)). The [frozen full gate](r25-source-gate.json) then exited zero: 18,618 coverage tests, six skips, 475 RLS tests and two ten-case shared-memory harness passes. Lint has zero errors and 17 existing complexity warnings. One stale feed and three unmeasurable stores remain explicit. Only the compatible AI SDK patch pair and its three related dependencies changed; npm formatting churn was restored.

The [fresh-build original journeys](r25-fresh-build-native-focus.json) passed Manchester cluster stability and service-worker quota/takeover/purge/offline/reveal checks. The [native location counter](r25-gps-native.json) recorded three successful requests, no further requests during 18 seconds, an enabled Refresh control and zero page errors. This uses granted Chromium permission with a simulated Manchester point, not physical GPS.

The [final native price proof](r25-price-native-final/report.json) passed at 390 and 1440: Sydney Arms shows its exact £5.25 / 125ml and £10.50 / 250ml Rioja quotes, menu source and 29 September observation date. Native selection A→B→A keeps each pub's prices separate and makes one selected-price GET per pub. The initial phone diagnostic clicked an already expanded search toggle closed; that [failure](r25-price-native-initial-failure/report.json) remains recorded. The corrected driver reads native expanded state; no application fix or assertion waiver was needed.

One adjacent UI defect remains: the resident Sydney Arms search option says “No listed price” after its published prices are shown. Both final width captures record the contradiction. Search-module ownership overlaps another active integration task, so no overlapping source edit occurred. Current full-five regression and performance gates are still pending. No index, publication, live account write, deployment or shared migration occurred.


## R25 full browser regression remains red

The [original full-five run](r25-fullfive-original-verdict.json) exited one: 1,287 passed, four failed, 24 skipped and one did not run in 24.5 minutes. All 2,464 frozen source hashes stayed unchanged through that run. The four failures are preserved in [contexts and screenshots](r25-fullfive-failures/) and the [terminal log](r25-fullfive-original-red.log). No full-run trace ZIP was present when inspected; the result-directory path alone is not trace proof.

The empty-price GET fixture omitted the new independent `listedPrices` field. Adding `listedPrices: []` preserves its original No Price Yet, selection, typed-price and bill assertions. This is the only [source change since the full run](r25-source-after-fixture.json). [Focused replay](r25-failure-focus-receipt.json) then passed all five affected cases in 31.6 seconds. Zoom, WebGL and worker takeover passed unchanged and therefore remain unresolved full-run failures. The previously unrun serial WebGL sibling ran and passed in this narrower replay.

The [native zoom diagnostic](r25-zoom-native-receipt.json) also passed the original triple-click threshold and a separate settled-click control. Both clicked after opening-camera intent, so neither exercises a late opening move overriding earlier clicks. Native camera sequence is 12, 13, 14, 15. No production zoom, WebGL or worker fix is claimed from these passes. The service-worker full failure awaits controllerchange at line 249, before post-reload reveal checks; any post-reload timing lead does not explain that recorded failure.

A fresh full source gate after the fixture correction is running. Current-source full-five, strict default-five CWV, route-resource sweep and final API-first timing acceptance still require another granted runtime window. Search-price copy remains held for its owning integration lane. No publication, deploy, shared SQL or live account change occurred.


The [refreshed source gate](r25-source-after-fixture-gate.json) exited zero after the fixture correction: 18,618 tests and six skips, 475 RLS tests, shared-memory harness 10 + 10, zero lint errors and 17 baseline warnings. All 2,464 source hashes stayed unchanged. [Actual cleanup](r25-terminal-cleanup-receipt.json) proves every owned group stopped, ports 3351/3352 free, and deadline watcher stopped. Original full browser regression remains red. No later runtime grant or production release is implied.


## R26 source-only follow-up

[Source review and prepared diagnostics](r26-source-only-preparation.json) trace native MapLibre context-loss/style restoration and the pending opening-camera callback. No diagnostic has run. The [worker observation plan](r26-sw-observation-plan.md) preserves the original full case and moves failure state into an external journal.

[Two stale recovery comments](r26-comment-cleanup.json) now describe installed MapLibre restoration correctly. Restoring only the old canvas comment reproduces its R25 hash; the helper body is unchanged. This cleanup changes no executable code. The R25 source gate precedes these comments, so a new final source gate is still pending. SDK currently holds the shared runtime; no root test/build/browser/install job started in R26.


The [R26 acceptance delta](r26-source-acceptance-delta.md) keeps the actual product contracts: Places is the city picker; New/Create opens Moment, price-log and Plan actions. It distinguishes the R25 tested source from subsequent comment-only cleanup and retains all unmet provider, durable-write, performance and release requirements.


## R27 source preparation, 30 September 15:14 UTC

No new test or browser pass in this round. SDK owns runtime until its explicit cleanup and handoff. The queued Core slot has not been granted. The R25 full-five result remains failed; focused replay does not clear its three remaining functional failures.

Live homepage FAQ HTML reproduces two contradictory claims: optional bill photos despite mandatory bill submission, and all listed prices being London prices despite shipped dated records elsewhere. [Before receipt](r27-live-faq-before.json) includes the exact answers and the Edinburgh source example. This proves rendered HTTP copy and committed data, not live provider submission or a current purchasable offer. Visible drop DTOs expose receipt photo URLs, so the public-photo warning stays.

Only existing FAQ tests changed, and remain UNRUN. [Prepared copy patch](r27-faq-copy-after-red.patch.txt) is unapplied until their intended failure is observed. [Source manifest](r27-source-before-faq-fix.json) expands the earlier production freeze to include the tracked unit tree. Current production bytes match R26; the last source gate predates these tests.

[Diagnostic receipt](r27-diagnostics-ready-unrun.json) identifies the temporary files and their hashes. SW observations preserve the original test tail and add native worker lifecycle plus worker-owned request start/finish/failure events. A truncation marker prevents treating absent later events as evidence. Native GL diagnostic now holds genuine loss beyond the recovery grace and requires re-init, canvas replacement and painted pub marks; its two synthetic arms retain their original failure result. Both diagnostics remain UNRUN.

Remote review at 14:45 recorded PR1880 exact7c1ea925 with hosted18PASS/4SKIP, including Browser law pins. Full browser suite was skipped there. [Remote receipt](r27-remote-current.json) records those heads as historical observations. No root publication, merge, deployment, shared SQL or live-account mutation occurred.


## R28 lifecycle and FAQ fixes, 30 September

The original FAQ test now reproduces both copy contradictions: [RED](r28-faq-red.log) has two failures and four passes. The minimal two-answer correction passed [39 related checks](r28-faq-green.log). A bill photo is required; the public-photo warning stays. Prices outside London are conditional on published menus or logged prices. This is source and local rendering work, not a live release or provider submission.

The [trusted native style-gap RED](r28-webgl-style-gap-red/report.json) lost WebGL before the first scene. MapLibre had removed its style; deferred icon registration called `getImage` through the null style and left the fallback visible. The applied fix invalidates the retired style generation and cancels its deferred work. Recovery grace, retry count and budgets stay unchanged. The identical [native GREEN](r28-webgl-style-gap-green/report.json) exercises that actual interval, replaces the lost canvas, paints pub markers and records no scene error or fallback. Observer overhead and desktop software rendering remain explicit limitations.

The [fresh focused replay](r28-fresh-build-focused-receipt.json) passed all five original affected browser cases with no retry in 33.9 seconds. All 4,247 frozen source hashes matched after build. The earlier full-five failure is retained; focused passes do not close that gate. Full current-source verify is running. Initial three-arm and SW observations overlapped an incompletely handed-off runtime, as recorded in [custody receipt](r28-functional-probes-hold-receipt.json); they carry no isolation or performance claim. The later style-gap RED/GREEN and focused replay followed the actual owner hold.

Full-suite controller timing and late zoom scheduling remain unresolved. No network-delay story or fake camera state is substituted for that evidence. Root has not committed, pushed, opened a PR, merged, deployed, applied shared SQL or mutated a live account.

The [R28 full source gate](r28-source-verify-receipt.json) exited zero: 18,618 unit checks and six skips, 475 RLS checks, and shared-memory harness 10 + 10. All 4,247 frozen hashes stayed unchanged. Lint has zero errors and 17 baseline complexity warnings; area_news is stale and three durable feeds remain unmeasurable. [Native FAQ AFTER](r28-faq-after/report.json) verifies the two corrected answers at 390 and 1440, with no page error or horizontal overflow. Viewport images retain real fixed chrome; tall element captures are not evidence of viewport occlusion. No live release or provider flow is proved.

[Actual R28 cleanup](r28-terminal-cleanup-receipt.json) at 16:06:22 UTC records all 15 owned groups and wrappers absent, watcher stopped, four coordination ports free and all frozen source hashes unchanged. Root runtime is released. Later full browser and performance work requires its own granted window; this receipt grants none.


## R29 source-only continuation

[New source and anonymous public-read findings](r29-source-only-findings.md) change the next reproduction priority without changing the tested R28 candidate. Only 24 raw wine quotes record explicit millilitres, all at Sydney Arms; shots already exist. Three item/category contradictions are outside the existing exact quarantine. The public venue read returns Brownswood's £2.60 quote in the beer bundle, while its source label describes a mixer; native rendered-pint reproduction is still pending. Public responses omit named listed-category quotes, so London Pride and Ting wine rendering remains a candidate-source finding. Real provider login/logout is outside the original full-five and unproved. No local heavy runtime, maintained source change, publication or live-account mutation occurred.

## R30 public security and cache reads

[Security and cache review](r30-security-cache-review.md) records ten anonymous production header reads and four HTML nonce checks. Private documents and anonymous export denial include no-store; sampled inline scripts match fresh nonces. Source review found retained anchorVenueId in anonymous shared-plan client props, awaiting native reproduction in Core's confirmed scope. [Publisher-menu read](r30-price-publisher-read.md) supports withholding Brownswood's bad beer claim without inferring a replacement. SDK's hosted DOMPurify advisory failure has an active owner; Core's tested lock remains frozen. No local heavy runtime, maintained source repair, authenticated proof or deployment occurred.

## R31 freshness and dependency handoff

[Freshness and acceptance review](r31-freshness-dependency-and-acceptance.md) adds live durable timestamps, confirms old news is filtered but its stale coverage is hidden, and preserves the full v0 proof gaps. After SDK cleanup and explicit source handoff, Core applied its reviewed three-field DOMPurify lock delta. Lock targets 3.4.16; installed code is still 3.4.15. R28 freeze differs only at package-lock.json, so its gate/build are historical. No local heavy runtime or installation ran; new install, freeze, build and full gates remain required.


## R32 native reproduction preparation

[Source preparation receipt](r32-source-preparation.json) confirms latest fetched main remains an ancestor of Core HEAD. The R28 4,247-file freeze still differs only at the reviewed DOMPurify lock patch. Installed code remains 3.4.15. No local heavy runtime or maintained product edit ran in this round.

[Conditional runtime plan](r32-runtime-acceptance-plan.md) preserves actual owner cleanup and fresh preflight before Core's 18:39 to 20:09 UTC slot, with cleanup at 20:06. [Retained-price diagnostic](r32-retained-price-diagnostic.mts.txt) prepares actual Brownswood, Bell and Gallimaufry sheet/API observations at 390 and 1440. Source review corrected the Bristol route. [Anchored-plan diagnostic](r32-plan-privacy-diagnostic.mts.txt) prepares real local anchored creation, host and joined-guest capability reads, and separate anonymous document/RSC inspection. Both diagnostics remain UNRUN; neither supplies a native RED or GREEN.

The build wrapper restores public/data from HEAD. Any intended dataset repair needs an owned exact-byte snapshot and restoration around generated stamping before its gate can be trusted. Full browser/source gates, strict performance, provider-backed account flows and durable price writes remain open. No publication, migration or deployment occurred.


## R34 price component comment cleanup

[Comment cleanup receipt](r34-price-component-comment-cleanup.json) records 19 lines and 1,183 source bytes removed from VenueDrinkPrices. Repeated incident narrative and capitalized emphasis became short invariant comments. Review corrected an overstatement about active-lane ordering; the comment now includes absence copy and contribution invitation. Root's comment-stripped comparison and independent diff review found no executable, type, rendered-copy or API change. This does not reduce the already minified browser bundle or prove a speed improvement.

The R28 freeze now differs at package-lock.json and this component. Prior gates stay historical; new freeze and full gates remain pending. Integration's specific original pipeline process is still tracked separately. Core runtime, price/privacy reproductions and publication have not begun.
