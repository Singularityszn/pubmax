# The pubmaxx:// scheme on both shells

Captured on 13 September 2026 for lane 8 of the site audit (D20). Both shells were built from this branch and loaded a local keyless production build of it (`PUBMAX_NATIVE_SERVER_URL`), so the in-app route is this branch's `lib/nativeDeepLinks.ts`.

## Before

`xcrun simctl openurl <udid> pubmaxx://...` failed with `LSApplicationWorkspaceErrorDomain error 115`, because neither shell registered the scheme.

## After

| File | What it shows |
| --- | --- |
| `ios-open-prompt.png` | `xcrun simctl openurl <udid> 'pubmaxx://map?sel=venue-1vle947'` exits 0, and iOS asks "Open in "PUBMAXXING"?". iOS shows this prompt for any custom scheme opened from outside an app. |
| `ios-warm-map-sel.png` | With the app open on `/tonight`, the same link opens the map on The Sir Christopher Hatton with its sheet. |
| `ios-warm-tonight.png` | With the app open on the map, `pubmaxx://tonight` moves it to `/tonight`. |
| `ios-cold-map-first-visit.png` | A cold open of the map link on a fresh container reaches `/map` and shows the map's first-visit arrival card, not the sheet. |
| `android-cold-map-sel.png` | `adb shell am start -a android.intent.action.VIEW -d 'pubmaxx://map?sel=venue-1vle947'` cold-starts the app on The Sir Christopher Hatton sheet. |

On Android, `pm query-activities -a android.intent.action.VIEW -d 'pubmaxx://tonight'` resolves to `com.pubmaxx.app/.MainActivity`, and `@capacitor/app` fires `appUrlOpen` with the link.

Universal links and App Links were not tested: they need a signed build with the real Team ID or signing fingerprint.
