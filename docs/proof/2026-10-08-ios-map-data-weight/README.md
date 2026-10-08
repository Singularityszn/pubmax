# iOS lane E map data loading

## Scope and reproduction

The baseline was current `origin/main`, commit `835b91ab6ffeaca1533c612ad88db470aaae8b96`. Both variants used production builds, identical committed data, and `NEXT_PUBLIC_SW_VERSION=local`. The build directories were `.next-lane-e-before` and `.next-lane-e-after`. The local servers used ports 3481 and 3482.

The historical report lives at `/Users/karanmanoharan/karan-agent-workspace/data/pubmax-ios-app-qa/report.md`. Its F06 and F08 findings still reproduced. This viewport made 15 provisional reads over 901 IDs, rather than the historical 14 reads. Map and Tonight downloaded separate What's-On responses on re-entry after five seconds.

The ownership review covered https://github.com/Singularityszn/pubmax/pull/2045 and https://github.com/Singularityszn/pubmax/pull/2065. The merged fanout work already shared matching pending reads and recent answers. This branch changes no POI loader, map warmup, navigation, map chrome, or Android sheet code.

## Changes and decisions

Provisional reads use two concurrent requests across the whole hook. Each request still carries at most 64 IDs. A newer settled viewport takes the next turn after pending reads finish. A refusal stops dispatch and retains the existing backoff. Unmount aborts pending reads. Successful reads remain deduplicated, while failed and interrupted reads remain retryable. No price figure, provenance, corroboration threshold, API budget, or performance ceiling changes.

Anonymous What's-On lists reuse a successful answer for at most one minute before revalidation. The existing ten-minute snapshot can still seed a paint during revalidation. Nearness reads retain five-second reuse and coarse coordinates. Exact URL keys keep `pubOnly` results separate. Snapshot age is also limited to the elapsed time since London's last 04:00 rollover. The existing timezone-aware service window resolves that boundary independently on DST days. Public request URLs remain byte-for-byte compatible. Explicit retry bypasses a snapshot and an older pending request. Source observation times remain unchanged. Account rotation still clears the existing surface cache.

Viewport filtering was considered and rejected as a duplicate. The canvas already supplies projected on-screen base pubs. Wider batching was rejected because the existing 64-ID bound should remain intact.

## Behavioral TDD

The first F06 test failed on the original code because one request started instead of two. The first F08 test failed because a ten-second return made two requests instead of one. The red logs are committed beside this report.

The new suites exercise dense viewports, overlapping camera changes, refusal backoff, cancellation, expiry, pub-only separation, coarse location reads, service-night rollover, explicit retry, account rotation, and fail-soft outages. The tests observe the public hook or loader and the HTTP boundary.

The initial full gate caught three exact-URL compatibility failures caused by an added service-day query parameter. A focused reproduction confirmed those failures. The parameter was removed, and snapshot age now prevents a previous night's paint. The existing compatibility tests remain intact. Added behavioral tests cover the spring and autumn DST rollover and explicit retry during a pending read. The red logs and refreshed green log are committed beside this report.

The refreshed focused verification passed 90 tests across five suites. Another 66 tests passed for price client state and service-day rules. Both production builds passed, and the after build was rebuilt after the URL correction. Both Capacitor sync commands completed sequentially without tracked native changes.

The refreshed `npm run verify:no-mistakes` exited 0. Coverage passed 1803 files and 21437 tests, with one existing skipped file and test. RLS, the e2e skip fence, freshness, install-script policy, and dependency audit passed. Lint reported zero errors and 85 existing warnings. Freshness identified three credential-dependent stores as unmeasurable, and did not claim them fresh. The full log remains at `artifacts/lane-e/verify-refreshed.log`.

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

Raw samples remain in `artifacts/lane-e/before-1.json` through `before-5.json` and `after-1.json` through `after-5.json`. The measurement scripts are `artifacts/lane-e/sample.js` and `measure.mjs`. Build logs, sync logs, TDD logs, and the Instruments device inventory also remain in that folder. The committed sample file removes camera coordinates and replaces ID lists with counts and hashes.

The five pairs above were refreshed after the URL correction. Raw samples, `samples-refreshed.log`, and `after-build-refreshed.log` preserve that run. Firstmate owns merges and deployment decisions. The no-mistakes pipeline owns validation edits, publication, and CI. No deployment, migration, live POST, or paid service call was made.
