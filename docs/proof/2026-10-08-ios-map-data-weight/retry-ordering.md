# Retry ordering follow-up, 8 October 2026

The published loader at `68f887a2bc2d7f06026b131fa40ac4a649576b61` allowed an older pending read to overwrite a successful fresh retry's snapshot. The [review thread](https://github.com/Singularityszn/pubmax/pull/2074#discussion_r4218626152) remains open pending the published correction and full checks.

A disposable native HTTP server held two GET response bodies. It completed the fresh retry with source time 10:00, then the older request with source time 09:00. Both responses carried valid current-service metadata. A subsequent public read returned 09:00 without another HTTP request. This exercised the real loader and cache with browser memory enabled through an EventTarget window seam. It was not a rendered product or native-device test.

The permanent loader test first failed that returning-reader assertion. It passed after the correction. The same ordering is now covered for public, pub-only, near and near pub-only URLs. Earlier active callers still receive their own valid response. The fresh snapshot remains the answer for later arrivals.

The shared loader marks the displaced in-flight request as superseded. Its active callers may finish, but it cannot write the snapshot. The marker belongs to that request and adds no retained generation map. The guard operates on the exact request key. Cancellation, shared-reader retention, freshness limits, source observations and URL contracts remain unchanged.

| Evidence | Before | After |
| --- | --- | --- |
| Returning public source time | 09:00, wrong older answer | 10:00, fresh retry answer |
| HTTP requests | 2 | 2 |
| Permanent test | 1 failed, 11 passed | 15 passed |
| Focused cache, rollover, cancellation and reuse suites | Regression reproduced | 127 passed in five suites |

The red and green logs are committed beside this file. The green HTTP receipt identifies the modified working tree over the published base. The local `npm run verify:no-mistakes` gate subsequently passed: 1805 unit files and 21499 tests, 57 RLS files and 554 tests, and 10 serial harness tests. One existing unit file and test remain skipped. Lint reports zero errors and 88 previously recorded warnings. Freshness leaves three credential-dependent stores unmeasurable. The changed replay driver also passes a separate ESLint invocation. Production-build validation remains pending at this local stage. Earlier five-pair timing results do not measure this follow-up. The original fingerprint discrepancy, no-first-pin-gain result and native-device limitations remain unchanged.

## Clean replay procedure

The [second review thread](https://github.com/Singularityszn/pubmax/pull/2074#discussion_r4218659281) identified an inherited artifact dependency. A clean archive of the published procedure failed immediately because `measure.mjs` read `artifacts/lane-e/sample.js`, which the archive does not contain. The driver now reads its adjacent committed `sample.js` through `import.meta.url` and creates the existing output directory recursively. Only those two prerequisites changed.

The clean-archive file-I/O check substitutes a browser transport that validates the expanded JavaScript and emits a known JSON result. It exits zero and creates all ten expected before/after files without inherited artifacts. This proves template loading, substitution and output-directory creation. It is not browser or performance evidence. `procedure-path-red.txt` and `procedure-path-green.json` preserve the result and current driver hash. The sample template and raw historical fingerprint metadata are byte-identical to the published files. The original provenance discrepancy remains disclosed. The next full pipeline run must use real production servers and the actual browser for refreshed timing evidence.
