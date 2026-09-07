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
| 8 | iOS Larger Text did nothing to the page, and Android's 2.0x scale ran the six tab labels into each other and clipped the consent card | both | The shell applies the OS size on iOS, reads it on Android, and publishes a bucket the tab bar and the consent card change shape on | `ios-sim-iphone17pro/textscale/`, `android-emu-pixel7/textscale/` |
| 7 | The OS share sheet never opened in either shell and the store review was never requested: three loaders returned a Capacitor plugin Proxy from an async function; and the Android WebView has no `navigator.share` | Android (measured), iOS (same code) | Loaders hand back plain objects; the shell fills `navigator.share` over the plugin | `android-emu-pixel7/share/`, `ios-sim-iphone17pro/share/` |

Checked and sound: icons, status-bar glyphs in light and dark, safe areas and the tab bar over the home indicator and the gesture bar, keyboard on the plan composer (iOS), Android Back (keyboard, sheet, history, background), deep links into `/tonight` and `/map?sel=`, the offline cold start, three-button navigation, and memory across ten minutes of map panning.

Store readiness against the guidelines read on the day: `STORE_READINESS.md`.

## Coverage of the review loop

Every item the brief named, with the rig it was checked on. "Fallback" means
the rig cannot show it and the named substitute was used instead.

| Item | iOS | Android | Note |
| --- | --- | --- | --- |
| Launch and splash | measured, fixed | measured, fixed | `launch/` on both |
| Icons and adaptive icons | measured | measured | home screen shots; the Play adaptive layers are the generated set |
| Status bar style, light and dark | measured | measured | glyphs follow the page on both |
| Safe areas, notch and gesture nav | measured, fixed (double inset) | measured, fixed (band under the clock) | |
| Tab bar over the home indicator | measured | measured | |
| Keyboard avoidance: price, plan, sign-in field | plan and sign-in field measured; price via search | price measured through DevTools, fixed | the message and handle-claim composers need a signed-in session the keyless rig cannot mint; they share the sheet and page idioms measured here |
| Scroll restoration | not measured | not measured | a soft-navigation behaviour of the page, the same in a browser; outside the shell's seams |
| Pull-to-refresh | shell CSS (`overscroll-behavior`) | measured: a pull on Tonight reloads nothing | |
| Back gesture and hardware Back | n/a | measured: keyboard, sheet, history, then background | |
| Deep and universal links | fallback: unit tests, the AASA needs the Team ID | measured with the package named; verification needs the Play fingerprint | `STORE_READINESS.md` B2 |
| Share sheet | measured | measured, fixed | |
| In-app review timing | fallback: unit tests, and the proxy fix that let it fire at all | same | once ever, after two kept actions, never on a failure |
| Haptics | fallback: unit tests; a simulator has no engine | same | occasions on the kept actions the design system names |
| Offline and airplane mode | fallback: the bundled page is the same file | measured: the offline page on a cold start, recovery on reconnect | |
| Adult gate inside the shell | fallback: unit tests, `accountIsAdult` | same | needs a signed-in session; the surface is the same page as the web |
| Sign-in in a WebView | fixed: system browser | fixed: Custom Tab | the round trip needs the verified links (B2) |
| Photo pick and camera permissions | fallback: unit fences (`nativeCameraSurfaces`, `profilePhotoPicker`) | the wall's photo door is behind sign-in; the camera sheet is a device step | `STORE_READINESS.md` captain's hand |
| Location permission copy | measured: the plist string against the map card and /privacy | the manifest declares the two permissions; copy is the page's | there is no `lib/locationDisclosure.ts`; the strings live in `Info.plist` and the card |
| Notification permission timing | fallback: unit tests (`nativePushPrompt`) | same | after a kept action, never at launch |
| Text scaling at the largest setting | measured, fixed (was ignored) | measured, fixed (labels collided) | |
| VoiceOver and TalkBack | not measurable headless | not measurable headless | the tab bar keeps its accessible names at every size; `e2e/a11y-core-journeys.spec.ts` holds the page semantics |
| Cold start to first paint | measured: about 2.7 s to content on the local rig | measured: 3.7 to 5.3 s to the activity on software GL | |
| Memory after ten minutes of map use | not measured (no process view from `simctl`) | measured: flat on both processes | `android-emu-pixel7/README.md` |
