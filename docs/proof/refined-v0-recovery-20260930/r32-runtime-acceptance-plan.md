# R32 Core runtime acceptance plan

**Status: plan only.** Core has a conditional reservation for 18:39 to 20:09 UTC on 30 September. A reservation is not a runtime grant. Do not start until the coordinator grants the slot and the current owner confirms release. Finish test work by 20:06. Use 20:06 to 20:09 to stop owned processes, check ports, save receipts, and hand off. This document records no execution.

## Current starting point

R31 changed only the DOMPurify version, resolved URL, and integrity in `package-lock.json`. The lock targets 3.4.16. R31 recorded installed DOMPurify 3.4.15, so the new lock has not yet been installed or tested. AI 7.0.123 and OpenTelemetry 1.0.123 already passed R28. Keep those entries. TypeScript 7 still has a parser peer mismatch and is outside this slot. R28's source gate and build passed on the earlier 4,247-file freeze. They are historical evidence for the current candidate. See the [R31 dependency handoff](r31-freshness-dependency-and-acceptance.md), [lock patch receipt](r31-core-dependency-patch.json), [R28 source gate](r28-source-verify-receipt.json), and [R28 build and focused replay](r28-fresh-build-focused-receipt.json).

R25's original full-five run failed. Later focused passes do not clear it. R31 identifies three issues for native reproduction or follow-up: a false beer-category claim, a printed gin measure missing from the serving field, and `anchorVenueId` in anonymous shared-plan client props. The [R25 cleanup receipt](r25-terminal-cleanup-receipt.json) and [R25 diagnostic seams](r25-next-diagnostic-seams.md) retain earlier failure boundaries and limits.

## Run in this order

1. **Get the runtime grant and check cleanup.** Confirm the previous runtime owner has released the slot. Check that owned process groups are gone and the selected Playwright ports are free. The example below uses 3351 and 3352. Do not stop processes owned by another lane. If a foreign process or an unconfirmed handoff remains, stop and report the conflict. Record the worktree HEAD, `git status`, and current diffs so the run preserves other owners' edits.

2. **Install the reviewed lock.** Run `npm ci --ignore-scripts` once. Then confirm that the installed `dompurify` package reports version `3.4.16`, for example with `node -p "require('./node_modules/dompurify/package.json').version"`. If install fails or reports another version, stop before building. Do not install Playwright browsers or change the browser version. Use the existing pinned browser cache.

3. **Freeze and build the pre-repair candidate.** Record a source manifest after installation. Before using the build wrapper, inspect `public/data` changes and confirm which owner each belongs to. The wrapper restores those files from `HEAD`, not from their pre-run bytes. Save the exact bytes and hash for any intended retained-row change. After the wrapper runs, restore that owned snapshot, verify it, and rebuild before testing. Apply the same rule to any later data repair. If a reviewed read-boundary repair is sufficient after a native RED, prefer it over changing retained data. Do not change the shared wrapper. Build a local production candidate in a separate output directory with `DEPLOYMENT_VERSION=local` and `PUBMAX_TRACKED_OUTPUTS=public/data`. Do not run a development server beside a build.

4. **Capture native REDs before repairs.** Drive the local production build in Chromium through the existing Playwright setup. Do not replace the relevant responses with HTTP doubles for these observations. This proves local browser behaviour, not a live provider or production database.
   - Inspect the actual price claim and its category, source, and serving disclosure. Keep publisher-listed and community-logged prices distinct.
   - Open Brownswood's retained gin row, `£4.20` with `Gin ~ 25 ml Sacred`. Record whether the UI loses `25 ml` and says the serving was not recorded.
   - Open an anonymous shared plan and inspect the data delivered to its client. Confirm whether `anchorVenueId` is exposed. Keep this check signed out.

   Save each result, including a clear RED when observed. If a flow does not reproduce, record that fact and do not patch it from source suspicion alone. An intercepted `201` proves UI intent only. It does not prove a durable bill or price write.

5. **Repair only reproduced defects.** Preserve the source/category distinction and any explicitly printed measure. Do not add generic pour-size defaults or broad heuristic recategorization. Remove only anonymous plan data that the UI does not need, while preserving the plan's allowed behaviour. Add focused regression coverage at each changed owner.

6. **Freeze, rebuild, and run focused checks.** Record a new source manifest for the final candidate. Build it in an isolated production output directory. Run the affected unit tests, scoped lint, TypeScript, and focused browser cases against the repaired flows. Record the exact build ID and source manifest. Do not use a focused pass as full-suite acceptance.

7. **Run the full source gate.** Run `DEPLOYMENT_VERSION=local npm run verify` against the frozen candidate. Preserve its exact exit code, counts, lint warnings, and feed audit results. A fresh pass is required; R28's earlier pass does not cover the R31 lock delta or any R32 repairs.

8. **Run the full five-project browser suite only if it fits.** Keep Playwright's local defaults: two workers and zero retries. Use the configured projects `chromium`, `chromium-keyless`, `chromium-gl`, `chromium-sw-gl`, and `chromium-no-gl`. Do not enable screenshot projects or real-auth projects for this keyless acceptance run. Keep the ports free before launch. Playwright's config must build and start its own servers; leave `PW_SKIP_WEBSERVER` unset. Do not rely on an existing listener.

   Example invocation, after confirming ports 3351 and 3352 are free:

   ```sh
   env -u CI \
     DEPLOYMENT_VERSION=local \
     PW_PORT=3351 \
     PW_KEYLESS_PORT=3352 \
     PW_NEXT_DIST_DIR=.next-r32-fullfive \
     PW_KEYLESS_NEXT_DIST_DIR=.next-r32-fullfive-keyless \
     PW_SKIP_WEBSERVER= \
     PW_SKIP_KEYLESS_WEBSERVER= \
     PW_DISPOSABLE_PLAN_DB= \
     PW_SCREENSHOTS= \
     PW_FIREFOX_DESKTOP_MAP_CHROME_FIT= \
     PW_WEBKIT_PROFILE_PHOTO_CROP= \
     PUBMAX_TRACKED_OUTPUTS=public/data \
     PUBMAX_E2E_LOGIN=0 \
     NEXT_PUBLIC_SUPABASE_URL= \
     NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= \
     npm run test:e2e -- \
       --workers=2 \
       --retries=0 \
       --project=chromium \
       --project=chromium-keyless \
       --project=chromium-gl \
       --project=chromium-sw-gl \
       --project=chromium-no-gl
   ```

   The config enables the test-only keyless store, generates a fresh Plan signing secret, and sets the test-only rate-limit allowance. The blank optional flags keep the run to the five named projects and let Playwright own both servers. The command pins two workers and zero retries explicitly. Do not print or pass secrets on the command line. The e2e rules require free ports because Playwright can reuse a stray listener.

9. **Stop at the cleanup boundary.** Finish active tests by 20:06 UTC. Stop only processes owned by this run. Confirm the owned process groups are absent and ports 3351 and 3352 are free. Save logs, reports, source and build identities, and any incomplete-test status before handoff at 20:09. If a gate cannot finish inside the slot, record it as pending. Do not extend or overlap another owner's runtime.

## Evidence this slot cannot close by itself

- The keyless browser suite and auth doubles do not prove real provider sign-in, sign-out, or account switching.
- A route intercepted with `201` does not prove a bill or price was durably stored and read back.
- Anonymous and authenticated cache isolation still needs an explicit two-session browser proof, including relevant service-worker state.
- The strict default-five CWV gate remains separate. Keep its sample count, device profiles, metrics, and ceilings unchanged. If the slot has time after the other gates, run the existing `npm run perf:cwv-sweep` unchanged. A 47-route resource-budget pass or a full Playwright run cannot replace it. Do not claim a timing improvement from the older R19 measurement without a controlled run on the repaired candidate.
- A local build or gate is not production deployment, live-provider verification, shared SQL migration, or account-write proof.

If the runtime grant does not arrive, or any gate remains unfinished, leave those requirements open and hand back the exact last completed step. Do not report the goal or release as complete.

## Candidate compatibility check, 18:36 UTC

Core still contains the generic `No listed price` span in `components/map/MapSearchSuggest.tsx`. Published integration commit `743e3bf66089a55c055d2aa8f4d5ee6cdbb01e5e` removes that exact span. A direct file comparison against integration head `2c9b0afc9443e234f00354e2329a0e05ac3b9f87` found only that one-line difference in this file. Integration owns the change; Core has not copied it. Record this gap as pending in the next freeze until an authorized owner transfer arrives. Core checks cannot certify the separate integration candidate.

R35 process journals, a 20:06 UTC cleanup guard, and an isolated keyless environment launcher are prepared under `/tmp` but have not run. Native price and anchored-plan privacy diagnostics remain unrun. Integration's final-head local gate and actual cleanup receipt still precede the conditional Core slot.
