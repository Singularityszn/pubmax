# Combined production-build browser proof

Source head: `3449404bd`. Date: 20 October 2026.
This is a local production build. It is not a preview or live deployment.

## Browser journeys

The isolated `.next-ops-prod` build completed successfully.
Playwright started it with the repository's configured keyless test environment.
All five Chromium checks passed in 1.8 minutes, including the build:

- Signed-out feedback access, a deliberate email target, a selectable address, and return navigation at 320, 390 and 1440 pixels.
- A feedback URL with private-looking query and fragment values does not copy them to the email draft or page.
- A signed-out phone reader opens Updates from You, reads its date and canonical address, and returns to the map.

The browser did not open a mail client or send a message.
The unit and controlled SDK proofs cover alert output and auth transitions separately.

## Page measurements

The same build was reused without rebuilding.
The existing `preparePerfPage` and `runPerfRoute` helpers measured both pages under
`perf/route-budgets.json`'s method: Desktop Chrome, 4x CPU throttle, Fast 4G,
one discarded warmup, three measured samples and two required resamples.
All samples used the page's own readiness boundary.

| Route | Median server render | Decoded JavaScript | Requests | Median LCP | Worst LCP |
| --- | ---: | ---: | ---: | ---: | ---: |
| /updates | 8 ms | 771 KB | 36 | 400 ms | 408 ms |
| /feedback | 7 ms | 771 KB | 36 | 400 ms | 400 ms |

All four measured metrics fit their new route ceilings.
The decoded JavaScript ceiling came down from the initial 910 KB family seed to 900 KB.
No existing route ceiling increased.
The sample rows are retained in `production-perf.json` beside this record.
These figures describe the new pages. They cannot rank the slowest five production pages.

The private logs and desktop captures remain under `artifacts/operations-checklist-1020/`.
The ordinary CI performance sweep remains a separate check on the submitted head.
