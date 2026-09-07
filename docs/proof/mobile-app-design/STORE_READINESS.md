# Store readiness, checked against the current guidelines

7 September 2026. Read fresh from Apple's App Review Guidelines
(developer.apple.com/app-store/review/guidelines), App Store Connect's
screenshot specifications, and Google Play's asset, target-API, account-deletion
and user-generated-content policy pages on the same day. `docs/STORE_READINESS.md`
is the paste sheet (copy, ratings, privacy answers) and its section 8 is the
ordered account checklist; this page is the review against what the shells
ship today, and it names three kinds of item: **blocks submission**, **done**,
and **captain's hand**.

The rigs: iPhone 17 Pro simulator (iOS 26.5, Xcode 26.6) and a Pixel 7 AVD
(API 36, WebView 133). What a simulator cannot prove is listed under the
captain's hand rather than claimed.

## Blocks submission

| # | Store | Item | Why it blocks | Where |
| --- | --- | --- | --- | --- |
| B1 | Apple | **Sign in with Apple is not optional while Google sign-in is offered.** Guideline 4.8: an app that uses a third-party or social login to set up the primary account must also offer an equivalent option that limits data to name and email, lets the address stay private, and collects no interactions for advertising. `docs/STORE_READINESS.md` section 8 step 13 calls Apple sign-in "only if you want it at launch"; under 4.8 that is true only if Google is switched off on iOS. | Enable the Apple provider in Supabase (`docs/DEPLOYMENT.md` "Apple") so `SocialSignInButtons` renders both, or hide Google on the shell until it is. | `components/auth/SocialSignInButtons.tsx`, `lib/socialAuthProviders*` |
| B2 | Both | **The OAuth return path needs a verified link, and until it is verified in-shell sign-in opens the browser.** Inside the shell the provider now opens in the system browser (#1599) and returns to `https://pubmaxxing.com/auth/callback`. On iOS that is a universal link, on Android an App Link, and neither is verified until the captain publishes the two files below with real values. Until then the callback opens Safari or Chrome instead of the app and a Google or Apple sign-in does not finish inside it; email sign-in is unaffected. This is expected and stated, not worked around: a custom URL scheme can be claimed by any other app on the device, so verified links are the only secure return path (firstmate decision, 7 September). | The exact steps are under "Verified links" below. | `lib/nativeOAuth.ts`, `lib/nativeDeepLinks.ts` |
| B3 | Apple | **iPad is either supported with screenshots or switched off.** `TARGETED_DEVICE_FAMILY = "1,2"` in `ios/App/App.xcodeproj/project.pbxproj` makes the binary universal, so App Store Connect requires 13-inch iPad screenshots (2064x2752 or 2048x2732) and reviewers test on iPad, where `Info.plist` permits landscape and the layout crosses into the untested desktop class at 844pt. `docs/STORE_READINESS.md` section 6 assumes iPhone only. | Decision open (see below). The honest v1 is `TARGETED_DEVICE_FAMILY = 1`. | `project.pbxproj`, `Info.plist` |
| B4 | Both | **The support mailbox must answer.** Guideline 1.2 requires published contact information for an app with user-generated content, and Play's UGC policy the same; `support@pubmaxxing.com` is printed on /privacy, /terms, /about and /account/delete and does not exist yet. | Captain: section 8 "Before either store". | `lib/siteContact.mjs` |
| B5 | Apple | **A demo account for App Review.** Guideline 2.1(a): include demo account details when the app has a login, and turn the back end on. The reviewer must reach the price composer, a photo wall, Social and Messages. | Captain: create a review account and put its email and password in App Review notes, or approve a demo mode with Apple first. | App Store Connect review notes |
| B6 | Both | **Push cannot register without the owner's keys.** iOS needs the APNs key set on the server and a team-signed build; Android needs `google-services.json`. Neither is in the tree by design, so a review build from this checkout registers nothing and the notification permission explainer would spend its one ask on a silent failure. | Captain: section 8 iOS steps 7 and 8, Play Firebase step. | `lib/nativePush.ts`, `android/app/google-services.json.example` |

## Done, and measured on this pass

| Item | Evidence |
| --- | --- |
| Launch screen on iOS: ink field and the coral mark, light and dark (was a black frame on iOS 26). | `ios-sim-iphone17pro/launch/` |
| Android system splash: ink field and the coral mark, unclipped (was Material grey with a clipped white disc). | `android-emu-pixel7/launch/` |
| Icons: white tile with the coral X on the iOS home screen in light and dark; adaptive icon on Android. | `ios-sim-iphone17pro/icons/`, `android-emu-pixel7/launch/before-settled.png` |
| Status bar glyphs are dark on light pages and light on dark pages on both platforms, and the shell now follows the OS appearance while open. | `ios-sim-iphone17pro/tonight/`, `android-emu-pixel7/launch/after-settled-dark.png` |
| Safe areas: one inset at the top (was two on /out, /today, /plan), the tab bar above the home indicator and above the gesture bar, and the band an old Android WebView leaves under the clock is the page's own paper. | `ios-sim-iphone17pro/out/`, `android-emu-pixel7/launch/` |
| Keyboard: the plan composer keeps its field in view on iOS; the Pint Drop composer keeps its price field in view on Android (was pushed off the top). | `ios-sim-iphone17pro/plan/`, `android-emu-pixel7/composer/` |
| Android Back: dismisses the keyboard, then the sheet, then history, then backgrounds the app rather than killing it. | `android-emu-pixel7/back/` |
| Deep links into `/tonight` and `/map?sel=<venue>` open the pub inside the app (Android, with the package named, since verification needs the captain's fingerprint). | `android-emu-pixel7/deeplink/` |
| The OS share sheet opens from the Tonight page on both platforms (Android never opened one before). | `ios-sim-iphone17pro/share/`, `android-emu-pixel7/share/` |
| Offline cold start shows the bundled offline page, and reconnecting recovers. | `android-emu-pixel7/offline/` |
| Text at 2.0x scale and three-button navigation both lay out without clipping. | `android-emu-pixel7/textscale/`, `android-emu-pixel7/nav/` |
| Third-party sign-in opens the system browser inside the shell instead of a Google error page. | `lib/nativeOAuth.ts`, `__tests__/nativeOAuth.test.ts` (round trip needs B2) |
| The store review ask is once ever, after two kept actions, never on a failure, and now actually reaches the platform (the plugin proxy bug spent nothing and asked nothing). | `__tests__/nativeReviewPrompt.test.ts`, `__tests__/capacitorPluginProxy.test.ts` |
| Location copy: the iOS purpose string ("uses your location while the app is open to find nearby pubs and calculate walk times") matches the first-visit map card ("Location is used only while the map is open") and /privacy. There is no `lib/locationDisclosure.ts` in the tree; the strings live in `Info.plist` and the map card. | `ios-sim-iphone17pro/map/dark.png` |
| Account deletion in-app and a web page a stranger can open (`/account/delete`); reporting, blocking and moderation exist for every UGC surface; terms are linked on the sign-in page before any content can be created. | `docs/STORE_READINESS.md` sections 4 and 5 |
| Privacy manifest (`PrivacyInfo.xcprivacy`), export compliance key, portrait-only iPhone, no `armv7`, `allowBackup=false`, `POST_NOTIFICATIONS` declared, camera not required hardware. | `ios/App/App/Info.plist`, `android/app/src/main/AndroidManifest.xml` |
| Target API 36 clears Play's 31 August 2026 floor (API 36 for new apps and updates). | `android/variables.gradle` |
| Memory: 122 MB PSS at rest and 126 MB after ten minutes of map panning on the emulator's app process. | `android-emu-pixel7/README.md` |

## Verified links, step by step

Both files are served from the site's own `public/.well-known/` directory by
`next.config.mjs` with a short edge cache (`SHORT_EDGE_PUBLIC_ASSET_CACHE_CONTROL`),
so a deploy reaches the verifiers within minutes. Neither may redirect, and both
must answer `200` over https at the apex, `https://pubmaxxing.com/.well-known/...`.

**iOS: `public/.well-known/apple-app-site-association`.**

1. Enrol, then read the ten-character Team ID at
   <https://developer.apple.com/account> under Membership details.
2. Replace the one placeholder: `"appIDs": ["TEAMID.com.pubmaxx.app"]` becomes
   `"appIDs": ["<TEAM_ID>.com.pubmaxx.app"]`. The bundle id is already
   `com.pubmaxx.app` (`capacitor.config.ts` `appId`). Update the expected
   placeholder in `__tests__/iosCapabilities.test.ts` in the same commit.
3. Deploy, then check the served file: `curl -si https://pubmaxxing.com/.well-known/apple-app-site-association`
   must be `200`, `Content-Type: application/json`, no redirect, and carry the
   `/auth/callback` component alongside the others.
4. Verify with Apple's tool at <https://app-site-association.cdn-apple.com/a/v1/pubmaxxing.com>
   (the CDN copy Apple's devices read; a stale copy there means the edge cache
   has not expired yet). On a Mac with the device build installed,
   `swcutil dl -d pubmaxxing.com` prints what Apple's CDN holds.
5. On the iPhone, with the team-signed build installed (Xcode shows Associated
   Domains `applinks:pubmaxxing.com` under Signing & Capabilities, read from
   `ios/App/App/App.entitlements`), message yourself
   `https://pubmaxxing.com/auth/callback?x=1` and tap it from Messages: it must
   open the app, not Safari. A long-press on the link offers "Open in
   PUBMAXXING" once the association is live.

**Android: `public/.well-known/assetlinks.json`.**

1. The fingerprint is the **Play App Signing** certificate, not the upload
   key: Play Console, the app, Setup, App integrity, App signing key
   certificate, SHA-256. Before the first upload, the fingerprint of the
   release keystore you build with also works for a sideloaded release build:
   `keytool -list -v -keystore <release.keystore> -alias <alias> | grep SHA256`.
2. Replace `REPLACE_WITH_PLAY_APP_SIGNING_SHA256` with that value, colon
   separated, upper case, as `keytool` prints it. Keep both fingerprints in the
   array while an upload-key-signed build is still installed anywhere.
3. Deploy, then check: `curl -si https://pubmaxxing.com/.well-known/assetlinks.json`
   must be `200` and `Content-Type: application/json`, no redirect. Google's
   checker at
   <https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://pubmaxxing.com&relation=delegate_permission/common.handle_all_urls>
   must list `com.pubmaxx.app` with the fingerprint.
4. On a device with the release build installed:
   `adb shell pm verify-app-links --re-verify com.pubmaxx.app`, then
   `adb shell pm get-app-links com.pubmaxx.app`. Every declared domain must read
   `verified`; `none` or `legacy_failure` means the fingerprint or the served
   file is wrong. Then `adb shell am start -a android.intent.action.VIEW -d
   https://pubmaxxing.com/auth/callback?x=1` must open the app without a
   chooser.

**What each proves.** With both verified, the provider's redirect to
`/auth/callback` lands in the shell's own WebView, which holds the PKCE
verifier supabase-js wrote when the flow began, and the sign-in completes in
the app. The check that closes B2 is a Google and an Apple sign-in finishing
inside the installed app on each platform.

## Captain's hand, in order

1. Create `support@pubmaxxing.com` and prove a round trip (B4).
2. Decide B3 (iPad). B2's route is decided: verified links, steps above.
3. Apple: enrol, put the Team ID in the association file, set the team in Xcode, create the APNs key and set the four server values, enable the Apple provider in Supabase (B1), build to a device and prove camera, push and universal links there (`docs/STORE_READINESS.md` section 8 steps 1 to 10).
4. Play: enrol, install the toolchain, put the app-signing SHA-256 in `assetlinks.json`, add `google-services.json` and the upload keystore, build the bundle (section 8 Google Play steps).
5. Create the review account (B5) and write the App Review notes. Say in them what is native: the camera sheet on the price panel and the photo wall, push after a logged price, the OS share sheet, haptics on kept actions, Back that undoes, universal links, and the offline page. Guideline 4.2 is the one a remote-URL shell is most often refused under, and the notes are where the reviewer learns the app is more than the site.
6. Upload the assets below, paste the copy from `docs/STORE_READINESS.md` sections 1 to 5, answer the age rating as 18+ (Apple) and set the Play target audience to 18 and over.
7. TestFlight, then internal testing on Play, repeating step 3's device proofs on the distributed build.

## Screenshot sizes each store wants today

**Apple (App Store Connect, 7 September 2026).** One iPhone class is required, 6.9-inch, and it accepts `1260 x 2736`, `1290 x 2796` or `1320 x 2868` (portrait). 6.5-inch (`1284 x 2778` or `1242 x 2688`) is required only when no 6.9-inch set is supplied; every smaller class is optional and scaled from the larger. 1 to 10 per size, JPEG or PNG, no alpha. The shipped `public/store-assets/screenshots/ios-6.7/` set is `1290 x 2796` and is accepted as it stands; the folder name is stale, not the pixels. If B3 keeps iPad, the 13-inch class is required: `2064 x 2752` or `2048 x 2732`.

**Google Play (Play Console, 7 September 2026).** Icon `512 x 512` 32-bit PNG under 1024 KB; feature graphic `1024 x 500` JPEG or 24-bit PNG, no alpha; phone screenshots 2 to 8, 16:9 or 9:16, each side between 320 and 3840 px and the long side no more than twice the short, JPEG or 24-bit PNG, no alpha; at least four at 1080 px or more for the listing to qualify as high quality. Tablet screenshots (7 and 10 inch, 1080 to 7680 px) are recommended, not required. The shipped `play-phone` set is `1080 x 1920`, six shots, plus the feature graphic and the 512 icon.

## Not measurable on these rigs

Push delivery, the camera and photo-library sheets, haptics, universal-link and App-Link verification, the OAuth round trip, VoiceOver and TalkBack, a live OS-appearance change (the simulator does not deliver it to a running process; the theme-follow was proven in Chromium under the native flag), and cold-start time on real hardware. Each belongs to the captain's device pass in step 3 and step 4 above.

## Nits, not blocking

- iOS 26 draws a flat PNG icon under its glass; an Icon Composer layered icon would take the dark and tinted home-screen modes properly.
- The WKWebView form accessory bar (the up, down and tick row) rides above every keyboard in the shell; `@capacitor/keyboard` can hide it, at the cost of the Done control on a textarea.
- `drawable-v24/ic_launcher_foreground.xml` is the Android Studio template's green vector, referenced by nothing.
- On both platforms the search row for a pub says "No listed price" while its pin on the map carries a figure and its sheet says "No price yet"; two surfaces, three answers, and none of it is the shell's (web lane).
