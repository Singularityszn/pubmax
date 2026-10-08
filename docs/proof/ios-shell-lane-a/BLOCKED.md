# iOS lane A checkpoint, 8 October 2026

Branch: `fm/pubmax-ios-lane-a`. Base: `835b91ab6ffeaca1533c612ad88db470aaae8b96`.
Changes are uncommitted. No pipeline has started. No pull request has been opened.

The owned iPhone 17 Pro simulator is `fm-ios-lane-a`, UDID `80131979-EDC5-4B44-B5A3-903D83429E9E`, running iOS 27.0.
The production build used `.next-prod-lane-a`, port 3490, and a disposable local proxy on 3491.
The proxy adds a same-origin evaluation script. It forces HTTP responses to `no-store`.

## Proven so far

- Before F01: cancelling a delayed document showed the bundled No connection page while the production server returned 200.
- Before F04: the shell had no `navigator.serviceWorker`.
- Before F05: an actual native XCTest edge swipe remained on Map. Enabling WebKit gestures alone also failed.
- Before F26: a native Try again tap left the local app for the production root in Safari.
- After F04: the actual WKWebView exposes an activated service worker and a controller. See `after/worker-runtime.json` and `after/worker-caches.json`.
- After F05: the final window-owned screen-edge recognizer returns Map to Places. `.ios-lane-a/swipe-final.log` reports one passing test.
- After F05: the first swipe closes Filters. The second returns Map to Places. `.ios-lane-a/sheets-final.log` reports one passing test.
- The first browser-handoff run presented Safari for an external URL and Google's sign-in page through the Browser plugin. The app URL stayed unchanged. This is presentation evidence, not a completed OAuth login.
- Swift navigation policy checks passed. The native Back, wrap and capability tests passed, 58 tests total.
- The final local native build and the production web build succeeded.

## Repeated blocker

The separate OAuth handoff/close test failed twice after the Browser.open call returned.
The native `Done` control was absent, and the in-page evaluation channel became unavailable while the browser was presented.
Increasing the foreground settling time and the control wait did not resolve it.
The two logs are `.ios-lane-a/handoff-final.log` and `.ios-lane-a/handoff-settled.log`.
The earlier combined run passed the presentation assertions, but its subsequent panel test could not find Places until an explicit Browser.close call.
The later synchronized panel test passed.
This does not establish safe OAuth return behavior. The cause remains unresolved.

## Required before completion

Resolve the browser-handoff/close blocker before retaining the app-bound-domain opt-in.
Capture final cancellation with the server up, genuine connection failure, exact failed-URL retry, and worker-backed offline navigation/cold start.
Exercise entry and deep-link routes and preserve the existing scene lifecycle.
Confirm local map tiles, assets and API outcomes with the bound-domain setting.
Run native generation and `npm run verify:no-mistakes` sequentially.
Restore generated data changes after the local server stops. Commit only owned source and proof files.
Physical iPhone proof remains unavailable. Simulator proof does not establish physical-device behavior.

The disposable evaluator, XCTest source, test project, result bundles and full logs remain in `.ios-lane-a/`.
No installed Capacitor code was edited. No Android code was changed. No deployment or shared backend writes occurred.

## Resolved browser checkpoint and current offline checkpoint

The browser blocker above was resolved after Firstmate instruction 002.
Native hierarchy inspection identified SFSafariViewController and its Close control.
Tapping the inspected control frame closed it and restored the app's evaluation channel.
Two application fixes then passed the isolated callback fixture:
Capacitor listeners now reset when a replacement document commits, and OAuth routing waits for Browser.close.
This proves the existing native return handler with an access_denied fixture, not authenticated login or universal-link association.
Final real edge swipes, panel-first back, external Safari return, warm and cold custom-scheme links, and first-run entry tests passed.
The full logs and XCTest result bundles remain in .ios-lane-a.

Offline cold launch remains incomplete. The first test proxy mistakenly set no-store on assets as well as HTML.
The second test preserved production asset headers and cached 130 resources, including stylesheets.
With port 3491 stopped, cold launch still served an unstyled root document.
A marker inserted only into Cache Storage was visible through native WKWebView evaluation.
This proves an actual worker-backed HTML response, and it does not prove usable offline UI.
See after/worker-offline-cold.png, after/offline-native-marker-trace.txt, and after/offline-connection-refused.txt.

The asset diagnostic shows an exact URL mismatch:
Cached root HTML requests CSS with ?dpl=local-ios-lane-a, while the warmed Tonight assets use ?dpl=835b91ab6ffe.
The worker therefore has none of the root document's exact stylesheet URLs.
See after/offline-root-asset-diagnostic.json and after/offline-realistic-cache-prepared.json.
The web build used DEPLOYMENT_VERSION=local-ios-lane-a, but the production server launch omitted that variable.
This is a concrete rig confound. The evidence does not establish the same mismatch in a release deployment.

A bounded next diagnostic is to start the same production build with the matching DEPLOYMENT_VERSION,
clear only the owned simulator origin's worker registrations and caches, then repeat online warm-up and offline cold launch.
If the clean, consistent rig still lacks required assets, the alternatives are a self-contained offline fallback for native entry,
or withholding the app-bound opt-in until the worker caches a usable native shell.
Neither alternative has been implemented or chosen.
F26's repaired local failed-URL retry still needs its final native runtime proof.
Native production generation, the full verify:no-mistakes gate, commit and pipeline are still pending.

At this checkpoint, only verified owned servers on ports 3490 and 3491 were stopped.
The owned simulator app was terminated. The simulator remains available to resume.
The 309 generated public/data revision changes were restored after preserving .ios-lane-a/generated-data.patch.
There are no generated venue rows in the proposed source change.
