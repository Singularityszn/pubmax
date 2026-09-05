# Wrapped-build evidence refresh (issue #443)

The app-store closing gate for the Wayfinder map (#437): the six core surfaces plus
first-run onboarding and the vibe loop, in light and dark, captured on the WRAPPED
builds rather than on mobile web.

`manifest.csv` is the machine-readable index: shell, OS, device, theme, kind,
surface, built SHA, the instant the file was written into this pack, and its path.

## What was captured, and on what

| | iOS | Android |
|---|---|---|
| Shell | Capacitor 8 remote-URL wrap, `com.pubmaxx.app`, Debug, unsigned (`npm run ios:build`) | Capacitor 8 remote-URL wrap, `com.pubmaxx.app`, debug APK (`npm run android:build`) |
| Host tooling | Xcode 26.6 (17F113), iOS 26.5 simulator runtime | Android SDK at `/opt/homebrew/share/android-commandlinetools`, JDK 21, AVD `pubmaxx`, system image `android-36;google_apis;arm64-v8a` |
| Device | iPhone 14 simulator, 390x844 pt (1170x2532 px) | `sdk_gphone64_arm64`, display forced to the same 390x844 dp box with `wm size 1170x2532` and `wm density 480` |
| Capture command | `xcrun simctl io <udid> screenshot` | `adb exec-out screencap -p` |

Both shells were built from a clean checkout of `origin/main` at
`2d00af6d2537a5a2db9904c6edc18d8efa9d79ee`, and both loaded the same origin.

## Which code the shells were serving

The wrap is remote-URL: `capacitor.config.ts` points the WebView at an origin
rather than bundling the site, so a shell screenshot shows the shell plus whatever
that origin serves.

Production was 12 hours behind `main` at capture time and its `/api/version`
predates #1486, so it could not name its own commit. A preview of the exact
commit under test was deployed instead, and the shells were pointed at it for the
capture run only. `capacitor.config.ts` in this branch is unchanged and still names
`https://pubmaxxing.com`.

```
$ curl -s https://chengdu-fd879225v-pubmax69.vercel.app/api/version
{"deploymentId":"dpl_GKbhmnwfvC442fJTcGnTPfmzUyW3",
 "gitCommitSha":"2d00af6d2537a5a2db9904c6edc18d8efa9d79ee",
 "gitCommitShaSource":"working-tree",
 "builtAt":"2026-09-05T13:47:04.720Z"}
```

The preview carries no isolated database credentials, so every surface here is the
signed-out reading. Signed-in variants of Social and You are not in this pack.

## How each surface was reached

Android was driven by taps and swipes (`adb shell input`), so its journey is the
one a drinker takes: onboarding, the tab bar, a pin on the map, the describe-first
composer, Lock it in, and the vibe chips.

iOS could not be driven the same way. `osascript` has no assistive access on this
machine and neither `idb` nor `cliclick` is installed, so no tool can put a touch on
the simulator. Each iOS surface is therefore a COLD START at its own route: the
route was written into `server.url` inside the installed `App.app`, the app was
reinstalled and launched, and the screen was taken once it settled. That is a
genuine wrapped-shell reading of each surface, and `decideEntry` keeps it honest —
`path !== "/"` returns `stay`, so no redirect rewrites the route under the capture.

## The two surfaces that are not what the title says

- `ios/*/08-vibe-loop-plan-page.png` and `android/dark/08-vibe-loop-plan-page.png`
  are the plan page as a NON-MEMBER reads it, not the vibe picker. The picker needs
  a member capability, which is established by joining a crew, and neither the iOS
  cold-start method nor the Android dark run could establish one.
- `android/light/08-vibe-loop.png` IS the vibe loop: chips, a vote landed, and the
  tally line under it. That shot is the proof the loop works end to end on a wrapped
  build.

## Defects

Every defect seen during the run is in the pull request table, one row per finding,
each filed as its own GitHub issue with `needs-triage`. The evidence for each is the
`defect-*` file named in its row. Nothing was fixed in this pack.

## Reproducing this

```sh
npm ci
npm run ios:build      # PUBMAX_IOS_SIMULATOR="<device name>" selects the device
npm run android:build
npm run android:run
```

`docs/STORE_READINESS.md` section 8 owns the ordered checklist, section 9 the
Android toolchain. A green simulator or emulator build proves the code and the
remote-URL wrap; it never proves the entitlements, because a team-less build writes
an empty entitlements file.
