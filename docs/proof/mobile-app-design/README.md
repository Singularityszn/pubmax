# Mobile app design review, iOS and Android shells

7 September 2026. Every finding names the rig it came from.

| Rig | What it is | Folder |
| --- | --- | --- |
| `ios-sim-iphone17pro` | iPhone 17 Pro simulator, iOS 26.5, Xcode 26.6, Capacitor 8.5 shell, no signing team | `ios-sim-iphone17pro/` |
| `android-emu-pixel7` | Pixel 7 AVD (`pubmaxx`), API 36 `google_apis` arm64, WebView 133, gesture navigation, headless under `swiftshader_indirect` | `android-emu-pixel7/` |

Both shells were synced against a local keyless production build of the branch
under review (`docs/CAPACITOR_WRAP.md`, "Reviewing a local build in the shells"),
so the pages inside the WebView are the checkout rather than production. Where a
measurement could not be taken on a rig, its README says so and names the
fallback that was used instead.

## Findings

| # | Finding | Rig | Fix | Proof |
| --- | --- | --- | --- | --- |
| 1 | The iOS launch screen was a black frame: the storyboard route draws nothing on the iOS 26 runtime, image or plain colour alike | iOS | `UILaunchScreen` over two asset-catalog entries cut from the one splash master | `ios-sim-iphone17pro/launch/` |
| 2 | /out, /today and /plan paid the top safe area twice (a 59pt band under the clock) | iOS, Android | Flat top on the three page shells; a fence over every shell under the standard bar | `ios-sim-iphone17pro/out/`, `plan/` |
| 3 | The page ignored an OS appearance change while the app was open | iOS | The shell re-applies the theme rule on `prefers-color-scheme` change | `ios-sim-iphone17pro/tonight/` |
| 4 | The Android system splash was Material grey with a clipped white-disc icon; the band under the clock on an older WebView was white over an off-white page | Android | SplashScreen theme values from the brand tokens; the window background is the page's paper, light and dark | `android-emu-pixel7/launch/` |
| 5 | The Pint Drop composer lost its price field under the keyboard: the Android WebView shrinks the layout viewport and the sheet's px height did not follow | Android | The sheet re-caps on resize and reveals the focused field | `android-emu-pixel7/composer/` |
| 6 | Third-party sign-in dead-ends in an embedded web view (Google refuses it) | both, by construction | The provider opens in the system browser; `/auth/callback` returns through the verified link | `STORE_READINESS.md` B2 |
| 7 | The OS share sheet never opened in either shell and the store review was never requested: three loaders returned a Capacitor plugin Proxy from an async function; and the Android WebView has no `navigator.share` | Android (measured), iOS (same code) | Loaders hand back plain objects; the shell fills `navigator.share` over the plugin | `android-emu-pixel7/share/`, `ios-sim-iphone17pro/share/` |

Checked and sound: icons, status-bar glyphs in light and dark, safe areas and the tab bar over the home indicator and the gesture bar, keyboard on the plan composer (iOS), Android Back (keyboard, sheet, history, background), deep links into `/tonight` and `/map?sel=`, the offline cold start, text at 2.0x, three-button navigation, and memory across ten minutes of map panning.

Store readiness against the guidelines read on the day: `STORE_READINESS.md`.
