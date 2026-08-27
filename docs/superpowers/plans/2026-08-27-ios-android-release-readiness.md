# PUBMAXX iOS and Android Release Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship existing PUBMAXX Capacitor shells as tested iOS and Android store candidates that render same London v0 mobile UI as browser.

**Architecture:** Keep one server-rendered Next.js product and two checked-in Capacitor 8 native projects at `ios/` and `android/`. Both shells load `https://pubmaxxing.com` through remote-URL mode. Native behaviour stays behind `lib/native*.ts` and `components/native/**`; no React Native, SwiftUI, duplicate map, or duplicate product UI is added.

**Tech Stack:** Next.js 16, React 19, Capacitor 8.5, Swift Package Manager, Xcode, Android Gradle Plugin, Java 17, Vitest, Playwright, iOS Simulator, Android Emulator.

**Spec:** `docs/CAPACITOR_WRAP.md`

## Global Constraints

- Work only in clean worktree `/Users/karanmanoharan/Documents/pubmax-mobile-release` on branch `codex/mobile-release-readiness`.
- Preserve dirty primary checkout `/Users/karanmanoharan/Documents/pubmax`.
- Native task owns `capacitor.config.ts`, `ios/**`, `android/**`, `native/**`, `lib/native*.ts`, `components/native/**`, native-only tests, native assets, and native release documentation.
- Do not edit `components/PubMap.tsx`, `components/map/pubmap/useMapSurfaceNavigation.ts`, or current London v0 web/data paths.
- Do not edit shared `package.json`, `package-lock.json`, `next.config.mjs`, `app/layout.tsx`, `.gitignore`, `AGENTS.md`, or shared browser/E2E configuration without explicit coordination.
- Treat PR `#1237` as unmerged. Rebase native work only after London v0 task reports merge SHA.
- Do not run final Vercel production build/deploy, App Store archive, Play release bundle, or store submission before shared release checkpoint.
- Keep remote URL HTTPS-only and `native/web-stub/offline.html` as truthful first-load failure surface.
- Keep all direct Capacitor imports inside `lib/native*.ts`.
- Use app name `PUBMAXX`, app ID `com.pubmaxx.app`, iOS minimum 15, Android minimum API 24, Android target API 36.
- Use one native UI source: current web mobile surface at 320, 390, and 430 CSS-pixel widths.

---

### Task 1: Align generated iOS Capacitor package

**Files:**
- Modify: `ios/App/CapApp-SPM/Package.swift`
- Verify: `__tests__/nativeWrap.test.ts`

**Interfaces:**
- Consumes: `@capacitor/ios` version from clean `package-lock.json` and `npx cap sync`.
- Produces: Swift Package Manager dependency on `capacitor-swift-pm` version `8.5.0`.

- [ ] **Step 1: Reproduce generated drift**

Run:

```sh
npm ci
npx cap sync
git diff -- ios/App/CapApp-SPM/Package.swift
```

Expected: sync changes `capacitor-swift-pm` from `8.4.2` to `8.5.0` and no other tracked native file changes.

- [ ] **Step 2: Verify sync preserved intentional native files**

Run:

```sh
shasum -a 256 ios/App/App/AppDelegate.swift ios/App/App/Info.plist \
  android/app/src/main/AndroidManifest.xml \
  android/app/src/main/java/com/pubmaxx/app/MainActivity.java
```

Expected hashes after sync:

```text
f4e88cf27f60c90d1be01dc67fc48a288b8d20e0df29d993d407cfc8a33698e0  ios/App/App/AppDelegate.swift
b56f860f7546e42e342e7d4b46b2fd44cf1ee1d8376ad207e1fecd2d561f3686  ios/App/App/Info.plist
0433786b949b47baa4b21018b54f34076742d53b255609c5b26ea864d2cb1dda  android/app/src/main/AndroidManifest.xml
5676fbe911fb0791bb4a1b3a272767fc6b19b2fcae474b4913a4d9d4b1b51d4b  android/app/src/main/java/com/pubmaxx/app/MainActivity.java
```

- [ ] **Step 3: Verify Capacitor projects**

Run:

```sh
npx cap doctor
npx cap ls
```

Expected: iOS and Android both report success; app, camera, and push plugins appear on both platforms.

- [ ] **Step 4: Run focused native tests**

Run:

```sh
npm test -- \
  __tests__/nativeWrap.test.ts \
  __tests__/nativeDeepLinks.test.ts \
  __tests__/nativeFirstRun.test.ts \
  __tests__/nativePlatform.test.ts \
  __tests__/nativePush.test.ts \
  __tests__/nativePushPrompt.test.ts \
  __tests__/nativeSystemBars.test.ts \
  __tests__/storeAssets.test.ts
```

Expected: 8 files and 54 tests pass.

- [ ] **Step 5: Commit generated alignment**

```sh
git add ios/App/CapApp-SPM/Package.swift
git commit -m "fix(native): align iOS Capacitor package"
```

### Task 2: Capture browser-equivalent native UI proof

**Files:**
- Create: `docs/proof/native-v0-browser/README.md`
- Create: `docs/proof/native-v0-browser/native-map-390-light.png`
- Create: `docs/proof/native-v0-browser/native-map-390-dark.png`
- Create: `docs/proof/native-v0-browser/native-tonight-390-light.png`
- Create: `docs/proof/native-v0-browser/native-offline-390-light.png`

**Interfaces:**
- Consumes: deployed `https://pubmaxxing.com`, native bridge shape from `lib/nativePlatform.ts`, and offline stub from `native/web-stub/offline.html`.
- Produces: labelled browser proxy evidence. It never claims simulator, emulator, signed device, APNs, or verified app-link proof.

- [ ] **Step 1: Open Codex browser at phone viewport**

Set in-app browser viewport to `390x844`, show browser, and open:

```text
https://pubmaxxing.com/map
```

Expected: mobile map surface renders without horizontal overflow and with 44px primary controls.

- [ ] **Step 2: Inject native bridge before page scripts**

Use browser CDP `Page.addScriptToEvaluateOnNewDocument` with:

```js
Object.defineProperty(window, "Capacitor", {
  configurable: true,
  value: {
    isNativePlatform: () => true,
    getPlatform: () => "ios",
  },
});
```

Reload. Expected: `isNativeApp()` resolves true and native-only web branches activate.

- [ ] **Step 3: Capture light and dark map evidence**

Capture viewport screenshots at `390x844`. Verify no Add to Home Screen prompt appears inside native proxy.

- [ ] **Step 4: Capture native cold-start destination**

Clear only test-tab session state, open `/`, and verify first native entry reaches current onboarding or `/tonight` policy without changing production data.

- [ ] **Step 5: Capture offline stub**

Open `native/web-stub/offline.html` from local server or file-safe preview at `390x844`. Verify it says live data is unavailable, shows no price or time, and offers retry.

- [ ] **Step 6: Write evidence boundary**

In `docs/proof/native-v0-browser/README.md`, record URL, commit SHA, viewport, theme, browser-proxy method, and explicit native-runtime exclusions.

### Task 3: Install native toolchains and compile debug shells

**Files:**
- Modify only if compiler requires it: `ios/**`, `android/**`
- Create: `docs/proof/native-v0-build/README.md`

**Interfaces:**
- Consumes: full Xcode, iOS Simulator runtime, Java 17, Android SDK, and one Android virtual device.
- Produces: unsigned iOS Simulator app, Android debug APK, compiler logs, and launch screenshots.

- [ ] **Step 1: Install owner toolchains**

Owner installs full Xcode and Android Studio. Verify:

```sh
xcode-select -p
xcodebuild -version
java -version
adb version
emulator -list-avds
```

Expected: Xcode path under `/Applications/Xcode.app`, Java major 17 or newer, Android SDK tools available, and at least one AVD.

- [ ] **Step 2: Sync native projects from clean source**

```sh
npm ci
npx cap sync
npx cap doctor
```

Expected: sync and doctor pass for both platforms with no unexpected tracked diff.

- [ ] **Step 3: Compile iOS Simulator app**

```sh
cd ios/App
xcodebuild -project App.xcodeproj -scheme App \
  -sdk iphonesimulator -configuration Debug \
  -destination 'platform=iOS Simulator,name=iPhone 16 Pro' build
```

Expected: exit 0 and `.app` product in DerivedData.

- [ ] **Step 4: Compile Android debug APK**

```sh
cd android
./gradlew assembleDebug --no-daemon
```

Expected: exit 0 and `android/app/build/outputs/apk/debug/app-debug.apk`.

- [ ] **Step 5: Launch each debug shell**

Use iOS Simulator and Android Emulator. Verify HTTPS remote boot, native cold-start route, safe areas, system bars, map gestures, location denial, camera cancellation, Back, background/resume, and forced offline page.

- [ ] **Step 6: Record proof**

Record tool versions, commit SHA, build commands, artefact paths, launch screenshots, and known owner-only exclusions in `docs/proof/native-v0-build/README.md`.

### Task 4: Rebase after London v0 integration

**Files:**
- Modify: native-owned files only if rebase or sync creates native drift.

**Interfaces:**
- Consumes: merged PR `#1237` SHA and later London v0 merge SHAs.
- Produces: native branch based on same web commit accepted for London v0.

- [ ] **Step 1: Receive merged SHA from London v0 task**

Do not infer merge from local worktree. Confirm PR `#1237` is merged and record exact `origin/main` SHA.

- [ ] **Step 2: Fetch and inspect overlap**

```sh
git fetch origin --prune
git diff --name-only HEAD..origin/main
git diff --name-only origin/main...HEAD
```

Expected: no overlap with native-owned files. If overlap exists, stop and coordinate exact files.

- [ ] **Step 3: Rebase native branch**

```sh
git rebase origin/main
```

Expected: clean rebase. Do not resolve conflicts by copying whole shared files.

- [ ] **Step 4: Repeat sync and focused verification**

```sh
npm ci
npx cap sync
npx cap doctor
npm test -- __tests__/nativeWrap.test.ts __tests__/nativeDeepLinks.test.ts \
  __tests__/nativeFirstRun.test.ts __tests__/nativePlatform.test.ts \
  __tests__/nativePush.test.ts __tests__/nativePushPrompt.test.ts \
  __tests__/nativeSystemBars.test.ts __tests__/storeAssets.test.ts
```

Expected: no generated drift and all focused tests pass.

### Task 5: Shared release checkpoint and store candidates

**Files:**
- Create: `docs/proof/native-v0-release/README.md`
- Modify only after owner supplies real identifiers: `public/.well-known/apple-app-site-association`, `public/.well-known/assetlinks.json`, iOS entitlement files, Android signing configuration.

**Interfaces:**
- Consumes: production-ready GitHub `main`, Apple Team ID, Apple signing identity, APNs credentials, Android upload keystore fingerprint, App Store Connect account, and Play Console account.
- Produces: one signed iOS archive, one signed Android App Bundle, verified links, device push proof, and store-upload checklist.

- [ ] **Step 1: Confirm shared acceptance**

London v0 task and native task exchange exact commit SHAs, changed-file lists, focused verification results, build results, browser proof, unresolved blockers, and explicit deferrals.

- [ ] **Step 2: Apply owner identifiers**

Replace AASA `TEAMID` only with real Apple Team ID. Publish Android `assetlinks.json` only with real Play signing certificate SHA-256 fingerprint. Add entitlements through native project configuration.

- [ ] **Step 3: Verify on signed physical devices**

Test real camera capture, location permission allow/deny, APNs delivery, Android push delivery if configured, universal links, Android App Links, background/resume, poor network, and account deletion path.

- [ ] **Step 4: Build store artefacts**

Create App Store archive in Xcode and signed Android `.aab` through Gradle or Android Studio. Do this only after shared release checkpoint approves exact commit.

- [ ] **Step 5: Upload to internal testing**

Upload iOS build to TestFlight and Android bundle to Play Internal testing. Do not submit production review until internal device smoke passes and store privacy declarations match `app/privacy` and `app/terms` data path.

- [ ] **Step 6: Record immutable release proof**

Write commit SHA, version/build number, artefact checksums, signing identities without secrets, store upload IDs, device matrix, and deferred features in `docs/proof/native-v0-release/README.md`.
