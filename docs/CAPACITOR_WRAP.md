# Capacitor Native Wrap

PUBMAXXING ships to the App Store as a Capacitor shell around the production PWA.
The Next.js app is **server-rendered** — there is no static export — so the
shells run in **remote-URL mode**: `capacitor.config.ts` points
`server.url` at `https://pubmaxxing.com` and the WKWebView loads the live site.
Do not attempt `next export`; `webDir: "native/web-stub"` (a two-file
placeholder page) exists only to satisfy the CLI's copy step and is never
served during a healthy launch — pointing webDir at `public/` would bake its ~6 MB of
datasets/screenshots into the iOS binary as dead weight, so don't.

`server.errorPath: "offline.html"` is the one exception: if the first main-frame
load cannot reach production, Capacitor serves the bundled
`native/web-stub/offline.html`. It says that live data is unavailable, shows no
stale prices or times, and offers a retry. The site's service worker remains the
later-session fallback after at least one healthy remote load.

On Android, "Try again" returns to the page that failed, so a shared plan link
opened with no signal is not lost. `OfflineRetryWebViewClient` records the one
failed main-frame URL in memory and `OfflineRetryDestination` hands it back when
the offline page asks for the site root. The shell replaces the offline page
with it, so Back never returns to a stale offline page. It holds only a network
failure or an HTTP status a retry can fix (5xx, 408 or 429), never a page that
is gone. It never replays `/auth/callback`, the marked callback landing, or a
URL that carries a credential parameter. When nothing safe is held, the button
goes to the root as before. iOS does not do this yet: the shell has no seam
that records the failed URL, so the same button there goes to the root.

## Cold start

The shell opens on the launch mark and keeps it until the page has painted or
the 12 s ceiling, whichever comes first. Before 13 September 2026 it did not. A clean install against production on the
`pubmaxx-390x844` simulator showed the bare ink field for 20 seconds: the first
document committed 21.5 s after launch, and nothing native held the mark over
the wait.

What holds the mark now:

1. iOS draws the `UILaunchScreen` dictionary in `ios/App/App/Info.plist`.
2. `@capacitor/splash-screen` takes over with the same field and mark
   (`plugins.SplashScreen` in `capacitor.config.ts`). Auto-hide stays on at a
   12 s ceiling, so a dead network still reaches `offline.html`.
3. `lib/nativeSplash.ts` hides the splash sooner. After the shell chrome
   mounts, it waits for a painted frame and hides the splash once per
   document.
4. When the first load fails, the offline page releases the splash at once.
   On iOS, `native/web-stub/offline.html` calls the plugin itself. Android
   serves that error page without the Capacitor bridge (`window.Capacitor` is
   `undefined` there), so `MainActivity` hides the splash when the error URL
   has loaded.

Measured on the local build rig (`PUBMAX_NATIVE_SERVER_URL=http://localhost:3811`)
on 13 September 2026: launch screen to 1.0 s, splash mark to 3.4 s, the page
painted at 3.4 s and the splash gone by 3.65 s. No frame showed the bare field.

Three facts to keep:

- **The plugin's iOS half loads a storyboard.** It instantiates the storyboard
  that `UILaunchStoryboardName` names, else one called `LaunchScreen`, and the
  app aborts at launch when none is in the bundle. So
  `ios/App/App/Base.lproj/LaunchScreen.storyboard` ships as an in-app view only.
  Do not name it in `Info.plist`: the iOS 26 runtime draws a launch storyboard
  as a black frame, which is why the launch screen is the dictionary.
- **Ship the web before the binary.** The release on first paint lives in the
  site, and the shell loads the site. A binary with the plugin against a site
  without `lib/nativeSplash.ts` holds the mark for the full 12 s on every
  launch.
- **The simulator shows iOS's cached launch snapshot in a shifted coral.**
  The assets are brand-exact: `LaunchMark` decodes to `(255, 90, 95)`, which
  is `#ff5a5f`, and so does the snapshot iOS caches in the app container
  (`Library/SplashBoard/Snapshots/*.ktx`). Only a launch the simulator draws
  from that snapshot shifts. Measured on 13 September 2026 on
  `pubmaxx-390x844`:

  | Capture | Snapshot launch | Live splash |
  | --- | --- | --- |
  | `simctl io screenshot` | `(255, 73, 88)` | `(255, 91, 95)` |
  | macOS window capture (display colour) | `(235, 88, 94)` | `(236, 103, 101)` |

  Brand coral on that display is about `(234, 103, 100)`, so the live splash
  is right. Untagged, sRGB-tagged and Display P3 assets all gave the same
  snapshot shift. With the snapshot deleted, the launch screen draws brand
  coral. The assets therefore stay brand-exact: a pre-compensated image would
  be wrong on every launch that has no snapshot yet, and a simulator cannot
  say what an iPhone shows. `docs/STORE_READINESS.md` carries the real-iPhone
  check.

### The first-document wait

The 20 s wait was the network, not the app. From this Mac on the same morning,
`curl` to `https://pubmaxxing.com` stalled for 7 to 20 s on some requests and
answered in 0.1 s on others. The stalls hit a `curl/8` user agent as often as
an iPhone one, and they hit `/offline.html` served as an edge `HIT` too. So the
evidence does not point at a bot challenge for an unknown user agent.

The shell appends `PUBMAXXING-App` to its user agent (`appendUserAgent` in
`capacitor.config.ts`), so an edge rule can match the app without matching
every iPhone. Changing Vercel settings is the captain's decision; this
repository changes none.

### Judging a shell build

Before you judge what a simulator or an emulator shows, read the origin the
installed binary loads: `App.app/capacitor.config.json` on iOS, and the
`capacitor.config.json` under `android/app/src/main/assets/` on Android. The
13 September audit saw `/tonight` drawn with its actions before its listings.
The binary under audit was a 5 September build that loaded a preview deployment
from before that layout change, and a clean build of main drew the web's
layout. `e2e/native-shell-tonight-parity.spec.ts` holds the shell's `/tonight`
to a plain fetch of the same URL.

## What's in the repo

| Piece | File(s) |
| --- | --- |
| Capacitor config (remote-URL mode) | `capacitor.config.ts` |
| webDir stub (keeps public/ out of the binary) | `native/web-stub/index.html` |
| Honest first-load outage fallback | `native/web-stub/offline.html`, `server.errorPath` |
| Native projects | `ios/` (SPM, no CocoaPods) and `android/` |
| Platform detection seam | `lib/nativePlatform.ts` (`isNativeApp()` / `nativePlatform()`) |
| Native photo seam | `lib/nativeCamera.ts`, wired into `components/moment/MomentCapture.tsx`, `components/map/VenuePriceSubmit.tsx` (price board), `components/venue/VenuePhotoComposer.tsx` (pub wall) and `components/drink-wall/DrinkWallComposer.tsx` (Drink Wall) |
| iOS capabilities (push, associated domains) | `ios/App/App/App.entitlements`, referenced by both build configurations |
| iOS privacy manifest | `ios/App/App/PrivacyInfo.xcprivacy` (mirrors STORE_READINESS section 5) |
| Foreground location declarations | `ios/App/App/Info.plist`, `android/app/src/main/AndroidManifest.xml` |
| Launch splash release | `lib/nativeSplash.ts`, mounted by `components/native/NativeShellChrome.tsx`; `MainActivity` for the Android offline page (see "Cold start") |
| Native system-bar seam | `lib/nativeSystemBars.ts`, mounted by `components/native/NativeSystemBars.tsx` |
| Universal/app-link route seam | `lib/nativeDeepLinks.ts`, mounted by `components/native/NativeDeepLinks.tsx` |
| Push registration seam | `lib/nativePush.ts` → `POST /api/push-tokens` |
| Token storage (memory + Supabase) | `lib/pushTokenStore.ts`, `app/api/push-tokens/route.ts`, `supabase/migrations/20260717120000_0039_push_tokens.sql` |
| Push **sending** provider seam | `lib/pushProvider.ts` (`noopPushProvider` / HTTP/2 `apnsPushProvider`, `selectPushProvider`) |
| Push **sending** fan-out | `lib/pushSender.ts` (resolves tokens, dispatches, prunes invalid) |
| Universal links manifest | `public/.well-known/apple-app-site-association` (+ Content-Type header rule in `next.config.mjs`) |
| Android HTTPS deep-link filters | `android/app/src/main/AndroidManifest.xml` |
| Android App Links statement | `public/.well-known/assetlinks.json` (+ Content-Type and short-edge header rule in `next.config.mjs`) |
| Android camera + media declarations | `android/app/src/main/AndroidManifest.xml` (`CAMERA`, `READ_MEDIA_IMAGES`, and the legacy read capped at API 32) |
| Android release signing | `android/app/build.gradle`, reading the gitignored `android/keystore.properties` |
| Firebase config placeholder | `android/app/google-services.json.example` (the real file is gitignored) |

**Seam rule:** no file imports `@capacitor/*` except the `lib/native*.ts` seam
modules. Everything else branches on `isNativeApp()`.

The owner approved the universal/app-link route seam as an early Wave 1
wrapped-shell prerequisite on 2026-07-21. It remains allow-listed and a safe
no-op on web; this exception does not open the broader Wave 7 native companion
scope.

## Developer workflow

```sh
npm install                 # installs the core/platform + app/camera/push plugins
npx cap sync                # refresh both checked-in native projects
npx cap open ios            # open ios/App in Xcode (requires full Xcode, not just CLT)

npm run ios:build           # cap sync ios, then build the App scheme, unsigned
npm run ios:run             # the same build, then boot a simulator and launch it

npm run android:build       # cap sync android, assembleDebug, then testDebugUnitTest
npm run android:run         # the same APK, on a headless emulator, with a screenshot
```

The iOS pair is `scripts/ios-simulator.mjs`, the local verification path: no
Apple account, no team, no signing. `ios:run` picks the newest available
iPhone simulator, or takes one by name through `PUBMAX_IOS_SIMULATOR`, and
prints the `xcrun simctl io ... screenshot` line for the device it used.
Derived data lands in gitignored `ios/build/`.

The Android pair is `scripts/android/`, on the same terms: no Play account, no
upload key, no Firebase project. `android:run` creates the `pubmaxx` AVD if it
is not there (`PUBMAX_ANDROID_AVD` names another), boots it headless, installs,
launches, and writes the shot to gitignored `android/build/emulator/`.
`scripts/android/toolchain.mjs` resolves JAVA_HOME and ANDROID_HOME and refuses
by name when one is missing. STORE_READINESS's Local verification section has
the SDK packages and the two emulator traps the script already handles.

`ios/` was generated with Capacitor 8, which uses **Swift Package Manager**
(`ios/App/CapApp-SPM`), so CocoaPods is not required. Two consequences matter
before hand-running a build. There is no `App.xcworkspace` and no Podfile, so
`xcodebuild` takes `-project ios/App/App.xcodeproj`, and a `-workspace`
invocation fails on a healthy checkout. And `Package.swift` names each plugin by
a relative path into `node_modules`, so `npx cap sync ios` has to run before the
build or the previous plugin list is what compiles. The script does both.
Building or running does require full Xcode (`xcode-select` must point at an
Xcode.app, not CommandLineTools).

Two things a fresh Xcode needs before it can build, both one-off and both
easy to mistake for a project fault. Its licence must be accepted
(`sudo xcodebuild -license accept`); until it is, EVERY `xcrun`-backed command
fails, including plain `git`, because macOS ships git as an xcrun shim. And it
carries no iOS simulator runtime (`xcrun simctl list runtimes` is empty), so
`xcodebuild -downloadPlatform iOS` has to run once. First verified build on
this project: Xcode 26.6, iOS 26.5 runtime, iPhone 17 Pro simulator, 2026-09-04.

Before sync, hash or copy intentional native files (`AppDelegate.swift`,
`SceneDelegate.swift`, `Info.plist`, `AndroidManifest.xml`, and
`MainActivity.java`), then compare them afterward. The 2026-07-20 Gate Z
refresh did this for four of them and sync preserved all four;
see `docs/screenshots/WRAPPED_BUILD_GATE_Z_2026-07-20.md`.

### Reviewing a local build in the shells

The shell is a remote-URL wrap of production, so by default a simulator or an
emulator shows what has shipped, not the checkout. To review a checkout, run a
local production server and point ONE sync at it:

```sh
NEXT_DIST_DIR=.next-prod PUBMAX_E2E_KEYLESS=1 npm run build
NEXT_DIST_DIR=.next-prod PUBMAX_E2E_KEYLESS=1 npm run start -- --port 3811
PUBMAX_NATIVE_SERVER_URL=http://localhost:3811 npm run ios:run      # simulator: localhost is the Mac
PUBMAX_NATIVE_SERVER_URL=http://10.0.2.2:3811 npm run android:run   # emulator: 10.0.2.2 is the host
```

`capacitor.config.ts` reads the variable at `npx cap sync` time alone and sets
`cleartext` when the scheme is `http`, so the emulator can load it; both
generated `capacitor.config.json` files are untracked, so nothing about a
shipped binary changes and `__tests__/nativeWrap.test.ts` holds the unset case
to `https://pubmaxxing.com`. Run a plain `npx cap sync` before building anything
you intend to distribute. Proof captured this way says so in its README, because
a shot of a local build is not a shot of production.

### The UIScene lifecycle (iOS 27)

iOS 27 refuses to launch an app that has not adopted the UIScene lifecycle. A
free personal-team build of main on an iPhone 17 Pro Max (iOS 27.2) crashed at
launch with `EXC_BREAKPOINT` in UIKitCore
`___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke`.
The iOS 27.0 simulator does not enforce this: the same build without the
manifest launches there, so a simulator launch cannot prove the fix. The
source fence in `__tests__/nativeWrap.test.ts` holds it instead.

The Info.plist manifest follows Capacitor 8.5's `npx cap migrate` output
(template in `@capacitor/cli`). The delegates do not. The CLI template's
SceneDelegate builds the window by hand, and this app lets the `Main` storyboard
build it instead. The CLI template's AppDelegate also returns the scene
configuration from `configurationForConnecting`, and this app leaves that out
because the manifest already names the delegate class.

- `ios/App/App/Info.plist` carries `UIApplicationSceneManifest`: one scene
  (multiple scenes off), storyboard `Main`, delegate
  `$(PRODUCT_MODULE_NAME).SceneDelegate`.
- `ios/App/App/SceneDelegate.swift` is its own file in the App target. It
  forwards `willConnectTo`, `openURLContexts` and `continue userActivity` to
  Capacitor's `SceneDelegateProxy`. A cold-start `pubmaxx://` link or universal
  link is queued by the proxy until the bridge view has appeared. The
  storyboard `Main` builds the window and its bridge, so the delegate never
  builds one by hand.
- `AppDelegate.swift` keeps the APNs token forwarding. UIKit reads the scene
  delegate class from the manifest's `UISceneDelegateClassName`. The
  `application(_:open:options:)` and `application(_:continue:restorationHandler:)`
  forwards are deleted: with a scene manifest UIKit never calls them.

Proof, iPhone 17 simulator on iOS 27.0 (Xcode 27.0), `npm run ios:build`:

- Cold launch: the site loads, and the status bar and safe area are intact.
- Background and foreground: launching Settings and then the app resumes the
  same process, and the scene moves `Background` then `ForegroundInactive`
  then active.
- `pubmaxx://` link: `xcrun simctl openurl` stops at the system "Open in
  PUBMAXXING?" prompt, and tapping it needs UI automation this lane may not use.
  The forwarding is held by the unit test and still needs a device pass.
- No iOS 26 simulator runtime is installed on this Mac, so the iOS 26 pass is
  open.
- Push token forwarding and the entitlements are unchanged, and still need a
  signed device (step 10).

## Remaining manual steps (need Apple developer access)

This section says WHY each step exists and what the code already does.
[`STORE_READINESS.md` section 8](./STORE_READINESS.md#8-owner-only-remaining-steps)
is the ordered checklist to work through, with one command per step.

1. **Signing** — in Xcode, select the `App` target → Signing & Capabilities,
   set the team and confirm bundle id `com.pubmaxx.app`. The two capabilities
   are already declared: `ios/App/App/App.entitlements` is checked in and both
   build configurations set `CODE_SIGN_ENTITLEMENTS`, so Xcode reads Push
   Notifications and Associated Domains from the file rather than asking you to
   add them. Adding one by hand writes a second entitlements file, and the two
   then disagree about what the app asks for.
2. ~~Camera permission strings~~ — **done in repo**: `ios/App/App/Info.plist`
   carries `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`.
   `NSPhotoLibraryAddUsageDescription` is deliberately omitted: the capture
   seam never writes to the gallery (`saveToGallery` stays at its `false`
   default in `lib/nativeCamera.ts`) — add the key only if that changes.
   Foreground location is also declared on both platforms for existing
   nearby-pub and walk-time actions. iOS carries
   `NSLocationWhenInUseUsageDescription`; Android carries coarse and fine
   location together. Neither platform requests background location.
3. **iOS push (APNs)**
   - ~~Push Notifications capability~~ — **declared in repo**:
     `aps-environment` is `development` in `ios/App/App/App.entitlements`.
     Xcode rewrites it to `production` when it distributes an archive, which is
     why `APNS_ENV` is set per deployment rather than read from that file.
   - ~~AppDelegate forwarding~~ — **done in repo**: `ios/App/App/AppDelegate.swift`
     forwards `didRegisterForRemoteNotificationsWithDeviceToken` /
     `didFailToRegisterForRemoteNotificationsWithError` to Capacitor's
     `.capacitorDidRegisterForRemoteNotifications` /
     `.capacitorDidFailToRegisterForRemoteNotifications` notifications
     (canonical Capacitor 8 push setup). It compiles: `npm run ios:build` is
     green on Xcode 26.6. Compiling is not delivery, and a simulator can
     receive no push at all, so the token round trip is still step 10 on a
     device.
   - Create an APNs Auth Key in the Apple Developer portal. The server-side
     **sending pipeline and HTTP/2 transport are built** behind a provider seam
     (`lib/pushProvider.ts` + `lib/pushSender.ts`); it runs the `noopPushProvider`
     (logs + reports every token `skipped`) until APNs credentials exist. Set
     `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, and `APNS_ENV` together
     (bundle id is `com.pubmaxx.app`). Set `APNS_ENV=production` for TestFlight
     and App Store production tokens. Use `APNS_ENV=sandbox` only for tokens
     issued to development-signed builds by the APNs sandbox. A configured send
     with missing or invalid `APNS_ENV` fails closed instead of guessing an APNs
     host. Never commit the `.p8` key. Live delivery still requires the
     entitlement, credentials, signed build, and a real device-token smoke.
4. **Android push (Firebase Cloud Messaging)**
   - Create the Android app `com.pubmaxx.app` in Firebase. Download its owner
     configuration to `android/app/google-services.json`. Do not invent this
     file or copy one from another package.
   - Create a server service account with only Firebase Cloud Messaging API
     Admin access. Set `FCM_PROJECT_ID`, `FCM_CLIENT_EMAIL`,
     `FCM_PRIVATE_KEY_ID`, and `FCM_PRIVATE_KEY` together. Never commit the
     service-account JSON or private key.
   - `lib/fcmPushProvider.ts` mints short-lived OAuth tokens and sends through
     FCM HTTP v1. `lib/pushSender.ts` routes by the stored registration platform,
     so Android tokens never reach APNs. Missing credentials skip truthfully;
     a partial credential set fails loudly.
   - Source support does not prove delivery. A configured debug build must
     register, persist an Android token, receive one push, and open its safe
     internal route before release readiness can be claimed.

### Push sending: what fires today vs. what's dormant

`lib/pushSender.ts` drives the fan-out. **Tokens can register pre-auth**
after contextual permission approval, so a token row carries **no
user/plan identity**. Consequences, enforced in code:

- **Night-signal "went live" broadcast - ACTIVE in source for registered iOS,
  Android, and web devices.** `GET /api/night-signals`
  fires `maybeBroadcastNightSignalLive()` (fire-and-forget). Dedup is **durable**,
  not per-instance: it claims a budget-of-1 rate-limit bucket keyed
  `night-signal-broadcast:${generatedAt}` via `lib/pintDrops.isLimited` (the
  shared Supabase RPC limiter, in-memory fallback when unconfigured), so a
  snapshot version broadcasts **at most once globally** even across cold starts
  and concurrent serverless instances. A per-instance `Set` is only a cheap
  first check. The claim is consumed before the send (**at-most-once**: a failed
  send is dropped, never retried into a duplicate). A live signal is public, so
  wholesale delivery to `pushTokenStore().list()` is correct — this is the one
  launch event that can target today.
- **Plan-scoped sends (proposal decision, get-in change) — DORMANT.** The
  proposal-decision route wires `notifyPlanUpdate()` fire-and-forget, but
  `resolvePlanTokens()` returns `[]` (the PLAN-SCOPED SEAM) because there is no
  token→plan link. Sending to all tokens would leak Plan A's updates to Plan B's
  devices, so the path stays closed. `getin/route.ts` is read-only, so it has no
  server write moment — its notification rides the plan mutation instead.
  **To activate:** once a token row can be linked to a member/plan, wire
   `resolvePlanTokens()` to that lookup; the rest of the pipeline is unchanged.
5. **Universal links**
   - ~~Associated Domains capability~~ — **declared in repo**:
     `applinks:pubmaxxing.com` in `ios/App/App/App.entitlements`.
   - Replace the `TEAMID` placeholder in
     `public/.well-known/apple-app-site-association` with the real Apple Team
     ID (final appID string: `TEAMID.com.pubmaxx.app`). This is the ONE value
     in the repository that waits for enrolment. Covered families are whatever
     `lib/nativeDeepLinks.ts` declares, and `__tests__/nativeWrap.test.ts`
     holds the app fence, this file and the Android manifest to each other, so
     read the list there rather than from a copy that can rot.
   - Deploy, then verify `https://pubmaxxing.com/.well-known/apple-app-site-association`
     returns `Content-Type: application/json` (header rule in `next.config.mjs`).
   - Android declares `autoVerify` HTTPS filters for the same families, and
     `@capacitor/app` forwards cold and warm opens through the allow-listed
     `lib/nativeDeepLinks.ts` route seam.
     `public/.well-known/assetlinks.json` now ships beside the Apple manifest,
     carrying `REPLACE_WITH_PLAY_APP_SIGNING_SHA256`. The real value is the
     SHA-256 of GOOGLE'S app signing key (Play Console, Setup, App integrity),
     not the upload key you generated, and Android re-reads the file on install
     and on update. Until it is replaced, `pm get-app-links` reports a failure
     state for the host and shared links keep opening the browser. Both link
     manifests take a SHORT edge cache window for exactly this reason: the
     fingerprint has to reach the verifier in minutes, not after a year of CDN.
     `docs/STORE_READINESS.md` section 8 step 13 is the copy-paste version.
   - Email, Google, and Apple sign-in return through `/auth/callback`. The code
     path is ready, but it is not release proof until the Team ID or Android
     signing fingerprint is published and a physical-device sign-in returns to
     the signed-in WebView on each platform.
   - **Universal links and App Links need a signed build to test.** A
     team-less simulator build writes an empty entitlements file, so
     `https://pubmaxxing.com/map?sel=<id>` opens Safari there however correct
     the manifests are.
   - **The `pubmaxx://` scheme is the fallback, not the path.** Both shells
     register it: `CFBundleURLTypes` in `ios/App/App/Info.plist` and one plain
     intent filter in `android/app/src/main/AndroidManifest.xml`.
     `lib/nativeDeepLinks.ts` (`NATIVE_URL_SCHEME`) maps
     `pubmaxx://map?sel=<id>` onto the same families as the verified links.
     It never carries `/auth/callback`, because any app can register a custom
     scheme. On a rig:
     `xcrun simctl openurl <udid> 'pubmaxx://map?sel=<id>'` and
     `adb shell am start -a android.intent.action.VIEW -d 'pubmaxx://tonight' com.pubmaxx.app`.
6. **Supabase migration** - apply
   `supabase/migrations/20260717120000_0039_push_tokens.sql` to production
   (`supabase db push` per the usual ledger flow); until then the API route
   falls back to the process-memory store.
7. **Contextual prompt** - done in repo. `components/native/NativePushPrompt.tsx`
   calls `registerNativePush()` only after the user taps Turn on in an explainer
   armed by a qualifying plan action. It never requests permission at boot.
   The explainer promises only the active public night-signal broadcast. Native
   tokens do not yet carry account or Plan identity, so crew-scoped copy is not
   allowed. `activateNativePushNavigation()` attaches at shell boot and routes a
   validated `/tonight` or `/plan/*` notification target when the user taps it.
   iOS and Android show this prompt. Capacitor reports each platform token to
   the same API, and server fan-out keeps APNs, FCM, and VAPID separate. After
   opt-in, native boot refreshes the current token without requesting permission
   again, so APNs or FCM token rotation can recover on the next app launch.
