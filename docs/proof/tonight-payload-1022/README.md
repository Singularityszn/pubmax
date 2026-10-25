# Tonight initial Out payload, 22 October 2026

Tonight now filters its initial Out events before sending them to the browser.
The page uses the existing pub eligibility filter and the server render clock.
It keeps one unmatched event for the existing unmatched-listings notice.
It preserves all other answer fields, including status, source dates, provider reports, attribution, and open plans.
Browser revalidation and the map venue ID list remain unchanged.

## Byte comparison

These figures replay the retained production capture through the implemented filter.
They count UTF-8 JSON bytes with `Buffer.byteLength(JSON.stringify(value))`.
They exclude compression, HTML escaping, and property names outside the measured value.

| Value | Before | After | Reduction |
| --- | ---: | ---: | ---: |
| Out event rows | 78 | 2 | 76 |
| Out answer bytes | 44,461 | 1,785 | 42,676 |
| Initial listings bytes | 85,501 | 42,825 | 42,676 |

The retained rows are one eligible pub event and the first unmatched event.
An equality check confirms that every other Out body field remains unchanged.
[measurement.json](measurement.json) records the source identity, render clock, row IDs, and byte counts.

The source capture reported commit `e81aaa6a04b720ddb8ef4b909b35ffad445b0088` and deployment `dpl_H8cZfyzhPPUorvaNVF8hiddpwjxn`.
The implementation starts from main at `90864cf3ffd18001bc4db95e655868c55fbcda44`.
These are different builds.
This comparison measures the saved payload projection, not a new HTML document or deployment.
This task ran no build and changed no performance ceiling.

## Regression evidence

The page regression supplies 78 fixture events through the listing readers.
Before page integration, it fails because the page sends 47,321 Out bytes against a limit below 2,500 bytes.
After integration, it checks the reduced payload, unchanged metadata, the render clock, and unchanged rendered output.
The source answer still contains all 78 events after the page returns.

Additional tests cover eligible, expired, and stale pub events, plus multiple unmatched events.
They compare rendered output across ready, empty, and failed What's-On reads.
They also cover unavailable, pending, and unconfigured Out answers.

The requested local checks passed.

- `npm run typecheck` passed.
- ESLint passed for `app/tonight/page.tsx`, `app/tonight/initialOutAnswer.ts`, and `__tests__/tonightInitialOutAnswer.test.tsx`.
- `npx vitest related ... --run` passed all 79 tests across four related test files.

The related run included `tonightInitialOutAnswer`, `tonightServerListings`, `tonightOutListings`, and `tonightPubSurface`.
No end-to-end behaviour changed, so this task ran no Playwright spec.
Fast path: no-mistakes gate and full local verify skipped by captain decision; CI runs the full suite.

## Overlapping work

PR #2320 changes `app/tonight/page.tsx` metadata.
PR #2321 changes Tonight rendering and listing composition.
The captain authorised this change against current main without waiting for either PR.
Whichever PR merges second must rebase and preserve the payload reduction and listing behaviour.
