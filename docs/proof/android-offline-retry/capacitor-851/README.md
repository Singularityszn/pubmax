# Capacitor 8.5.1 native Retry check

Actual Android Retry restored the selected venue on 8 September 2026, between 03:33 and 03:36 UTC.
This check adds dependency-specific evidence. It changes no application source.

## Exact artifacts

- Frozen native source: `41fa0274c96c7c859e9e470966a37c0cb7fb3577`.
- Installed Capacitor core and Android: `8.5.1`. Camera: `8.2.4`.
- Tested APK SHA-256: `3222c422ce9b2252c8d55cc98b2e7052a834b8e1bfade73b8696c88bb7771763`.
- Retained APK: `/tmp/pubmaxx-android-851-evidence/tested-app-debug.apk`.
- Android 16 ARM64, owned read-only `emulator-5580`, WebView `133.0.6943.137`.
- Live web source: `6a759e0ac191d99f10c5e658bc8f2c3a6d3dd419`. See [version response](live-version.json).

The APK loaded production web content. This does not verify the frozen source's web UI or new onboarding CSS.
The [manifest](manifest.json) records source, dependency versions, lock hash, APK hash, and proof file hashes.

## Observed sequence

1. Build the frozen source in an isolated checkout. Redirect external plugin outputs before the first Gradle task.
2. Install the debug APK. Start `com.pubmaxx.app/.MainActivity` without a VIEW intent.
3. Navigate the actual debug WebView to `/map?sel=venue-122cuu1#overview`.
4. Confirm The Queen's Head appears. See [venue screenshot](01-venue.png).
5. Disable only the owned emulator's WiFi and mobile data. Confirm `navigator.onLine` is false.
6. Bypass the service worker and cache through native WebView CDP. Reload the document.
7. Confirm `https://localhost/offline.html` and visible `Try again`. See [offline screenshot](02-offline.png).
8. Restore networking. Confirm `navigator.onLine` is true.
9. Tap the visible button at device coordinates 585, 1660 through Android input controls.
10. Confirm the exact venue query and fragment return, with the visible venue card. See [recovery screenshot](03-recovered.png).

[Navigation states](navigation.jsonl), [offline state](offline.jsonl), and [recovery states](recovery.jsonl) record narrow public observations.
The initial screenshot includes loading placeholders. Recovery shows the venue name, listed price, address, and action buttons.
These images prove destination recovery. They do not prove complete map loading or every venue detail.

## Checks and limits

The [build log](build.log) records a successful 31-second build with two Gradle workers.
Twelve destination unit tests and one template test passed. Their XML reports are included.
Instrumentation was not rerun. The earlier package correction and installed instrumentation proof remain documented in the parent report.
No new instrumentation source change was needed.

This run tests one normal-launch, uncached venue failure. It does not repeat the unchanged baseline failure.
Earlier area evidence returned a cached document. Repeated uncached failure remains unit-only coverage.
HTTP-error runtime, launch-link A followed by venue B, physical devices, account callbacks, and store readiness remain unverified.

CUA inventory did not expose the Android emulator. The check used the authorised Android CLI and actual native WebView.
It did not use a mobile browser viewport as native proof.

WiFi and mobile data were restored. The owned port forward was removed and emulator stopped.
The final device inventory was empty. Main received an explicit runtime release before this report was written.
No shared app data, accounts, iOS simulator, or shared Gradle outputs changed.
Generated Capacitor settings and the dependency symlink are excluded from this proof commit.
