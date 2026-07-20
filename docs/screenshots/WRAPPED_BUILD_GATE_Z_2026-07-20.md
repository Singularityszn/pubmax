# Wrapped-build Gate Z evidence refresh

Date: 20 July 2026

Branch: `codex/wave1-wrapped-build-evidence`

Baseline: `8ae1faf023c6168febfbf519d929dfc604f90506`

This is reproducible local evidence for Wayfinder Wave 1.2. It does not claim
signing, App Store or Play enrolment, APNs credentials, a native device run, or
verified universal/app links. Those remain owner/toolchain gates.

## Result

| Seam | Result | Evidence and boundary |
| --- | --- | --- |
| Capacitor sync | Pass | `npx cap sync` completed for iOS and Android; app 8.1.1, camera 8.2.1, and push-notifications 8.1.2 were found on both. Pre/post SHA-256 checks confirmed sync did not overwrite `AppDelegate.swift`, `Info.plist`, `AndroidManifest.xml`, or `MainActivity.java`. |
| Remote-URL shell | Pass | Both generated configs contain `server.url: https://pubmaxxing.com`, HTTPS only. A current request returned HTTP 200. `webDir` remains the two-file `native/web-stub`, not `public/`. |
| Honest first-load outage | Pass at config/source level | `server.errorPath: offline.html` is present in both generated configs. The bundled page says live data is unavailable, shows no cached price/time claim, and retries production. Light/dark 390x844 renders are attached below. A device-level forced-main-frame failure still needs a native runtime. |
| Safe areas | Pass at source/config level | App metadata has `viewport-fit=cover`; mobile chrome uses `env(safe-area-inset-*)`; the fallback does the same; Capacitor SystemBars uses `insetsHandling: css` for affected Android WebViews. Native notch/gesture-bar geometry needs device capture. |
| Status/system bars | Pass at code/test level | Bars default visible. `NativeSystemBars` observes `html[data-theme]` and maps both app themes through Capacitor 8's core SystemBars seam. Focused tests cover web no-op, both mappings, and plugin rejection. Native pixels need device capture. |
| Native A2HS suppression | Pass | The A2HS gate now delegates to the canonical `isNativeApp()` bridge seam. Unit coverage is green. A remote-shell browser proxy with a proven-value A2HS state reported zero `.a2hsScrim` nodes in both themes. |
| Camera/photo strings | Pass | `plutil -lint` passes; `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` are present. `NSPhotoLibraryAddUsageDescription` remains intentionally absent because capture does not save to the gallery. |
| APNs callback forwarding | Pass at source/test level | `AppDelegate` forwards success/failure through Capacitor notification names and sync preserved it. The server HTTP/2 sender exists and defaults to a loud no-op without keys. No entitlement, key, signed token, or delivery is claimed. |
| iOS universal links | Route seam passes; verification owner-blocked | `AppDelegate` forwards `NSUserActivity`; `@capacitor/app` handles cold and warm opens; the route fence accepts only the apex HTTPS origin and the three supported path families. Production AASA returned HTTP 200 and `application/json`. Its `TEAMID.com.pubmaxx.app` placeholder and absent Associated Domains entitlement correctly prevent a verification claim. |
| Android deep links | Route seam passes; verification owner-blocked | The manifest routes the same HTTPS path prefixes into the `singleTask` bridge activity; `@capacitor/app` is synced and shares the tested route fence. Production `/.well-known/assetlinks.json` currently returns 404; publishing it requires the owner release-signing fingerprint. |

## Both-theme visual evidence

The full native simulator/emulator toolchain is unavailable, so these are
carefully labelled proxies, not native screenshots:

- `wrapped-gate-z-2026-07-20/remote-shell-proxy-390x844-light.png` — current
  production `/tonight`, mobile viewport, Capacitor-native bridge injected;
  SHA-256 `469809fb58257ffcf48e889b89588c607932d6175ee22882e56678e50a7ee4f0`.
- `wrapped-gate-z-2026-07-20/remote-shell-proxy-390x844-dark.png` — same in dark;
  SHA-256 `639780c6828b8a68d622536fd73321089c32f0817da7de1c80f1cc7ab090ccee`.
- `wrapped-gate-z-2026-07-20/offline-390x844-light.png` — bundled error page;
  SHA-256 `3cd113c28abf3fd1dcf8512dfedc2f026415b39e2184788f3f640ba7a3d124d9`.
- `wrapped-gate-z-2026-07-20/offline-390x844-dark.png` — bundled error page;
  SHA-256 `381eaea516f76e780d4d162bcdceaf035a22324b379f7c5ac33afa30311623e5`.

The remote proxy reported, in both themes: final URL
`https://pubmaxxing.com/tonight`, native bridge true, A2HS scrim count 0.

## Verification record

- Focused Vitest: 5 files, 64 tests passed (`nativeWrap`, `nativeDeepLinks`,
  `nativeSystemBars`, `nativePlatform`, `a2hsPrompt`).
- TypeScript: `npm run typecheck` passed.
- ESLint: `npm run lint -- --quiet` passed.
- Native metadata: `plutil -lint` and `xmllint --noout` passed.
- Patch hygiene: `git diff --check` passed.
- Dependency audit: 0 vulnerabilities at `--audit-level=high`.
- Isolated Next production build: passed; details below.

## Toolchain boundary

- Capacitor Doctor: CLI/core/iOS/Android all 8.4.2 and internally consistent.
- Isolated web production build: passed with
  `NEXT_DIST_DIR=.next-wave1-wrapped npm run build` (448 pages). It retained
  the existing Edge `ogBrand` and image-proxy NFT trace warnings; neither was
  introduced by this lane.
- iOS compile/simulator: unavailable. `xcode-select -p` is
  `/Library/Developer/CommandLineTools`; `xcodebuild` refuses because full
  Xcode is not installed.
- Android compile/emulator: unavailable. `./gradlew assembleDebug --no-daemon`
  fails before compilation because this machine has Java 11 and Android Gradle
  Plugin requires Java 17 or later; `ANDROID_HOME` is also unset.
- Therefore no `.app`, `.apk`, signed archive, simulator screenshot, physical
  device run, APNs delivery, or verified link launch is represented here.

## Reproduce

```sh
npm ci
shasum -a 256 ios/App/App/AppDelegate.swift ios/App/App/Info.plist \
  android/app/src/main/AndroidManifest.xml \
  android/app/src/main/java/com/pubmaxx/app/MainActivity.java
npx cap sync
npx cap doctor
npx cap ls
plutil -lint ios/App/App/Info.plist
xmllint --noout android/app/src/main/AndroidManifest.xml
npm test -- __tests__/nativeWrap.test.ts __tests__/nativeSystemBars.test.ts \
  __tests__/nativeDeepLinks.test.ts __tests__/nativePlatform.test.ts \
  __tests__/a2hsPrompt.test.ts
npm run typecheck
npm run lint -- --quiet
git diff --check
```

When full Xcode or a Java 17+ Android SDK is present, extend this pack with an
unsigned simulator/emulator build and the same light/dark and forced-offline
captures. Add signed-device/APNs/link evidence only after the owner supplies
the relevant programme enrolment, entitlements, keys, and signing identity.
