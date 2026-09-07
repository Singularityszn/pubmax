# Product audit, 7 September 2026

Status: active. No release clearance.

The audit branch is `codex/full-product-audit`. Its starting commit is `30a8b98fe`.
The checkout is `/Users/karanmanoharan/Documents/projects/pubmaxx-audit`.
The canonical checkout and other agents' changes remain separate.

## Confirmed fixes

| Defect | Fix commit | Evidence |
| --- | --- | --- |
| Malformed admin cookie throws; scalar auth JSON reaches unsafe reads. | `3bf316daf` | Actual handlers reproduced failures. Route and guard tests pass. |
| An anonymous request can reserve a handle with durable storage configured. | `85998ec71` | New handle write returns 401. Existing legacy and keyless paths retain their contracts. |
| Pint, bill, and venue image uploads can store corrupt UTF-8 bytes. | `af29ab0f7` | Shared Blob writer and read-back proof. Storage reproduction uses real encoding and a corrupting bucket. |
| Failed CacheStorage access prevents valid network responses. | `ad09876cc` | Browser fault reproduction and service worker tests. Network responses survive cache denial. |
| Search treats the streamed London subset as a complete city. | `c68a16bfe` | 141 core venues versus 1,995 London venues. Complete pack indexing and retry tests pass. |
| Tonight links fail light-theme contrast. | `01bb53d34` | Axe fails before the change and passes at 390 and 1,440 pixels in both themes. |
| Unused code and incorrect hook dependencies produce warnings. | `d78c4f3eb` | 28 warnings removed. 387 tests across 23 files pass. No suppressions added. |
| Capacitor tooling uses an affected XML parser. | `7d1bfa12d` | Compatible parser update. XML fault reproduction, plist round trips, and clean temporary install pass. |

Independent correctness review covered the first six fixes through `01bb53d34`.
The reviewer passed 148 focused tests across 19 files.
That review does not cover later changes or certify a deployment.

## Browser test repairs

Tests now follow consent timing, static SVG drawing, public founding links, and the current signed-out Social page.
Price tests read the current price band. Contrast tests measure the actual flat tab and inset focus background.
Phone target checks reveal the skip link with focus before measuring it.
Proof screenshots use isolated test output paths in the repaired specs.

Completed focused runs include:

- Consent and reduced-motion checks: 7 passed.
- Design checks: 16 passed across the completed focused runs.
- Launch control geometry: 6 passed, covering 360, 390, and 430 pixels.
- Arrival, claim, and Social fixtures: 19 passed, with one existing proof-only skip.

The delayed composer fault did not reproduce with one worker.
Its retry change follows the recorded failure state, where the picker has closed before the composer loads.

## Work in progress

| Finding | Current state |
| --- | --- |
| Guest exit from sign-in loses the selected pub. | `0595f340c`, tracked in PUB-8. Reproduced through the real browser and E2E. 54 focused tests pass. Final browser proof remains. |
| Shared crawl reports three stops but shows no stop cards. | `b5473c286`, tracked in PUB-9. Nine hydration and detail-cache tests pass. Final browser proof remains. |
| Arrival welcome covers Day/Tonight at 390 pixels. | `39d8b2f8b`, tracked in PUB-10. Dynamic margin rejected after 0.09687 layout shift. Docked CSS preview passes three checks. Stable-build proof remains. |
| Map keyboard and camera tests use retired control assumptions. | Four test corrections are ready. Focused final verification remains. Rapid reselection failure remains unresolved. |

## Broad verification

The first `npm run verify` passed data validation, lint, type checking, and dead-code checks.
Coverage ended with six failures while source and tests changed during the run.
Those failures were reproduced and corrected in focused runs. A stable broad pass is still required.

A later verification run completed with 16,402 passing tests and five failures across three files.
Four failures used stale login and arrival modules after the tests changed during that run.
Fresh focused runs pass. The fifth failure found a missing server-only marker in `profileOwnership.ts`.
Commit `5d2462cef` adds that marker. Its focused guard and auth checks pass 100 tests.
Lint reports zero errors and 41 complexity warnings.
This audit has not lowered the complexity threshold or added suppression comments.

The initial full browser run used the unchanged starting build on ports 3410 and 3411.
It stopped after 33.2 minutes: 224 passed, 68 failed, one interrupted, two skipped, and 790 not run.
Several failures identified confirmed defects or stale tests. Later failures include host contention.
The machine reached a load average above 90 with 18 logical CPUs.
Navigation timed out before HTTP commit, and reads of visible controls took 15 seconds.
These timeouts are not evidence that the product itself failed.

The next broad browser run must use a stable updated build and a reserved compute window.
No timeout increases are retained solely to hide contention.

The conditional-skip check passes across 222 browser specs. The dependency audit reports no high or critical findings.
The local freshness command passes with three feeds it cannot measure without credentials.
Read-only Supabase queries resolved those unknowns using the authoritative timestamp columns:

| Feed | Production timestamp, UTC | Age at check |
| --- | --- | --- |
| Weather, newest generated batch | 2026-09-07 18:00:29.456 | 2.55 hours |
| What's-On, oldest listing generation | 2026-09-07 05:30:14.289 | 15.06 hours |
| Night signal candidates, feed stamp | 2026-09-07 05:15:52.557 | 15.30 hours |

Weather and What's-On meet their 48-hour budgets. The candidate feed has no freshness budget and was updated today.
These queries read timestamps only from project `iankajxliutqogqkmvdg`.

## Standards review

Independent source review found one clock-dependent arrival test.
Commit `a586da1b4` fixes the browser clock before asserting the evening Now destination.
Re-review through `5d2462cef` reports no remaining actionable Standards findings.

## Spec review

Independent source review found one deferred cache-write race.
The caller could consume a response before the cache writer cloned it.
Commit `182eed235` clones the response first. A real-response regression fails before and passes after the fix.
All 39 service worker cache tests pass.
Re-review through `5d2462cef` reports no remaining actionable Spec findings.

Both reviews are static. Neither review certifies broad browser checks or native release behavior.

## Platform and ownership boundaries

Root computer-use access works in the Codex in-app browser.
Subagents report no exposed browser surface. Root provides their manual visual checks.
Mobile browser dimensions do not count as native app evidence.

Separate tasks own native PR 1632, map PR 1631, and the Social experience changes.
The native callback, request-budget, and mobile reset-control findings remain with those owners.
Store signing, universal links, and physical-device journeys remain release checks.

Production reports remain tied to commit `74e688913` until `/api/version` confirms a new release.
The Out/Tonight dead end was reproduced on that deployment and is already addressed by merged PR 1626.
It needs release verification, not a duplicate implementation.

Mobbin connector search returned a paid-plan error.
A separate coordinator confirmed authenticated Mobbin browser access and supplied a toast placement reference.
Browser access and connector access are different results. No further login or purchase is required by this audit.

## Local evidence

Logs are temporary operational evidence. Copy required artifacts into the final report before delivery.

- `/tmp/pubmaxx-audit-verify.log`
- `/tmp/pubmaxx-audit-verify-final.log`
- `/tmp/pubmaxx-audit-e2e.log`
- `/tmp/pubmaxx-audit-tonight-a11y.log`
- `/tmp/pubmaxx-launch-controls-fixed.log`
- `/tmp/pubmaxx-guest-return-before.log`
- `/tmp/pubmaxx-guest-return-unit.log`
- `/tmp/pubmaxx-arrival-cls-probe.log`
- `/tmp/pubmaxx-auth-fixtures.log`
- `/tmp/pubmaxx-audit-baseline-results/`
- `/tmp/pubmaxx-sw-consumption-before.log`
- `/tmp/pubmaxx-sw-consumption-after.log`

Generated venue revisions and proof screenshots are test outputs. They are excluded from audit commits.
No audit commit has been pushed or deployed.
