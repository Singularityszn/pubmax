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
