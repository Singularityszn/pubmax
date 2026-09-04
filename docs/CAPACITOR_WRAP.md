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

## What's in the repo

| Piece | File(s) |
| --- | --- |
| Capacitor config (remote-URL mode) | `capacitor.config.ts` |
| webDir stub (keeps public/ out of the binary) | `native/web-stub/index.html` |
| Honest first-load outage fallback | `native/web-stub/offline.html`, `server.errorPath` |
| Native projects | `ios/` (SPM, no CocoaPods) and `android/` |
| Platform detection seam | `lib/nativePlatform.ts` (`isNativeApp()` / `nativePlatform()`) |
| Native photo seam | `lib/nativeCamera.ts`, wired into `components/moment/MomentCapture.tsx`, `components/map/VenuePriceSubmit.tsx` (price board) and `components/venue/VenuePhotoComposer.tsx` (pub wall) |
| iOS capabilities (push, associated domains) | `ios/App/App/App.entitlements`, referenced by both build configurations |
| iOS privacy manifest | `ios/App/App/PrivacyInfo.xcprivacy` (mirrors STORE_READINESS section 5) |
| Foreground location declarations | `ios/App/App/Info.plist`, `android/app/src/main/AndroidManifest.xml` |
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
```

`ios/` was generated with Capacitor 8, which uses **Swift Package Manager**
(`ios/App/CapApp-SPM`) — CocoaPods is not required. Building/running does
require full Xcode (`xcode-select` must point at an Xcode.app, not
CommandLineTools).

Two things a fresh Xcode needs before it can build, both one-off and both
easy to mistake for a project fault. Its licence must be accepted
(`sudo xcodebuild -license accept`); until it is, EVERY `xcrun`-backed command
fails, including plain `git`, because macOS ships git as an xcrun shim. And it
carries no iOS simulator runtime (`xcrun simctl list runtimes` is empty), so
`xcodebuild -downloadPlatform iOS` has to run once. First verified build on
this project: Xcode 26.6, iOS 26.5 runtime, iPhone 17 Pro simulator, 2026-09-04.

Before sync, hash or copy intentional native files (`AppDelegate.swift`,
`Info.plist`, `AndroidManifest.xml`, and `MainActivity.java`), then compare them
afterward. The 2026-07-20 Gate Z refresh did this and sync preserved all four;
see `docs/screenshots/WRAPPED_BUILD_GATE_Z_2026-07-20.md`.

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
     (canonical Capacitor 8 push setup). Not yet compiled locally — no Xcode
     on this machine; first `xcodebuild` will confirm.
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
