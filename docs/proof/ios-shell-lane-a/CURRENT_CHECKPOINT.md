# iOS lane A current checkpoint

This file records the earlier two-attempt offline checkpoint. The continuation
below supersedes its pending-decision and source-status statements.

Source remains uncommitted on fm/pubmax-ios-lane-a. No pipeline or PR exists.
The existing scene repair and Android code remain unchanged.

## Corrected rig

Firstmate instruction 004 authorized a matching production-server environment.
The pinned .next-prod-lane-a build and server both used DEPLOYMENT_VERSION=local-ios-lane-a.
Only the owned simulator's localhost:3491 worker registrations and Cache Storage were cleared.
LocalStorage and other app data were preserved.
The proxy forced no-store only on documents. Assets retained production headers.
Earlier failed screenshots and the deployment-query mismatch remain preserved.
They identify rig confounds and do not prove a release deployment bug.

The corrected worker activated and controlled the native WKWebView.
All root, Map and Tonight document assets had exact Cache Storage matches before each outage.
The second warm-up also requested observed runtime Next assets.
Immediate per-fetch cache checks raced event.waitUntil writes.
The later verification had no missing document references.
See after/consistent-document-asset-identity-warmed.json and after/consistent-second-assets-verified.json.

## Exact native retry passed

The negative control removed worker registrations and caches, then loaded a document with no controller.
Port 3491 was stopped. Curl reported connection refusal.
Navigation to /places?lane-retry=local#pubs displayed the bundled No connection page.
After restoring the origin, a real XCTest Try again tap opened that exact URL inside the active app.
See after/native-negative-control-state.json, after/native-real-outage.png,
after/retry-exact-local.png and after/retry-exact-local-runtime.json.
The native test passed. This proves the local URL case, not production-device retry.
The Foundation policy checks passed. Five targeted native Vitest suites passed 101 tests.
The new raw Swift-source substring assertion was removed from nativeWrap.
Its Xcode configuration and storyboard assertions still parse declarative artifacts.

## Offline results remain incomplete

The first consistent attempt displayed a styled cold-start document.
A real Map tap reached the site's Spilled page.
The Map response contained the cache-only marker and loaded 40 stylesheets.
A later resource read found no missing Next cache entries.
Its cached Map HTML had status 200 and the normal UK venue map heading, rather than Spilled.
See after/consistent-offline-map-error-first.png and after/consistent-cached-map-document.json.

The second attempt rendered Map chrome instead of Spilled.
It showed Map background couldn't load and offered Retry, with no venue prices displayed.
The native WKWebView reported its worker controller and second cache-only marker.
A native Filters tap and an edge swipe were driven.
XCTest failed its guessed Reset all or Close filters accessibility-name assertion.
That assertion failure alone does not prove broken panel behavior.
The basemap is visibly unavailable. A usable offline map remains unproved.
See after/consistent-offline-second.png and after/consistent-offline-second-runtime.json.

All document CSS and JS references matched cached URLs before that attempt.
The dependency probe recorded CARTO fallback style and sprite requests.
Its vendorCached field queried an incorrect illustrative path, /vendor/maplibre-worker.js.
That field must not support a claim about the real worker.
The source names /vendor/maplibre/maplibre-gl-worker.mjs and its shared sibling module.
The site's worker excludes /vendor from static caching.
This is a source-level candidate gap, not a proven runtime root cause.
The complete missing map-dependency set remains unverified.

## Latest swipe failure

The first corrected-rig Places/Map edge test passed.
During the second warm-up, the native edge event fired once but the URL stayed /map.
The online map was styled and populated. The trace reported history length 6.
This supersedes an unrestricted claim that every current swipe path passes.
Earlier panel-first and external-return proofs remain valid for their exercised states.
See .ios-lane-a/consistent-second-warm.log and after/consistent-native-test-results.txt.
The later no-pop cause remains unverified.

## Handoff

Both authorized consistent offline attempts are preserved. No worker subsystem was changed.
Bounded alternatives are a truthful self-contained native-entry fallback,
repair of the exact dependency gap after runtime diagnosis,
or withholding the app-bound opt-in until usable offline behavior is proven.
No alternative has been implemented or chosen.
The latest swipe no-pop also needs diagnosis before completion.

Only verified owned server and failed-test PIDs were stopped.
The owned simulator app was terminated. Its proof/cache state remains available.
Generated data changes were restored after preserving both revision snapshots.
A temporary disk shortage interrupted the checkpoint write, then cleared without deleting any proof.
Native production generation, full verify:no-mistakes, commit and pipeline remain pending.
Physical iPhone proof and authenticated OAuth login remain unproved.
The access_denied fixture proves only the existing native return handler.

## Continuation after instructions 005 and 007

The app-bound opt-in is withheld in the current source. The installed diagnostic
binary still carries the experiment until final native generation replaces it.
The real MapLibre worker and shared module returned 200 online, were absent from
Cache Storage, and failed during an actual origin outage.
See after/real-map-worker-dependencies.json and after/real-worker-origin-outage.json.
The bundled native outage page is the accepted bounded fallback.

A fresh actual edge test and the reconstructed six-entry history passed.
Two untyped cache expressions failed before execution. Their traces remain in
the disposable rig. Instruction 007 authorized one changed typed fixture.
It used the public WKWebsiteDataStore API and selected one localhost record.
It cleared only HTTP memory/disk cache. Completion reported zero local records.
Other-origin records, cookies, preferences, storage, history, and worker state
passed its preservation checks. See typed-http-cache-completion.txt.

The exact native feature chunk made a fresh proxy request under a 30-second delay.
The early actual edge swipe stayed on Map. A later actual swipe returned to Places.
See delayed-native-chunk-runtime.txt and delayed-native-chunk-fresh-request.json.
The startup regression then failed with zero history.back calls while dynamic
features remained unloaded. The repair mounts iOS back with immediate startup.
Six targeted suites passed 89 tests. The original late no-pop trace does not
establish whether it had this exact cause. Final withheld-configuration runtime
proof, production generation, full verification, commit and pipeline are pending.
