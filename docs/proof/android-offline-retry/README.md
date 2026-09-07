# Android offline Retry

Retry now restores the failed venue or area destination. Previously, it opened the homepage and lost the selected venue.

## Build and device

- Date: 7 September 2026, approximately 22:39-22:53 UTC.
- Source base: `6a759e0ac191d99f10c5e658bc8f2c3a6d3dd419`.
- Branch: `codex/android-offline-destination`.
- Device: owned `pubmaxx` Android emulator, serial `emulator-5580`, Android 16, ARM64.
- WebView: `com.google.android.webview`, version `133.0.6943.137`.
- Package: `com.pubmaxx.app`, debug build, version `1.0`.
- Configured server: `https://pubmaxxing.com`; bundled error page: `https://localhost/offline.html`.
- Production deployment: `dpl_88fiZ7i4Cgdfrmu5u1wjnRYCnzYq`.
- Production commit: `6a759e0ac191d99f10c5e658bc8f2c3a6d3dd419`.
- Production build time: `2026-09-07T21:27:03.621Z`.

The version endpoint returned the same deployment before and after this run.

| APK | SHA-256 |
| --- | --- |
| Unchanged baseline | `463feb0bf623537c68e9df37ac3db131ada14b0cf6175238371faeb5658d7045` |
| Final tested fix | `6b31a2bd1e30d483fabdf9275c3f18c6f0b5c4f037627fa667378f6037c42244` |

Both APKs used the same production-origin config and existing dependency installation. These hashes do not prove later dependency changes.

## Native reproduction

1. Install the unchanged APK. Start `MainActivity` without a VIEW intent.
2. Open `/map?sel=venue-122cuu1` inside its Android WebView. Confirm The Queen's Head appears.
3. Disable this emulator's WiFi and mobile data. Confirm the WebView reports `navigator.onLine === false`.
4. Bypass the service worker through the debug WebView connection. Reload with `ignoreCache: true`.
5. Confirm the native shell loads `https://localhost/offline.html` and shows `Try again`.
6. Restore networking. Tap the visible button through Android input controls.
7. Observe the baseline destination: `https://pubmaxxing.com/`. The venue selection disappears.
8. Install the final APK. Repeat with `/map?sel=venue-122cuu1#overview`.
9. Observe the fixed destination: `https://pubmaxxing.com/map?sel=venue-122cuu1#overview`. The venue sheet returns.

Navigation and reload used the actual Android debug WebView connection. Screenshots came from `adb exec-out screencap -p`.
The Retry tap used `adb shell input tap 585 1660` on the observed 1170 by 2532 device screen.

CUA did not list the emulator. Selecting its running executable returned `Invalid app`.
This evidence uses Android device controls, not a browser mobile viewport. No physical Android device was tested.

The service-worker bypass isolates the uncached document failure that reaches Capacitor's native error page.
Without that bypass, the existing service worker could return a cached, unstyled document while offline.
The run did not change the service worker or the shared offline HTML.

An initial VIEW-intent experiment did not reproduce the loss. Existing app startup logic reapplied that original launch link.
The confirmed failure followed a normal launcher start and subsequent navigation.

## Visual proof

| Step | Native screenshot |
| --- | --- |
| Baseline selected venue | [before-venue.png](before-venue.png) |
| Baseline outage page | [before-offline.png](before-offline.png) |
| Baseline Retry loses venue | [before-retry.png](before-retry.png) |
| Fixed outage page | [after-offline.png](after-offline.png) |
| Fixed Retry restores venue | [after-retry.png](after-retry.png) |
| Area outage page | [after-area-offline.png](after-area-offline.png) |

The restored venue screenshot shows the existing partial-details notice. It proves destination recovery, not complete map or venue-data recovery.

## Callback ordering

The first candidate failed native testing despite passing the pure destination tests.
Temporary boolean-only probes observed this order:

```text
onReceivedError(mainFrame=true)
onPageCommitVisible(remote document)
onPageCommitVisible(local error document)
```

The remote commit after failure cleared the first candidate's retained destination.
The final client clears old state when another navigation starts. Starting the local error page preserves the failed destination.
It delegates the remaining callbacks to `BridgeWebViewClient`. The temporary probes are absent from the final APK and source.

## Regression checks

- `:app:testDebugUnitTest`: 12 destination tests passed. The existing template unit test also passed.
- `:app:assembleDebug`: passed with the final source.
- `:app:assembleDebugAndroidTest`: passed.
- Installed `ExampleInstrumentedTest`: `OK (1 test)` on `emulator-5580`.
- Actual venue Retry: preserved the query, fragment, and selected venue.
- Actual area Retry: preserved `/near?patch=soho` while offline, returning its cached document.
- Repeated uncached failure and cold-start root fallback: unit coverage only.
- Trust checks: off-origin hosts, ports, schemes, userinfo, malformed URLs, callbacks, and credential keys cannot replace Retry's safe fallback.
- Subresource failures cannot replace a retained document destination.

The instrumentation correction changes the template expectation from `com.getcapacitor.app` to the actual `com.pubmaxx.app` package.
It was required for the installed package check above. It does not change the production application.

The final build used these Gradle tasks with `--no-daemon --max-workers=2`:

```text
:app:testDebugUnitTest :app:assembleDebug
```

The baseline ran `scripts/android/build.mjs`, including Capacitor sync.
Only Java source changed after sync. The final build did not need another sync.
The approved dependency symlink initially directed plugin build outputs into that dependency installation.
Later builds redirected those outputs into this checkout's `android/build/isolated-plugins` through a temporary Gradle init script.
Generated settings and the dependency symlink are excluded from the commit.

## Coverage limits and cleanup

The destination policy retains one trusted URL in memory. It adds no URL persistence or URL logging.
It excludes `/auth/callback` and credential keys from replay. It does not prove the separate account callback implementation.

No accounts, messages, location permission changes, or customer data submissions occurred.
One earlier coordinate tap opened the share sheet during loading. It was dismissed without choosing a recipient.

Unverified: physical devices, older Android releases, HTTP-error runtime recovery, account callbacks, release signing, push, and store submission.
The local onboarding candidate server was stopped. This production-origin APK cannot prove its unshipped shared CSS changes.

WiFi and mobile data were restored. The task's port forward was removed, and its read-only emulator instance was stopped.
The compute owners received an explicit runtime release. Shared iOS simulator controls were untouched.
