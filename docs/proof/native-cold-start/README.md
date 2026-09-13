# Native cold start, before and after

Captured on 13 September 2026 for lane 8 of the site audit (D1, D2).

## Rigs

- iOS: simulator `pubmaxx-390x844`, iOS 26.5, Xcode 26.6.
- Android: AVD `pubmaxx`, API 36.
- Chromium: Playwright Chromium, with safe-area insets emulated by `Emulation.setSafeAreaInsetsOverride`.

"Before" is main against production. "After" is this branch. Files named `rig` come from the local build rig (`PUBMAX_NATIVE_SERVER_URL`), so they show the checkout, not production.

## Launch

| File | What it shows |
| --- | --- |
| `ios-before-0s.png` to `ios-before-16s.png` | Main against production, a clean install: the bare ink field at 0, 2, 4, 10 and 16 s. The first document committed 21.5 s after launch. |
| `ios-after-0s.png` to `ios-after-16s.png` | This branch against production: the launch mark holds. Production does not yet carry `lib/nativeSplash.ts`, so the 12 s ceiling releases it. |
| `ios-rig-3.43s-splash.png`, `ios-rig-3.89s-page.png` | Local rig, a clean install: the splash just before release, then the painted page. |
| `android-rig-1.60s-splash.png`, `android-rig-3.98s-page.png` | Android local rig, a warm relaunch: the mark, then the page. |

## Loading skeleton

Each skeleton is built around a clone of the loaded page's own nav, so the two nav positions compare directly. `skeleton-results.json` holds the measured tops.

| Width | Before: skeleton / page | After: skeleton / page |
| --- | --- | --- |
| 390 | 94 / 57 px | 57 / 57 px |
| 768 | 48 / 40 px | 40 / 40 px |
| 1440 | 24 / 16 px | 16 / 16 px |

Files: `skeleton-before-<width>.png`, `skeleton-after-<width>.png`, `loaded-after-<width>.png`.

## Offline first launch

With the origin unreachable, iOS released the splash from `offline.html` between 3 s and 6 s.

Before the follow-up fix, Android held the splash to the 12 s ceiling. Capacitor serves the Android error page without its bridge: `window.Capacitor` is `undefined` there, so the page cannot reach the plugin. `MainActivity` now hides the splash through the bridge when the loaded page is the error URL.

That Android fix was verified by code review and a successful `npm run android:build`, not on the emulator: `memory_pressure` reported 39 percent free, under the 45 percent rule for starting it. The review covered Capacitor 8's `Bridge.getErrorUrl`, `addWebViewListener`, `callPluginMethod`, `PluginCall` and `SplashScreenPlugin.hide`. `__tests__/nativeSplash.test.ts` holds the source to the contract.

## On the Vercel preview

Deployed with `npm run deploy:preview:prod-env -- --scope pubmax69` from this branch at `44118ee72` to `https://chengdu-mpb80efun-pubmax69.vercel.app` (deployment `dpl_kEKarSH9bS3eGUuaLDfcMuLThBsD`); `/api/version` names that commit. The preview shares the production database, so nothing here signs in or writes.

`preview/` holds the same skeleton measurement with "before" on production and "after" on the preview, plus the loaded `/tonight` at each width. `preview/results.json` holds the tops.

| Width | Before: skeleton / page | After on preview: skeleton / page |
| --- | --- | --- |
| 390 | 94 / 57 px | 57 / 57 px |
| 768 | 48 / 40 px | 40 / 40 px |
| 1440 | 24 / 16 px | 16 / 16 px |

No width scrolled horizontally. `e2e/native-shell-tonight-parity.spec.ts` passed both tests against the preview.
