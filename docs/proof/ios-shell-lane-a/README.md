# iOS shell lane A

The earlier product matrices below predate the production-root retry repair. They do not establish current-head Test GO.
The current review evidence and its limits appear in the final section.

The final simulator build fixes cancelled navigation, native edge Back and safe failed-page retry. It keeps the existing bundled outage page.
The service-worker opt-in is withheld. The final iOS runtime reports `typeof navigator.serviceWorker === "undefined"`.

The baseline was origin/main `835b91ab6ffeaca1533c612ad88db470aaae8b96`.
The disposable rig used iPhone 17 Pro, iOS 27.0, simulator `fm-ios-lane-a`.
Its production web build and server shared `DEPLOYMENT_VERSION=local-ios-lane-a`.
The server used port 3490. A local evidence proxy used port 3491.
The final normal matrix used standard generated chunk URLs and bytes. The diagnostic delay and query hook were removed.
The proxy rejected `/sw.js` during native failure controls. API availability was measured directly in the installed iOS runtime.
No Android, Capacitor vendor, UIScene launch handler, map hook, service-worker or app-bound-domain setting changed.

## Runtime evidence

| Finding | Before | Final simulator result |
| --- | --- | --- |
| F01 | [Cancelled navigation showed No connection with a reachable server](before/cancel-server-up.png). | [The server remained reachable and the document stayed visible](after/final-cancellation-server-up.png). The existing plugin listeners survived cancellation. |
| F05 | [An actual edge gesture stayed on Map](before/swipe-stays-map.png). | [The first edge closed Filters](after/final-filters-after-swipe.png). A second edge returned to Places. [Back also worked before the optional native chunk arrived](after/final-early-swipe-before-optional-chunk.png). |
| F26 | [Local retry left the app for the production root](before/retry-leaves-local-app.png). | [The native retry button restored the exact failed local URL](after/final-exact-retry.png), including `?lane-retry=local#pubs`. |
| F04 | The baseline lacked the service-worker API. | [The final build still lacks that API](after/final-withheld-worker-runtime.json). [A real origin outage displays the bundled page](after/final-genuine-origin-outage.png), without cached prices or external CSS. |

[The baseline swipe recording](before/swipe.mp4) records an actual driven gesture.
The real failure control stopped the owned port 3491 listener. Curl then reported connection refusal.
The failed main-frame request was `/places?lane-retry=local#pubs`.
After recovery, the native Try again button restored `http://localhost:3491/places?lane-retry=local#pubs`.
See [the exact runtime result](after/final-exact-retry-runtime.json) and [the native test result](final-native-exact-retry.txt).
Foundation tests cover the same policy at the production origin and reject callbacks, credentials, other origins and user information.
Production-host retry remains a policy test. The runtime retry proof uses the local origin.

A cold launch with the origin unavailable also displayed `capacitor://localhost/offline.html`.
The public WK configuration reported `limitsNavigationsToAppBoundDomains = NO`.
After recovery, native Try again used app-entry and reached Tonight.
See [the cold outage](after/final-cold-outage.png), [the recovered route](after/final-cold-outage-recovery-runtime.json), and [the native result](final-native-cold-outage-recovery.txt).
The corrected native outage probe measures that WK property. Its earlier placeholder field is not configuration evidence.

[The final unmodified native matrix](final-healthy-matrix.txt) passed actual external Safari handoff and return.
Its [attachment manifest](final-healthy-attachment-manifest.json) records the screenshot timestamps after the query hook was removed.
An actual system-browser presentation closed before the existing SceneDelegate callback fixture routed to Tonight.
The fixture used `error=access_denied` and created no authentication session.
See [the presented browser](after/final-callback-browser-presented.png), [the returned app](after/final-callback-return.png), and [the runtime URL](after/final-callback-runtime.json).
This proves callback-handler ordering. It does not prove authenticated OAuth or OS universal-link association.

The final first-entry test displayed onboarding and used the real Skip button to reach Tonight.
Its first fixture retained a saved London preference and correctly bypassed onboarding. That failed assertion is preserved.
The corrected fixture removed only the completion mark and saved city preference from the disposable local origin.
See [onboarding](after/final-first-entry-onboarding.png), [Tonight](after/final-first-entry-tonight.png), and [the result](final-first-entry-no-city.txt).
Warm `pubmaxx://map?lane-link=warm` delivery requested the full local URL and reached Map.
The settled Map URL lost the diagnostic query. This record does not claim its query remained in the final address.
See [the complete requests](after/final-warm-link-requests.json) and [the settled runtime](after/final-warm-link-runtime.json).
Cold `pubmaxx://tonight?lane-link=cold` delivery reached Tonight with its query intact.
See [the cold runtime](after/final-cold-link-runtime.json) and [the native result](final-cold-link.txt).

## The withdrawn service-worker experiment

The experimental app-bound build exposed the service-worker API and registered an active controlling worker.
Those artifacts describe the withdrawn experiment. They do not describe the final shipping configuration.
WebKit HTTP cache alone is never registration evidence.

Two authorized tests used a matched production deployment revision and normal asset cache headers.
The first cached all 125 document asset URLs. The cold shell was styled, but Map reached its Spilled error page.
The second warmed observed route resources and all 128 document references. Its cold Map displayed chrome but no usable basemap or prices.
These results did not meet the offline Map claim.
The actual module worker is `/vendor/maplibre/maplibre-gl-worker.mjs`.
It imports `/vendor/maplibre/maplibre-gl-shared.mjs`.
Both returned 200 online. Both were absent from Cache Storage and failed during the actual origin outage.
See [the real dependencies](after/real-map-worker-dependencies.json) and [the failed requests](after/real-worker-origin-outage.json).
The earlier illustrative `/vendor/maplibre-worker.js` request is not evidence about the actual worker.

Firstmate accepted the existing self-contained native outage page as the bounded fallback.
The app-bound opt-in remains off. No new offline framework was added.
A future opt-in would need complete worker and map assets, entry routes, API and tile requests, and external/OAuth handoff proof.
It must retain the domain boundary. An alternative bundled offline product would need a separately agreed scope and truthful data freshness rules.

## Gesture readiness and diagnostic limits

An initial delayed-chunk experiment reused WebKit HTTP cache and made no fresh request. It proves no listener-readiness claim.
After two failed native cache expressions, Firstmate authorized one compiled typed diagnostic.
It cleared only the owned localhost HTTP memory/disk cache record once.
Its completion reported no remaining local HTTP cache records and preserved other origins, cookies, preferences, JS storage, history and worker state.
See [the typed fixture](typed-http-cache-fixture.m) and [its completion](typed-http-cache-completion.txt).

With the old optional native chunk delayed, an early real edge stayed on Map. A later edge returned to Places after the response.
The executable shell-startup regression also failed before the repair.
The repaired immediate iOS listener passed while optional dynamic features remained unloaded.
See [the red test](back-startup-red.txt) and [the green tests](native-startup-green.txt).
The final native experiment made a fresh optional-chunk request whose measured duration was 30004 milliseconds.
An actual edge returned to Places before that response arrived.
See [the native result](final-delayed-edge-runtime.txt), [the request](after/final-delayed-native-chunk-request.json), and [the trace](after/final-delayed-edge-runtime.json).

The diagnostic query hook later prevented the optional App listener from mounting, although its bytes returned 200.
That attempt failed the callback return check. The hook was removed before the final healthy and callback matrices passed.
Its evidence remains in [the failed diagnostic](callback-query-hook-failed.txt) and [the unmodified control](callback-unmodified-fresh-control.json).
The delayed test proves early Back handling. It does not prove the optional module mounted after its altered request.
An earlier six-entry history failure did not reproduce in the instrumented replay. Its exact cause remains unestablished.

## Verification and remaining release proof

The local production web build and targeted native tests passed.
Native generation and the full repository gate run sequentially in this worktree.
The production Release simulator build passed with signing disabled.
[The generated production configuration](production-release-config.json) retains app-entry and UIScene without app-bound opt-in.
[Foundation policy tests passed](navigation-policy-tests.txt). [The full repository gate passed](full-gate-passed.txt) after native generation.
It passed 21425 unit tests, with one existing skip, and 564 local PostgreSQL tests.
One complete repeat failed with ENOSPC while writing test fixtures and coverage artifacts. It reported six failed files and 14 unhandled errors.
See [the exact failure](full-gate-disk-failure.txt). Firstmate authorized cleanup of exact unused reproducible build outputs before revalidation.
[The approved reclamation record](build-output-reclamation.json) accounts for 3488116736 bytes from five unused build directories.
Source provenance, manifests, the tested native binary and all raw native evidence were retained.
[All six affected fixture suites passed](disk-failed-fixtures-revalidation.txt), with 142 tests passing. The complete gate then passed.
Pipeline review and CI readiness remain separate delivery checks.
The first full gate stopped at six unused generated native JS files after lint and types passed.
The complete generated public directory and Release output were archived unchanged under `.tmp-evidence/ios-lane-a/`.
The retry uses `PUBMAX_KNIP_BASE_REF=HEAD`, which selects the stricter full-tree deadcode gate and avoids creating another worktree.
No shared lint or deadcode configuration changed. See [the first result](first-full-gate-generated-artifacts.txt).
[Generated-data disposition](generated-data-disposition.json) accounts for the 309 QA revision changes. No venue rows changed and no generated data is committed.

The physical iPhone is offline. Physical-device gestures, authenticated sign-in, universal-link association and production-origin retry remain release checks.
The simulator proof does not establish Android behavior, deployment, or production validation.
All raw failed attempts and native result bundles are preserved in `.tmp-evidence/ios-lane-a/raw-rig/`.
Coverage found the original 3.4 GB rig directory outside deployment ignores. The complete rig was archived under the existing ignored evidence directory.
No shared deployment policy changed. Native logs retain their original execution paths.
[The focused deployment-ignore test passed](deployment-artifact-regression.txt) after [the recorded failure](deployment-artifact-first-failure.txt).
The durable files here contain the relevant screenshots, traces and result extracts.
`BLOCKED.md` and `CURRENT_CHECKPOINT.md` are historical checkpoint records. This README states the final configuration and outcomes.

## Review repair for outage Back

The native edge handler now uses WebKit history when the exact configured outage document is visible.
Live documents retain the existing panel-first event. An outage document without history stays in place.
Navigation policy, cancellation handling, safe retry and worker configuration remain unchanged.

The review used simulator `80131979-EDC5-4B44-B5A3-903D83429E9E` and an isolated fixture on port 3490.
Port 3491 belonged to another worktree and was left untouched.
The [fixture](review-offline-back-fixture.py) serves a healthy document with the real bundled `lib/nativeBackGesture.ts` module.
It stops its origin before navigating to `/places?lane-retry=local#pubs`.
The [native test](review-offline-back-ui.swift) then drives a left-edge gesture with a 0.1-second touch hold.
A zero-duration diagnostic drag did not activate the recognizer and supports no Back claim.

The [baseline log](review-offline-back-baseline.txt) records the failing history assertion against the original controller.
Its result exporter stalled. Moving its directory before export completed left that result bundle incomplete.
The [repaired test](review-offline-back-repaired.txt) passed the same assertion while the origin remained unavailable.
Its complete result bundle contains the [outage screenshot](review-offline-back-before.png) and [healthy document after Back](review-offline-back-after.png).
[Focused checks](review-offline-back-focused-tests.txt) passed the Foundation policy checks and 95 tests across six native suites.

The new raw builds, native binaries, diagnostics and available result bundles are preserved under `ios/build/ios-lane-a-review/review-rig/`.
That existing ignored build path keeps generated output out of the source diff. The fixture server and app were stopped.
Production configuration was regenerated after the local fixture test. The repaired runtime binary used the local fixture origin.
This review did not repeat the full product, healthy, cold or warm simulator matrices above.
Those matrices and the complete repository gates remain the outer executor's responsibility.

## Review repair for production-root retry

The native delegate now excludes Back and Forward actions from retry matching.
The shared homepage predicate also leaves an already selected production homepage request to the original navigation policy.
It covers empty paths, `/`, host case and default ports. Local roots, queries and fragments retain their safe retry destinations.

The [test-only interception fixture](review-root-retry-fixture.m) used WebKit's public simulated HTTP response API at `https://pubmaxxing.com/`.
A refused localhost CONNECT proxy produced actual main-frame `NSURLErrorDomain -1004` failures when the homepage reloaded.
Recovery responses were supplied locally after the app's original navigation policy. No request reached production.
The [native tests](review-root-retry-ui.swift) used the owned simulator and the established 0.1-second edge gesture.
Direct HTML-loading experiments changed history and support no root Back claim. Their raw output remains preserved.

The [baseline](review-root-retry-baseline.txt) passed Back and failed Try again.
Its [retry trace](review-root-retry-baseline-runtime.txt) shows two root interceptions followed by `/app-entry`.
Back already worked on this iOS 27 fixture because WebKit updated its visible URL before policy evaluation.
The [repaired native tests](review-root-retry-repaired.txt) passed both journeys.
Their [trace](review-root-retry-repaired-runtime.txt) shows one root retry request and the homepage destination.
The retry screenshots show [the baseline app-entry destination](review-root-retry-baseline.png) and [the repaired fixture homepage](review-root-retry-repaired.png).

[Focused checks](review-root-retry-focused-tests.txt) passed the extended Foundation policy tests and all 95 tests across six native suites.
[The manifest](review-root-retry-manifest.json) pins the baseline commit, modified source, production configuration, fixture and compiled native bytes.
The unsigned Debug simulator build and complete current root-test result bundles are preserved under `ios/build/root-retry-review/`.
The earlier incomplete outage Back baseline bundle remains an explicit limitation. No archived proof was modified.
The fixture app was stopped. Generated production web output was archived under that ignored build path.

This proves the root matcher repair with fixture HTTP content. It does not repeat the full product matrix.
The outer Test step must run fresh full current-head verification and the requested native product matrix before reporting Test GO.
That matrix includes cold and warm local and production-origin recovery, cancellation, early live edge, panel-first history and external/callback handoff.
