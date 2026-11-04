# V1 night feature implementation evidence

The implementation extends the existing Plan with route comparisons, private table signs, sourced clues, and optional mystery reveals.
The source baseline is `059905ea55d8d173535733721fc6e729460a9f35`.
GitHub still reported that main commit at the final source check on 31 October 2026.

## Source and database checks

- The integrated fixture-based run passed 440 tests in 36 files.
- The run includes 22 local PostgreSQL checks across migrations 0213, 0214, and 0215.
- After the final small changes, the affected clue, presentation, and migration tests passed another ten checks.
- The table-sign UI tests passed seven checks after enabling the React test environment flag.
- The native TypeScript compiler passed with `--noEmit --incremental false`.
- ESLint passed for all 45 changed source files with zero warnings.
- Database types came from the repository generator and a throwaway PostgreSQL cluster.
- The unused-code gate passed after removing two unnecessary exports and relocating the temporary unit configuration.
- The browser test skip scan passed across 385 spec files.

The isolated test configuration inherits `vitest.config.mts`, retains `vitest.setup.ts`, and sets `globalSetup: []` and `maxWorkers: 1`.
This excludes the automatic data builder for the controlled fixtures. It does not replace the normal verification gate.
One worker ran the initial unit bootstrap before its data-builder dependency was identified. Further builder runs then stopped.

## Review findings and corrections

The specification review found that completed stops could become sealed again after a route revision.
Stamped arrival actions now remain revealed across revisions because route writes preserve the completed prefix.
Unstamped historical actions do not establish a reveal or a current table sign.

The standards review found a removal race in grounded proposal creation.
Proposal creation, voting, and decisions now check the current member token inside the database transaction.
Local PostgreSQL tests reproduced revoked-member and rotated-token failures before the correction.
Both reviewers confirmed their findings were closed in source.

Additional tests cover request deadlines, stale responses, account changes, shared reveal state, expiry, and keyboard focus on the table sign.

## Interfaces and rollout

- `GET/PUT/DELETE /api/plans/[id]/beacon` uses a live Plan member capability. Only the host changes the sign.
- `GET/PUT /api/plans/[id]/presentation` uses the same private membership boundary. Only the host changes the mystery setting.
- Sliding Doors uses the existing proposal and vote routes. The saved route changes only after host acceptance.
- Clues use public venue and walking-route reads after an explicit request. Straight-line fallbacks supply no clues.

Migrations 0213, 0214, and 0215 include rollback files. No live database received these migrations.
Table-sign reads stop at expiry. A later access removes a clock-expired note. Route and action changes remove it transactionally.
The full Plan holds comparisons and detailed evidence. Night mode keeps table signs, clues, reveals, and a visible full-Plan exit.

## Remaining acceptance

At the initial source check, the application build and browser execution still required explicit approval.
The test-phase record below supersedes that approval hold and records later execution.
No physical-device acceptance, PR publication, merge, or deployment occurred.
The existing release and native ownership records remain in force.

## Review repair round on 31 October 2026

This round starts from `29fe22b362ae1066650ca7e24224d6f470185325` in the assigned review worktree.
The changes remain uncommitted in this phase.

1. Queued arrival and skip requests carry their original route revision and venue.
   Both stores check the binding before insertion and retain identical retry behaviour.
   Legacy unbound requests remain compatible but cannot establish a table location or a completed-stop reveal.
2. Ordinary and grounded proposal creation check the live membership capability at the shared SQL insertion boundary.
3. Night mode titles and both glance lines retain stamped completed-stop reveals after safe route changes.
4. Sliding Doors keeps a retry key for each submitted payload across option changes.
5. The new store inventory rows declare metadata only.
   Store and handler tests exercise production refusal, current membership and host permissions.

Regression cases cover stale queued requests, legacy requests, retries, membership removal and token rotation.
They also cover a completed second stop with a stale device cursor after a later-stop replacement.
The focused Vitest command exited with code 1 before loading any test.
Node reported `MODULE_NOT_FOUND` for `node_modules/vitest/vitest.mjs`.
`git diff --check` exited with code 0.
These new regression cases did not run in this round.
The worktree has no `node_modules`, and Vitest is unavailable on PATH.
PostgreSQL tools are also unavailable on PATH.
The generated database types remain unchanged and require `npm run db:types` before validation can pass.
No manual edit replaces the required generator.

The outer executor owns the normal verification gate, build, browser acceptance, PR and CI phases.
This round supplies no new browser, native or physical-device evidence.
Earlier results above do not validate these uncommitted repairs.

## Test phase on 31 October 2026

The candidate commit is `d6089f29749e2e02570d657c62cf7b5bbd4ef826`.
The supplied configured command, `npm run verify:no-mistakes:changed`, failed with exit code 1 before this phase.
This phase did not repeat the full gate, lint, static analysis, PR work or CI work.

This phase leaves three test-related repairs in the worktree.
The repository database generator adds the missing action venue fields and SQL arguments to `types/database.ts`.
The Night mode test helper now ignores leading whitespace in button labels.
The phone browser test opens the full plan before using its controls, for both the host and the guest.

### Focused checks

- All 176 checks in the 19 changed behaviour suites passed, including the three PostgreSQL migration suites.
- The isolated Vitest configuration retains the repository setup and disables only the automatic enrichment builder.
  It uses one worker. The production build attempts separately ran the normal application builders.
- `npm run db:types` completed through the repository generator and a disposable PostgreSQL cluster.
- `npm run db:types:check` confirmed that the generated file matches the migrated schema.
- `e2e/v1-night-extras.spec.ts` passed at 1440 by 1000 and 390 by 844 after the phone test repair.
  These runs used the real application through an isolated development server on port 3187.

### Product journeys

The retained browser driver passed seven journeys against the running application.

1. Table signs require a bound arrival, restrict changes to the host, expire at plan end and clear after another arrival.
2. A safe route revision retains completed-stop reveals with a stale phone cursor and rejects stale or mismatched arrival requests.
   Identical bound arrival retries add one action. A legacy unbound arrival establishes no table location.
3. Sliding Doors compares without changing the saved route. A host marked Here can propose a route.
   A guest can vote but cannot accept. Explicit host acceptance changes the saved route.
4. Clues reveal a sourced answer only after a manual action and leave stops and arrivals unchanged.
5. A lost proposal response retains the same key for an identical retry.
   A different comparison option uses a different key and creates a separate proposal.
6. An unresolved required need blocks acceptance. The accepted anchor cannot move.
7. A failed walking provider supplies no clues from the straight-line fallback.

A further HTTP check exercised the real beacon and presentation handlers with `VERCEL_ENV=production` and no durable credentials.
Every read and write returned 503. This used a development server with the production policy enabled.
It does not establish production-build acceptance.

The clue journey uses disposable upstream routing geometry through the real walking endpoint and clue selector.
The fallback journey supplies an upstream 503. Neither journey proves live OpenRouteService availability or pavement accuracy.
No operator account, shared service or live database received writes.
The journey server, production-policy server and final visual-check server exited with code 0.
The disposable browsers and PostgreSQL clusters stopped.

### Build blocker and evidence

The first isolated production build failed because the generated database types lacked `plan_actions.venue_id`.
After generation, the second build still failed at `lib/planStore.ts:308`.
Its legacy action-query fallback omits `venue_id`, but the mapper accesses that property without narrowing the row type.
The compiler reports that `venue_id` does not exist on the fallback row.
This source repair belongs to the outer repair phase. This test phase returns **no-go**.

Evidence remains outside the worktree at:
`/Users/karanmanoharan/.no-mistakes/evidence/01M69HEAA3GT8PSTA3844GERAK`.

- `browser-build.log` and `browser-build-retry.log` retain both production build failures.
- `focused-tests-retry.log`, `database-types.log` and `database-types-check.log` retain the completed focused checks.
- `final-browser.log` records the passing desktop and phone browser test.
- `live-journeys.cjs`, `live-results.json` and `all-live-journeys.log` retain the seven product journeys.
- `final-accepted-route.log` and `live-results-Sliding.json` record the additional acceptance check after session restoration.
  This check confirms that the saved venue IDs equal the accepted proposal and that the route is visible.
- `production-policy-results.json` records the missing-storage responses and the server mode.
- `table-sign-fullscreen.png`, `mystery-completed-phone.png` and `mystery-full-route-phone.png` show the table and reveal surfaces.
- `sliding-doors-comparison.png`, `sliding-doors-accepted.png` and `comparison-lost-response-recovery.png` show the comparison journey.
- `clue-sealed.png`, `clue-answer-and-source.png` and `clues-unavailable-fallback.png` show clue controls and source disclosure.

The screenshots were inspected. Phone evidence uses a desktop Chromium viewport, not a physical phone or native shell.
Production browser acceptance remains blocked by the compiler error. Physical-device and native acceptance remain outstanding.
No merge, deployment, production promotion or live migration occurred.

## Production build repair on 31 October 2026

This repair uses candidate `d6089f29749e2e02570d657c62cf7b5bbd4ef826` and the existing uncommitted test repairs above.
The isolated production build reproduced the `lib/planStore.ts:308` error and exited with code 1.
The legacy query omits `venue_id`. The mapper now checks that the field exists before reading it.
Legacy actions still carry no invented venue identity. This repair changes one source line.

The same focused command then exited with code 0:

```sh
PW_PORT=3187 PW_NEXT_DIST_DIR=.next-v1-repair PW_SKIP_KEYLESS_WEBSERVER=1 PUBMAX_TRACKED_OUTPUTS=public/data node node_modules/@playwright/test/cli.js test e2e/v1-night-extras.spec.ts --project=chromium --workers=1
```

The restored-output wrapper ran the normal application builders and completed the production build.
Playwright started that build with its keyless environment, signing secret and test rate-limit allowance.
Both browser cases passed, at 1440 by 1000 and 390 by 844.
They opened saved Plans and checked host settings, guest reveals, private table signs and stranger refusal.
They also confirmed that reveal interactions leave the route revision and arrival actions unchanged.
The production server and disposable browsers stopped after the checks.

`repair-build-before.log` and `repair-production-after.log` retain the results in the evidence directory named above.
This result supersedes the production-build blocker above. The other journey results remain the earlier development-server evidence.
The full gate, lint, static analysis and unrelated test suites did not run again in this repair.
The earlier configured gate failure remains recorded for the outer executor. Remote CI remains required.
Phone evidence uses a desktop Chromium viewport. Physical-device and native acceptance remain outstanding.
No merge, deployment, production promotion or live migration occurred.

## Candidate test repeat on 31 October 2026

This phase tested `e98ed5553f54e05422246b8a02ed4601e848e26f`.
The supplied configured command failed before this phase. This phase did not repeat lint, static analysis or the full gate.

The isolated production build completed successfully through the restored-output wrapper.
The existing browser specification passed at 1440 by 1000 and 390 by 844.
All seven additional product journeys passed against this production build.
The stale-cursor journey also checked completed-prefix refusal, table-sign invalidation after a route revision, and stale skip refusal.
The production storage check returned 503 for all five beacon and presentation operations without durable credentials.
The repository database generator completed against disposable PostgreSQL.
The 19 focused behaviour suites passed, including all three changed migration suites.
The generated types required no further change.

Visual inspection found a remaining Night mode defect.
With the page theme set to light, table headings, table notes, clue headings and clue text inherit dark text.
Night mode retains its own dark background.
The live phone check measured approximately 1.11:1 contrast for these elements.
The same elements measured approximately 17.62:1 with the page theme set to dark.
The separate visual check failed. This phase returns **no-go** until the Night mode palette is corrected.
This test phase leaves application source unchanged.

New evidence remains under `r2/` in the external evidence directory named above.
`r2-production-browser.log` is beside that directory and records the completed production build and browser specification.
`r2/live-results.json` and `r2/journeys.log` record the seven passing journeys.
`r2/production-policy-results.json` records production storage refusal.
`r2/night-contrast-results.json`, `r2/night-contrast-light.png` and `r2/night-contrast-dark.png` record the visual failure.
`r2/process-status.json` and `r2/contrast-process-status.json` record the completed drivers and intentional server shutdowns.
The servers received SIGTERM after their drivers completed. Their recorded exit status is -15.
The temporary driver initially expected 409 for completed-prefix refusal. The endpoint correctly returned 403 without changing the route.
The corrected driver checked that refusal and the unchanged route, then passed.
An earlier driver wrapper also treated intentional SIGTERM as a failure. The corrected wrapper records the expected shutdown explicitly.

The screenshots were inspected. The clue journeys use disposable upstream walking geometry and a deliberate provider failure.
These checks do not prove real-provider routing, physical-device behaviour or native-shell acceptance.
All disposable browsers, servers and PostgreSQL clusters stopped. Temporary build and generated data outputs were removed.
The outer executor still owns the configured gate, PR and remote CI.
No merge, deployment, production promotion or live migration occurred.

## Night mode contrast repair on 31 October 2026

This repair tested `e98ed5553f54e05422246b8a02ed4601e848e26f` plus the uncommitted CSS and browser-test changes in `r3/repair.patch`.
The new phone browser regression reproduced the reported failure before the CSS change.
The light theme measured 1.11:1 for the table heading. The dark theme passed.
The focused reproduction exited with code 1.

Shared panels inherited the page palette over Night mode's fixed dark background.
Night mode now supplies its existing palette through the shared panel and control tokens.
The repair adds no new colours and leaves the full Plan's theme unchanged.

The following focused command rebuilt the application through the restored-output wrapper and exited with code 0:

```sh
PW_PORT=3187 PW_NEXT_DIST_DIR=.next-v1-contrast PW_SKIP_KEYLESS_WEBSERVER=1 PUBMAX_TRACKED_OUTPUTS=public/data node node_modules/@playwright/test/cli.js test e2e/v1-night-extras.spec.ts --project=chromium --workers=1 --grep 'Night mode readability'
```

Both phone cases passed at 390 by 844, with explicit light and dark page themes.
Each case created a Plan, recorded a bound arrival, set a private table sign and opened the clue introduction.
The checks measured headings, notes, table links, the note field and panel buttons against the WCAG AA 4.5:1 text threshold.
The minimum measured ratio was 7.41:1 across 14 text samples in each theme.
A final focused repeat reused the completed production build with `PW_SCREENSHOTS=1` and also exited with code 0.
All four screenshots were inspected.

The external evidence directory retains `r3-contrast-red.log`, `r3-contrast-after.log` and `r3-contrast-final.json`.
`r3/contrast-final/` contains the screenshots. `r3/contrast-light.json` and `r3/contrast-dark.json` contain the measurements.
`r3/process-status.json` records the check exits and the closed server port.
The disposable browser and server processes stopped. The temporary build and newly generated data files were removed.
Existing dependencies were retained.

This result supersedes the Night mode contrast failure above.
It covers the clue introduction rather than a newly repeated sourced-answer journey.
Earlier functional journeys remain historical evidence. Phone evidence still uses desktop Chromium.
Physical-device and native acceptance remain outstanding.
This repair did not repeat the linter, formatter, separate static analysis, full suite or configured gate.
The earlier configured gate failure remains unresolved for the outer executor. Remote CI remains required.
No merge, deployment, production promotion or live migration occurred.


## Final candidate test on 31 October 2026

This phase tested `a01a52b1c3d4e3a04d4dbe108eb7379acf520ff6`.
The isolated production build and all focused product journeys passed.
The supplied configured command failed before this phase with exit code 1.
This phase did not repeat that command, lint, static analysis or the full suite.
The outer executor still owns resolution of that configured failure and remote CI.
Product checks pass, but this phase returns **no-go** because the required configured command remains failed.

The browser command completed through the restored-output wrapper:

```sh
PW_PORT=3187 PW_NEXT_DIST_DIR=.next-v1-test-r4 PW_SKIP_KEYLESS_WEBSERVER=1 PUBMAX_TRACKED_OUTPUTS=public/data node node_modules/@playwright/test/cli.js test e2e/v1-night-extras.spec.ts --project=chromium --workers=1 --output=/Users/karanmanoharan/.no-mistakes/evidence/01M69HEAA3GT8PSTA3844GERAK/r4/browser-results
```

Both desktop and phone cases passed, at 1440 by 1000 and 390 by 844.
The phone contrast cases also passed with explicit light and dark page themes.
These cases checked the table heading, note, links, field, buttons and clue introduction against the 4.5:1 text threshold.
The four retained contrast screenshots show readable text and controls.

The additional production journeys checked these behaviours:

1. Table signs require bound arrivals, reject guest changes, expire and clear after another arrival.
2. Safe route changes preserve completed mystery titles with a stale phone cursor.
   Stale arrival and skip requests fail without changing actions.
   Completed stops cannot change, and a route change clears the table sign.
   Bound arrival retries create one action. Legacy arrivals establish no table location.
3. Route comparison leaves the saved route unchanged and discloses unknown prices and straight-line distance estimates.
   A host marked Here can propose. A guest can vote but cannot accept.
   Explicit host acceptance saves the proposed route.
4. Clues reveal sourced answers after a manual action and leave the route and actions unchanged.
5. Lost proposal responses retain the same key for the same payload.
   Another option uses another key and creates another proposal.
6. Unresolved required needs prevent acceptance. The accepted anchor cannot move.
7. A failed walking provider supplies no clues from straight-line fallback.

The production storage check returned 503 for all five beacon and presentation operations without durable credentials.
The browser specification also checked host-only settings, separate guest reveals, the full-route escape and stranger refusal.
The clue journeys used disposable upstream walking geometry and a deliberate provider failure.
They do not establish real-provider availability or pavement accuracy.

The repository database generator completed against disposable PostgreSQL without changing `types/database.ts`.
An initial attempt exceeded PostgreSQL's socket-path limit inside this long worktree path.
A private temporary directory resolved the setup problem. No permanent test-tool change was needed.
All 19 focused behaviour suites passed, including all three changed migration suites.
These include presence values, current membership, token rotation and collaboration permission checks in PostgreSQL.
The temporary Vitest configuration retained repository setup and disabled only the enrichment builder.
The production build ran the normal application builders.

Evidence remains under `r4/` in the external evidence directory named above.
`production-browser.log` records the completed production build and browser specification.
`live-results.json` retains product requests and results. The PNG files show the product journeys.
`production-policy-results.json` retains the production storage refusals.
`database-types-retry.log`, `focused-tests.log` and `focused-check-status.json` retain the supporting checks.
`process-status.json` records successful drivers and intentional server shutdowns.
`cleanup.json` records the closed private port and removed disposable outputs.

The screenshots were inspected. All disposable browsers, servers and PostgreSQL clusters stopped.
Temporary build outputs, generated data and test configuration were removed. Existing dependencies were retained.
This phase changed only this evidence document.
Phone evidence uses desktop Chromium. Physical-device and native-shell acceptance remain outstanding.
No merge, deployment, production promotion or live migration occurred.

## Focused memoisation repair on 31 October 2026

This repair starts from `a01a52b1c3d4e3a04d4dbe108eb7379acf520ff6` and preserves the evidence changes already present in the worktree.
The supplied gate output reports `react-hooks/preserve-manual-memoization` errors for `runAction` and its `hero` dependency.
The handler only serves local click callbacks. Its identity does not need to remain stable between renders.
The repair removes its manual `useCallback` wrapper and dependency list, without changing the action body.

The exact reported lint failure was not reproduced or rechecked because this phase explicitly prohibits lint and static analysis.
The configured gate remains unverified after this repair. The outer executor must repeat that gate.
No new source-pattern test was added to stand in for the compiler check.

Both focused behaviour suites passed before and after the repair, with 15 tests and exit code 0 each time:

```sh
node node_modules/vitest/vitest.mjs run --config .v1-action-focused.config.mts __tests__/nightCrawlCapabilityJourney.test.tsx __tests__/nightCrawlMode.test.ts
```

The temporary configuration retained repository setup, selected these two suites and disabled only the unrelated enrichment builder.
These tests cover arrival and skip permissions, offline recovery, refusal rollback, ending handoff and completed reveals after route changes.
An initial configuration attempt was interrupted with exit code 130 before test results because configuration merging could widen the selectors.
The successful runs used explicit selectors and replaced the include list directly.
The initial attempt generated Places enrichment files. This phase removed those files and the temporary configuration.
All test processes finished. This phase started no browser or server.
Earlier browser evidence remains historical. This repair does not claim a new build, browser pass or configured gate pass.


## Action-handler candidate test on 31 October 2026

This phase tested `84b62b3fc3e2fae3a8572f9bc3eccb119ab9d65d`.
The isolated production build and all focused product journeys passed.
The supplied configured command, `npm run verify:no-mistakes:changed`, failed before this phase with exit code 1.
Its current diagnostic output was not supplied.
This phase prohibits lint and static analysis, so it did not repeat that command.
The outer executor must resolve that failure. This phase returns **no-go** despite the passing product checks.

The production browser command exited with code 0:

```sh
PW_PORT=3187 PW_NEXT_DIST_DIR=.next-v1-test-r5 PW_SKIP_KEYLESS_WEBSERVER=1 PUBMAX_TRACKED_OUTPUTS=public/data NEXT_TELEMETRY_DISABLED=1 node node_modules/@playwright/test/cli.js test e2e/v1-night-extras.spec.ts --project=chromium --workers=1 --output=/Users/karanmanoharan/.no-mistakes/evidence/01M69HEAA3GT8PSTA3844GERAK/r5/browser-results
```

The restored-output wrapper completed the production build before the browser checks.
The desktop and phone cases checked host settings, separate guest reveals, table signs, stranger refusal and unchanged route and arrival state.
The phone readability cases passed with explicit light and dark themes.
The two focused Night mode behaviour suites also exited with code 0.
Their temporary configuration retained repository setup and disabled only the unrelated enrichment builder.

Eight additional journeys passed against the completed production build.
The new phone journey interrupted an arrival request, reloaded the page and confirmed one bound arrival from the queued request.
It then skipped the next stop through the Night mode button and checked the stored venue, revision and unchanged route.
The remaining journeys repeated table expiry, host permissions, stale arrival refusal, completed-prefix preservation and completed mystery reveals.
They also repeated explicit host acceptance, proposal response recovery, required needs, anchor protection, sourced clue reveals and walking-provider failure.
Production policy returned 503 for all five beacon and presentation operations without durable credentials.

The only source change since the previous candidate is the Night mode action-handler repair.
The SQL migrations and generated database types are unchanged.
The previous database generation and PostgreSQL regression results remain historical evidence for those unchanged files.
This phase did not repeat them or claim a new durable browser session.

New evidence remains under `r5/` in the external evidence directory named above.
`production-browser.log`, `action-tests.log`, `live-results.json` and `production-policy-results.json` retain the checks and product responses.
The PNG files show table signs, comparisons, sourced clues, completed reveals and the recovered phone action journey.
The screenshots were inspected.
The clue journey uses disposable upstream walking geometry. The fallback journey supplies an upstream 503.
These checks do not establish real-provider availability or pavement accuracy.
Phone evidence uses desktop Chromium. Physical-device and native-shell acceptance remain unverified.
All disposable browsers and servers stopped. Temporary build outputs and test configuration were removed.
No merge, deployment, production promotion or live migration occurred.

## Focused legacy-action test correction on 31 October 2026

This phase tested `e03608dee4bb561afbaa2275441007009873173a`.
The change since the previous tested candidate narrows an optional action before the existing assertions.
It also preserves the previous evidence entry. Runtime code is unchanged.
The test still requires one legacy action without a venue or revision stamp.
It also requires no completed reveal or current table location from that action.

The affected behaviour suite ran once and passed all seven cases with exit code 0:

```sh
node node_modules/vitest/vitest.mjs run --config .v1-binding-focused.config.mts __tests__/planActionBinding.test.ts
```

The temporary configuration retained repository setup and selected only this suite.
It disabled the unrelated enrichment builder. This phase removed the temporary configuration after the run.
The log remains at `/Users/karanmanoharan/.no-mistakes/evidence/01M69HEAA3GT8PSTA3844GERAK/r6/action-binding-tests.log`.

The latest recorded decision prohibits repeated builds, browser journeys and SQL proofs for this test-only correction.
The previous production and browser results remain historical evidence at `84b62b3fc3e2fae3a8572f9bc3eccb119ab9d65d`.
This phase captured no new screenshots and started no browser or server.
It did not run lint, type checking or the configured verification command.
The outer executor must rerun configured verification. This focused pass does not establish full gate success.

## Five test repairs and live legacy retry on 31 October 2026

This phase tested the working tree based on `e03608dee4bb561afbaa2275441007009873173a`, with the repairs recorded below.
The repairs remain uncommitted for the outer executor.
The source and test patch is `r7/repair.patch` under the existing external evidence directory.
Its SHA-256 is `88acf0f016c15e071d893fabada239f6ea7906c24c663d91761c7de7bc02a582`.
The earlier evidence edits remain intact.

The five reported failures reproduced together before the repairs. The command exited 1, with five failures and 40 passes.
`r7/reproduction.log` records the exact failures.

The repairs address these causes:

1. The export inventory omitted two shared Plan stores. Named exclusions now explain their ownership, including other members' private notes.
2. The envelope icon used an unsupported size. It now uses the existing 20-pixel size.
3. The numbering test required a bare `<strong>` tag. It now checks rendered list items, pub names and visible numbers against accessible list order.
4. The memory link allowed automatic prefetching. It now uses `prefetch={false}`.
5. The read inventory omitted capability-sensitive interactions. Its existing exception mechanism now records their private lifecycle and executed behaviour tests.

The cache policy permits callers to retain their own data policy.
Private table notes and host settings cannot safely use held reload snapshots after membership changes.
The existing body deadlines, cancellation, owner boundaries and late-response guards remain in place.
Sliding Doors now explicitly uses `no-store` and same-origin credentials.
Executed tests check capability headers and prevent proposal credentials from reaching public venue reads.
The inventory declarations describe policy. They do not prove runtime protection by themselves.

The five failing suites and nine affected feature suites ran together after the repairs.
All 103 tests passed across 14 files. The command exited 0. `r7/focused-tests.log` records the selected files.
The three clue suites then passed all 23 tests with exit code 0. Their log is `r7/clue-tests.log`.
Both runs used the normal repository test configuration.

The isolated production build and all five browser cases passed with exit code 0:

```sh
PW_PORT=3189 PW_NEXT_DIST_DIR=.next-v1-test-r7 PW_SKIP_KEYLESS_WEBSERVER=1 PUBMAX_TRACKED_OUTPUTS=public/data NEXT_TELEMETRY_DISABLED=1 node node_modules/@playwright/test/cli.js test e2e/v1-night-extras.spec.ts --project=chromium --workers=1 --output=/Users/karanmanoharan/.no-mistakes/evidence/01M69HEAA3GT8PSTA3844GERAK/r7/browser-results
```

The restored-output wrapper ran the build. `r7/production-browser.log` records the completed command.
The browser cases covered desktop and phone host settings, guest reveals, private table signs and stranger refusal.
The phone readability cases passed in light and dark themes.

The new live scenario submitted the same legacy unbound arrival twice to the local production server.
Both requests returned 201. The stored action list contained one identical action without a venue or revision stamp.
The beacon read returned no current pub and no table sign.
With mystery settings enabled, the browser kept stop 2 sealed and offered no table-sign form.
The browser checks left the route revision and action list unchanged.

A focused repeat reused the same production build and exited 0 after adding a persistent screenshot path to this test.
Application source did not change between these browser runs.
`r7/legacy-result.json` records one passing case, zero failures and zero flaky results.
`r7/legacy-responses.json` retains the product responses. `r7/legacy-results/` retains the screenshot.
The legacy screenshot and the phone table and clue screenshots were inspected.

The server used the repository keyless environment on private port 3189. No live service or live database was used.
Phone evidence uses desktop Chromium. Physical-device and native-shell acceptance remain unverified.
Disposable browsers and servers stopped. Port 3189 has no listener.
Temporary build outputs, generated enrichment files and working-tree test logs were removed. Dependencies remain installed.

This phase did not run lint, static analysis, the complete suite or the configured verification command.
The supplied full-suite result remains historical: 45,288 passed, five failed and one skipped before these repairs.
The outer executor must rerun the configured command, including PostgreSQL, freshness and audit stages.
These focused passes do not establish full gate success or PR readiness.
No merge, deployment, production promotion or live migration occurred.

## Candidate acceptance after the configured repair on 31 October 2026

This phase tested `2af80282f867b12a4f72dc71424318d983e3b417`.
The outer executor supplied a successful baseline for `npm run verify:no-mistakes:changed` before this phase.
That result supersedes the earlier configured-command failures recorded above.
This phase did not repeat the configured command, lint, static analysis or the full suite.

The isolated production build and all five browser cases completed with exit code 0:

```sh
CI=1 PW_PORT=3191 PW_NEXT_DIST_DIR=.next-v1-test-r8 PW_SKIP_KEYLESS_WEBSERVER=1 PUBMAX_TRACKED_OUTPUTS=public/data NEXT_TELEMETRY_DISABLED=1 node node_modules/@playwright/test/cli.js test e2e/v1-night-extras.spec.ts --project=chromium --workers=1 --output=/Users/karanmanoharan/.no-mistakes/evidence/01M69HEAA3GT8PSTA3844GERAK/r8/browser-results
```

The server used the repository keyless configuration and a fresh process-only signing secret.
Live provider credentials were absent. Playwright owned the private port and the restored-output build wrapper.
The cases checked these behaviours:

1. A legacy arrival retry creates one unstamped action, no table location and no completed-stop reveal.
2. Phone table details and clue controls remain readable under explicit light and dark page themes.
3. Desktop and phone hosts control mystery settings and create private table signs.
4. Guests retain separate reveals and the full-route escape. Strangers cannot read private settings or table signs.
5. Reveal and table interactions preserve the saved route revision and arrival actions.

Three additional browser journeys passed against the same completed build:

1. Comparisons preserve the saved route and disclose unknown prices and straight-line estimates.
   A host marked Here can propose. A guest cannot accept. Explicit host acceptance saves the proposed route.
2. Clues reveal sourced answers manually and preserve the route and arrival actions.
3. Lost proposal responses retain one key for the same payload. Another option creates a different proposal with another key.

The clue journey used disposable upstream walking geometry. It does not establish real-provider availability or pavement accuracy.
These repeats cover the latest private-read and visible-control repairs.
Earlier SQL, route-preservation, expiry and production-refusal evidence remains historical evidence for unchanged code, as the recorded decision permits.
This phase did not repeat those checks or claim a new durable browser session.

New evidence remains under `r8/` in the existing external evidence directory.
`production-browser.log` and `browser-status.json` record the completed build and browser specification.
`live-results.json` retains product responses and the three additional journey results.
The screenshots show legacy arrival restrictions, both phone themes, route comparisons and the sourced clue answer.
The screenshots were inspected. `process-status.json` records the successful additional driver and intentional server shutdown.
`cleanup.json` records the closed private port and removal of disposable build and generated data outputs.
Dependencies and pre-existing outputs remain intact.

This phase changes only this proof document after testing the named commit.
Phone evidence uses desktop Chromium at 390 by 844. Desktop evidence uses 1440 by 1000.
Physical-device and native-shell acceptance remain unverified. Remote CI remains the outer executor's responsibility.
No merge, deployment, production promotion or live migration occurred.
