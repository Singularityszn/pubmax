# iOS cold-start measurements

Lane B addresses QA findings F03 and F18. The native shell now starts at the
static `/app-entry` document. That document loads only the shared entry script
and replaces itself with onboarding or Tonight. It contains no React assets,
fonts, stylesheets, or landing image preloads. Its HTML body is 345 bytes.
The entry uses a new script version to bypass cached homepage entry code.

The onboarding photo now requests at most 1200 pixels. Its `sizes` value follows
the full-width phone strip and the desktop grid column.

## Simulator results

The baseline was commit `3bc62e232` on this task worktree. The script measured
two fresh installs before the change and two after the complete change.
Each run uninstalled the app and installed the Debug binary. It ran
`simctl launch` and recorded HTTP responses for 15 seconds after the command returned.

The device was an iPhone 17 Pro simulator on iOS 27.0. Both binaries used the
same temporary scene lifecycle shim because this branch lacks the separate
iOS 27 lifecycle change. The shim is absent from this commit.

The web app used local production builds. A local HTTP proxy retained the
client's compression headers and counted response body bytes. These figures
exclude HTTP headers. The web server and proxy used private task ports 39870
and 39871. The tests used local builds throughout.

| Fresh install measurement | Before | After |
| --- | ---: | ---: |
| Total requests | 82 in both runs | 72 in both runs |
| Total response bytes | 841,535 / 841,569 | 653,478 / 653,473 |
| Requests started before onboarding | 45 in both runs | 2 in both runs |
| Response bytes for those requests | 526,127 in both runs | 3,827 in both runs |
| Hero image requests | 2 | 1 |
| Hero response bytes | 210,705 | 77,751 |
| First document to onboarding request | 1,129 / 661 ms | 646 / 482 ms |

Fresh-install response bytes fell by 22.3%. Pre-entry response bytes fell by
99.3%. Hero response bytes fell by 63.1%. The remaining shared application
assets explain why the total saving is smaller than the pre-entry saving.
The baseline fetched a landing AVIF and a `w=1920` JPEG. The corrected entry
fetched no landing AVIF and requested the onboarding JPEG at `w=1200`.

Both corrected fresh installs reached `/onboarding` with HTTP 200 inside the
native shell. A returning launch reached `/tonight` with HTTP 200. The
returning run recorded 32 requests and 192,915 bytes. Its entry document
contributed one request and 345 bytes before Tonight.

Timing varied across the simulator captures. These Debug
simulator measurements establish the request and byte reductions. They do
not establish a reliable launch-time improvement on a physical iPhone.
Android uses the same configuration, but Android runtime measurements were
not part of this lane's simulator proof.

## Native configuration requirements

Capacitor iOS checks navigation against `server.url` as a URL prefix. Setting
that URL directly to `/app-entry` opened sibling routes in Safari. The final
configuration keeps `server.url` at the origin and uses the supported
`server.appStartPath: "app-entry"` setting. The configuration has no navigation allowlist.

Capacitor also checks that the start file exists in `webDir`, even in remote
mode. `native/web-stub/app-entry` satisfies that check. The healthy shell
loads the remote document, not the bundled placeholder.

The onboarding proxy guard accepts the same-origin navigation from the entry
document. Tests also cover the older WebView referrer fallback, stored-city
fallback, unavailable storage, auth callback inputs, returning launches,
deep links, and deliberate visits to the homepage.

The web route must be available before binaries with the new start path ship.
Older binaries keep entering through the root. This lane makes no deployment.

Local screenshots, response logs, build logs, and test logs remain in
`test-results/lane-b/` for the Firstmate handoff. The successful after
captures are `after-version.png` and `after-version2.png`. The comparable
baseline captures are `before.png` and `before2.png`.

## Validation

`npm run verify:no-mistakes` passed. The coverage suite passed 21,008 tests.
The PostgreSQL suite passed 554 tests. The focused entry, onboarding and
native-wrap tests passed 111 tests after the script version change.
The production web build and the iOS Debug build passed.
