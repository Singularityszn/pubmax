# iOS lane E map data loading

## Scope and reproduction

The original run used `origin/main` at commit `835b91ab6ffeaca1533c612ad88db470aaae8b96`. Both variants used production builds, identical committed data, and `NEXT_PUBLIC_SW_VERSION=local`. The build directories were `.next-lane-e-before` and `.next-lane-e-after`. The local servers used ports 3481 and 3482.

The historical report lives at `/Users/karanmanoharan/karan-agent-workspace/data/pubmax-ios-app-qa/report.md`. Its F06 and F08 findings still reproduced. This viewport made 15 provisional reads over 901 IDs, rather than the historical 14 reads. Map and Tonight downloaded separate What's-On responses on re-entry after five seconds.

The ownership review covered https://github.com/Singularityszn/pubmax/pull/2045 and https://github.com/Singularityszn/pubmax/pull/2065. The merged fanout work already shared matching pending reads and recent answers. This branch changes no POI loader, map warmup, navigation, map chrome, or Android sheet code.

## Changes and decisions

Provisional reads use two concurrent requests across the whole hook. Each request still carries at most 64 IDs. A newer settled viewport takes the next turn after pending reads finish. A refusal stops dispatch and retains the existing backoff. Unmount aborts pending reads. Successful reads remain deduplicated, while failed and interrupted reads remain retryable. No price figure, provenance, corroboration threshold, API budget, or performance ceiling changes.

Anonymous What's-On lists reuse a successful answer for at most one minute before revalidation. The existing ten-minute snapshot can still seed a paint during revalidation. Nearness reads retain five-second reuse and coarse coordinates. Exact URL keys keep `pubOnly` results separate. The loader validates each answer's `servedAt` against the current London service night before publication or caching. It also refuses to join requests started before the latest 04:00 rollover. The existing timezone-aware service window resolves that boundary independently on DST days. Public request URLs remain byte-for-byte compatible. Explicit retry bypasses a snapshot and an older pending request. Source observation times remain unchanged. Account rotation still clears the existing surface cache.

Viewport filtering was considered and rejected as a duplicate. The canvas already supplies projected on-screen base pubs. Wider batching was rejected because the existing 64-ID bound should remain intact.

## Behavioral TDD

The first F06 test failed on the original code because one request started instead of two. The first F08 test failed because a ten-second return made two requests instead of one. The red logs are committed beside this report.

The new suites exercise dense viewports, overlapping camera changes, refusal backoff, cancellation, expiry, pub-only separation, coarse location reads, service-night rollover, explicit retry, account rotation, and fail-soft outages. The tests observe the public hook or loader and the HTTP boundary.

The initial full gate caught three exact-URL compatibility failures caused by an added service-day query parameter. A focused reproduction confirmed those failures. The parameter was removed, and snapshot age was limited by the rollover boundary. That age limit did not protect requests that completed after rollover. The existing compatibility assertions remain intact. Initial behavioral tests covered completed snapshots across spring and autumn DST rollover and explicit retry during a pending read. The original red logs and refreshed green log are committed beside this report.

The refreshed focused verification passed 90 tests across five suites. Another 66 tests passed for price client state and service-day rules. Both production builds passed, and the after build was rebuilt after the URL correction. Both Capacitor sync commands completed sequentially without tracked native changes.

Before the R1 correction, the refreshed `npm run verify:no-mistakes` exited 0. Coverage passed 1803 files and 21437 tests, with one existing skipped file and test. RLS, the e2e skip fence, freshness, install-script policy, and dependency audit passed. Lint reported zero errors and 85 existing warnings. Freshness identified three credential-dependent stores as unmeasurable, and did not claim them fresh. The original run referenced `artifacts/lane-e/verify-refreshed.log`. That full log is absent from this pipeline worktree, so this report does not provide an inspectable copy.

## R1 rollover race correction

Review identified a race absent from the initial proof. A request can begin at 03:59:59 London and return previous-night rows at 04:00:01. The cache records completion time, so the earlier age limit accepted those rows. A caller arriving after rollover could also join the older pending request.

The new regression suite executes the loader with deferred HTTP responses and a controlled clock. Its first run failed all 40 cases on the reviewed implementation. `tdd-rollover-race-red.txt` records previous-night publication, pending-request sharing, invalid service metadata, and snapshot reuse after late completion.

The correction uses the API's existing `servedAt` field for both network and snapshot validation. Successful answers with missing, invalid, or previous-night service metadata cannot publish or enter the cache. A small shared-cache change records request start time and accepts a caller's earliest joinable request time. Other callers retain their existing sharing behavior. The loader supplies London's latest 04:00 boundary. This preserves the original HTTP URLs and cache keys.

The final regression suite contains 53 cases. It covers public, near, pubOnly, and combined near/pubOnly reads during BST and both DST transitions. Cases include late completion, arrival during an older pending read, subsequent snapshot reuse, repeated stale responses, and same-night sharing with cancellation. Existing loader and cache suites cover reuse expiry, explicit retry, source provenance, account rotation, timeout, and storage behavior. Their response fixtures now include the service metadata that the API already emits. Source-date and URL assertions remain unchanged.

Focused verification passed all 143 tests across six suites. The command was `./node_modules/.bin/vitest run __tests__/whatsOnTonightRolloverRace.test.ts __tests__/whatsOnTonightPublicReuse.test.ts __tests__/useWhatsOnTonight.test.ts __tests__/patchSeamAdoption.test.ts __tests__/surfaceDataCache.test.ts __tests__/surfaceReadDedupe.test.ts`. `tdd-rollover-race-green.txt` records the result. The earlier full-gate results and five measured pairs predate this correction. This review phase does not repeat the full gate, production measurements, or native validation. The outer executor owns those phases and PR publication. The eventual PR body must link both rollover race logs and the five-pair measurements above.

## Five interleaved pairs

Chrome used the same session, a 390x844 mobile viewport, light theme, and DevTools Fast 4G emulation for every sample. Samples alternated before 1, after 1, through before 5, after 5. No full repository gate ran during sampling.

Each sample cleared localStorage and sessionStorage before a new document load. "Cold" means a cold app surface cache. Browser HTTP caches were not explicitly cleared. The first load of each build included its initial assets. Each cold map was observed for nine seconds. Client navigation then visited Tonight, Map, and Tonight, with three seconds per visit.

All five cold pairs requested identical ID multisets and received HTTP 200 answers. Each provisional answer decoded to 15 bytes. A replay against both servers returned the same `{"venueIds":[]}` body and hash. This keyless dataset measures transport and scheduling. It does not measure durable database latency or positive price coverage. `samples.json` includes counts and matching ID hashes. `price-response-replay.json` records the replay.

| Metric | Before median, range | After median, range |
| --- | --- | --- |
| Cold provisional waterfall | 2634.6 ms, 2629.2-2639.6 | 1407.1 ms, 1402.3-1420.9 |
| Cold provisional requests | 15, 15-15 | 15, 15-15 |
| Cold provisional transfer | 4725 bytes, 4725-4725 | 4725 bytes, 4725-4725 |
| Maximum concurrent provisional reads | 1 | 2 |
| Cold Map What's-On | 1 request, 64319 transfer bytes | 1 request, 64319 transfer bytes |
| First Tonight What's-On | 1 request, 44048 transfer bytes | 1 request, 44048 transfer bytes |
| Warm Map What's-On | 1 request, 64319 transfer bytes | 0 requests, 0 bytes |
| Warm Tonight What's-On | 1 request, 44048 transfer bytes | 0 requests, 0 bytes |
| Cold first provisional answer, from document start | 2997.0 ms, 2220.1-4336.8 | 2995.6 ms, 2960.9-4169.5 |
| Cold final provisional answer, from document start | 5452.6 ms, 4683.3-6792.1 | 4238.1 ms, 4192.9-5395.7 |
| Cold first visible pins | 648.6 ms, 436.3-2459.7 | 523.0 ms, 508.8-2416.2 |
| First Tonight ready or empty surface | 259.7 ms, 258.3-458.4 | 264.4 ms, 258.0-456.8 |
| Warm Map listings control available | 382.4 ms, 204.1-573.4 | 426.2 ms, 407.9-540.9 |
| Warm Tonight ready or empty surface | 29.5 ms, 28.0-31.1 | 34.5 ms, 31.3-36.8 |

The provisional waterfall improves by 46.6%. Request counts and cold bytes do not improve. Warm re-entry avoids 108367 transfer bytes and 107767 decoded bytes across the two distinct listing keys.

First usable pins and surface readiness do not show a reliable improvement. Warm Map control availability has a higher median and overlapping ranges. Warm Tonight readiness is slightly slower, despite avoiding its download. These changes support faster completion of provisional reads and fewer repeated downloads. They do not establish faster production page loads.

The three-second warm map observation cuts the baseline waterfall short. It records 10-11 completed provisional requests before leaving. Another 2-3 complete on Tonight after the map unmounts. The after variant completes all 15 within the map observation and records no later provisional completions on Tonight. These partial warm counts are not a claim of fewer price requests.

No rendered markup, styling, or layout changes. The conditional 390x844, 768, and 1440 light/dark screenshot requirement does not apply.

## F07 and remaining limits

Six repeated Map/Tonight visits were observed in the same Chrome document after the initial loading changes, before the URL compatibility correction. Map JavaScript heap ranged from 142.7 to 178.7 MiB. Tonight ranged from 139.5 to 173.4 MiB. Every exit left zero canvas elements. `repeat-browser-memory.json` contains the readings. Garbage collection was not forced, and these are browser JavaScript heap readings, not WebKit RSS or GPU memory. They establish no leak verdict.

`xcrun xctrace list devices` listed the physical iPhone as offline. Real-device Instruments, WebKit memory, touch behavior, and Android runtime performance remain unverified. No MapLibre redesign was attempted. This limitation does not block the two measured data-loading changes.

## Raw evidence and handoff

The original run referenced raw samples, build logs, sync logs, and the Instruments device inventory under its `artifacts/lane-e/` directory. Those original files are absent from this pipeline worktree. The committed `samples.json`, `price-response-replay.json`, `repeat-browser-memory.json`, and TDD logs preserve the available original evidence. The sample file removes camera coordinates and replaces ID lists with counts and hashes. The supplied measurement scripts now live in [procedure/](procedure/), as described below.

The five pairs above were refreshed after the URL correction. The original run referenced raw samples, `samples-refreshed.log`, and `after-build-refreshed.log`. Those files are absent from this pipeline worktree. Firstmate owns merges and deployment decisions. The no-mistakes pipeline owns validation edits, publication, and CI. No deployment, migration, live POST, or paid service call was made.

## Pipeline replay of the supplied original procedure

The pipeline test phase restored the three scripts from the typed decision's inline source. The original failure was a missing measurement procedure inside this worktree. The earlier reconstructed rig yielded 884 IDs and did not satisfy the original 901-ID comparison.

The preserved script copies are in [procedure/](procedure/). `sample.js` retains the supplied measurement operations. `measure.mjs` and `summarize.mjs` change only output paths, so earlier samples remain untouched. The files are also materialized at `artifacts/lane-e/` for execution.

The replay compares baseline `835b91ab6ffeaca1533c612ad88db470aaae8b96` with pipeline head `d7049dd2016446cef64c9ab64479675632432dc9`. Both source archives, dependencies, compiled outputs and servers remained inside this worktree. No additional git worktree or shared build cache was created. Both normal Webpack production builds exited 0 and used identical committed data. Each archive generated its MapLibre workers and ElevenLabs worklets before sampling.

Both builds used `NEXT_PUBLIC_SW_VERSION=local`, `DEPLOYMENT_VERSION=local` and `PUBMAX_E2E_KEYLESS=1`. An explicit `PUBMAX_BUILD_COMMIT_SHA` named each archive's source commit. The disposable config copies disabled Next's build type checking because this assigned phase forbids static analysis. The application config and all repository gates remained unchanged. An earlier split compile/generate attempt failed during Next's environment substitution. Compile-only output then lacked the browser revision value. Those outputs were discarded, and no timing sample uses them.

Chrome used the required `pubmax-ios-lane-e` session, 390x844 mobile viewport, device scale factor 3, touch, light theme and DevTools Fast 4G. The current browser is Headless Chrome 154. The original browser version was not supplied. The earlier reconstructed comparison used Playwright Chromium 153 and a separate setup. Absolute timing values from those runs are not interchangeable.

Each timed sample used the supplied `/places` visit, cleared localStorage and sessionStorage, and opened `/map?lane-e-proof=<round>`. The default Map camera remained unchanged. The cold collection followed nine seconds of observation. Client navigation then visited Tonight, Map and Tonight, with three seconds per visit. Setup pilots primed HTTP assets for both origins before the timed pairs. HTTP caches were not cleared. Cold continues to mean cold application surface caches.

All ten cold samples contain 901 IDs, 15 completed provisional requests and HTTP 200 statuses. Every ID multiset matches `85f34e81d36c4962ea971d1671eb3ca1ac3c3c9dbdd167adf77ae0af24e52203`. Every cold set decoded 225 provisional-body bytes, or 15 bytes per request. Measured maximum concurrency remained one before and two after.

The supplemental [request contract replay](request-contract-original-replay.json) captures actual request URLs after the timed pairs. It checks the 64-ID maximum and replays those same GET URLs against each local server. Each response is `{"venueIds":[]}`, with SHA256 `f6355383d51edf15576c8a43085707cee0dc891de9ed3525952250d9ce694bdd`. These supplemental GETs do not enter the timing samples.

The cold public listings key retains `/api/whats-on?window=tonight&limit=60`. The first Tonight visit retains its separate `pubOnly=1` answer. Each baseline warm return downloads one listings response. Each final warm return downloads none. This replay changes no listing fixture, source timestamp, freshness guard, retry behavior, account boundary or cancellation behavior.

Five pairs alternated before 1, after 1, through before 5, after 5. [samples-original-replay.json](samples-original-replay.json) contains the sanitized readings. [summary-original-replay.json](summary-original-replay.json) records the rig and ranges. The original `samples.json` remains unchanged.

| Metric | Before median, range | After median, range |
| --- | --- | --- |
| Cold provisional waterfall | 4749.3 ms, 4547-4831.4 | 2508.7 ms, 2371.9-2571.7 |
| Cold provisional requests | 15, 15-15 | 15, 15-15 |
| Cold provisional transfer | 4725 bytes, 4725-4725 | 4725 bytes, 4725-4725 |
| Cold provisional decoded bodies | 225 bytes, 225-225 | 225 bytes, 225-225 |
| Cold first provisional answer | 3219.5 ms, 3008.6-3560.9 | 3306.5 ms, 3218.4-4345.7 |
| Cold final provisional answer | 7630.4 ms, 7439-8061.6 | 5551.9 ms, 5404.4-6597.6 |
| Cold first visible pins | 658 ms, 629-833 | 694 ms, 380-1401.7 |
| First Tonight ready or empty surface | 430 ms, 381.6-758.2 | 428.6 ms, 354.6-431.3 |
| Warm Map listings control available | 1083.6 ms, 739.1-1151.9 | 814.1 ms, 679.5-1274.5 |
| Warm Tonight ready or empty surface | 38.4 ms, 34.1-81.3 | 35.3 ms, 32.4-43.1 |
| Cold Map listings transfer | 64319 bytes, 64319-64319 | 64319 bytes, 64319-64319 |
| First Tonight listings transfer | 44048 bytes, 44048-44048 | 44048 bytes, 44048-44048 |
| Warm Map listings requests | 1, 1-1 | 0, 0-0 |
| Warm Tonight listings requests | 1, 1-1 | 0, 0-0 |
| Combined warm listings transfer | 108367 bytes, 108367-108367 | 0 bytes, 0-0 |

The provisional waterfall median fell by 47.2%. Cold request counts and bytes did not improve. Final price-read completion improved. First-answer and first-pin medians were slower after the change, with overlapping ranges. Warm surface-readiness ranges also overlap. These observations establish faster completion of provisional reads and fewer repeated listings downloads. They do not establish faster initial page loads or native-device performance.

The three-second warm Map collection captured 3-5 completed provisional reads before and 6-10 after. These partial waterfalls cannot establish fewer price requests.

### Retained reconstructed evidence and provenance limit

The prior test phase reported that it preserved the five 884-ID pairs in its external evidence directory. [samples-reconstructed-884.json](samples-reconstructed-884.json) preserves sanitized copies, and [summary-reconstructed-884.json](summary-reconstructed-884.json) preserves their earlier rig and results. Their price URLs and ID arrays are reduced to counts and hashes. Cancelled reads retain their recorded state. This separate setup does not replace the 901-ID replay.

The transmitted inline script text does not match the supplied original script fingerprint metadata. This also holds after reversal of the permitted output-path substitutions. [procedure/fingerprints.json](procedure/fingerprints.json) records the supplied and materialized hashes. The scripts and matching runtime observations prove the supplied procedure's measurement semantics, IDs and response-body contracts. They do not prove byte identity to the original uncommitted files. The outer executor must reconcile that provenance discrepancy before claiming byte-identical original scripts.

The original TDD logs, including the rollover race red and green logs, remain unchanged. The prior outer test result supplied a full-gate pass. This focused phase did not rerun the full gate, static checks, native generation, PR publication or CI. The outer executor owns those phases and must report their actual status in the PR body. The PR evidence must include the retained TDD and full-gate proof, the original samples, the separate reconstructed samples, and this replay with its provenance limit.

No physical-device performance, memory-leak, deployment or production claim follows from these browser samples. No paid calls, live POST, migration, deploy, threshold waiver or ceiling change occurred. The test phase stopped its own servers and removed its disposable source archives and compiled outputs before returning.


## Retry ordering follow-up

[Retry ordering proof](retry-ordering.md) records the published-head reproduction and the source correction. Its current validation level is stated separately from the earlier measurements.
