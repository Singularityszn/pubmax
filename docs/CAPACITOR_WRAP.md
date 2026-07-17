# Capacitor iOS Wrap

PUBMAXX ships to the App Store as a Capacitor shell around the production PWA.
The Next.js app is **server-rendered** — there is no static export — so the
shell runs in **remote-URL mode**: `capacitor.config.ts` points
`server.url` at `https://pubmaxxing.com` and the WKWebView loads the live site.
Do not attempt `next export`; `webDir: "native/web-stub"` (a one-file
placeholder page) exists only to satisfy the CLI's copy step and is never
served inside the shell — pointing webDir at `public/` would bake its ~6 MB of
datasets/screenshots into the iOS binary as dead weight, so don't.

## What's in the repo

| Piece | File(s) |
| --- | --- |
| Capacitor config (remote-URL mode) | `capacitor.config.ts` |
| webDir stub (keeps public/ out of the binary) | `native/web-stub/index.html` |
| Native Xcode project (SPM, no CocoaPods) | `ios/` (`npx cap add ios` output; `ios/.gitignore` excludes generated copies) |
| Platform detection seam | `lib/nativePlatform.ts` (`isNativeApp()` / `nativePlatform()`) |
| Native camera seam | `lib/nativeCamera.ts`, wired into `components/moment/MomentCapture.tsx` |
| Push registration seam | `lib/nativePush.ts` → `POST /api/push-tokens` |
| Token storage (memory + Supabase) | `lib/pushTokenStore.ts`, `app/api/push-tokens/route.ts`, `supabase/migrations/20260717120000_0039_push_tokens.sql` |
| Push **sending** provider seam | `lib/pushProvider.ts` (`noopPushProvider` / `apnsPushProvider` stub, `selectPushProvider`) |
| Push **sending** fan-out | `lib/pushSender.ts` (resolves tokens, dispatches, prunes invalid) |
| Universal links manifest | `public/.well-known/apple-app-site-association` (+ Content-Type header rule in `next.config.mjs`) |

**Seam rule:** no file imports `@capacitor/*` except the `lib/native*.ts` seam
modules. Everything else branches on `isNativeApp()`.

## Developer workflow

```sh
npm install                 # installs @capacitor/{core,cli,ios,camera,push-notifications}
npx cap sync ios            # refresh plugins/config into ios/ after dependency changes
npx cap open ios            # open ios/App in Xcode (requires full Xcode, not just CLT)
```

`ios/` was generated with Capacitor 8, which uses **Swift Package Manager**
(`ios/App/CapApp-SPM`) — CocoaPods is not required. Building/running does
require full Xcode (`xcode-select` must point at an Xcode.app, not
CommandLineTools).

## Remaining manual steps (need Apple developer access)

1. **Signing** — in Xcode, select the `App` target → Signing & Capabilities,
   set the team and confirm bundle id `com.pubmaxx.app`.
2. ~~Camera permission strings~~ — **done in repo**: `ios/App/App/Info.plist`
   carries `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`.
   `NSPhotoLibraryAddUsageDescription` is deliberately omitted: the capture
   seam never writes to the gallery (`saveToGallery` stays at its `false`
   default in `lib/nativeCamera.ts`) — add the key only if that changes.
3. **Push (APNs)**
   - Add the *Push Notifications* capability to the App target.
   - Create an APNs Auth Key in the Apple Developer portal; store it wherever
     the server-side sender will live. Server-side push **sending** is not
     built yet — `/api/push-tokens` only registers device tokens.
   - ~~AppDelegate forwarding~~ — **done in repo**: `ios/App/App/AppDelegate.swift`
     forwards `didRegisterForRemoteNotificationsWithDeviceToken` /
     `didFailToRegisterForRemoteNotificationsWithError` to Capacitor's
     `.capacitorDidRegisterForRemoteNotifications` /
     `.capacitorDidFailToRegisterForRemoteNotifications` notifications
     (canonical Capacitor 8 push setup). Not yet compiled locally — no Xcode
     on this machine; first `xcodebuild` will confirm.
   - Create an APNs Auth Key in the Apple Developer portal. The server-side
     **sending pipeline is now built** behind a provider seam
     (`lib/pushProvider.ts` + `lib/pushSender.ts`); it runs the `noopPushProvider`
     (logs + reports every token `skipped`) until the APNs env keys exist. To go
     live, set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY` (bundle id is
     `com.pubmaxx.app`) — `selectPushProvider()` then flips to `apnsPushProvider`
     with no caller change. **Remaining APNs drop-in work:** `apnsPushProvider`
     is a stub — implement the HTTP/2 POST to `api.push.apple.com` with a
     per-request ES256 JWT (signed from `APNS_PRIVATE_KEY`, `APNS_KEY_ID` in the
     JWT header, `APNS_TEAM_ID` as issuer, bundle id as `apns-topic`), mapping
     the APNs response to `PerTokenResult` (`410`/`BadDeviceToken` → `invalid`
     so the token is pruned). No APNs SDK is added yet.

### Push sending: what fires today vs. what's dormant

`lib/pushSender.ts` drives the fan-out. **Tokens are registered pre-auth**
(`lib/nativePush.ts` posts on shell boot), so a token row carries **no
user/plan identity**. Consequences, enforced in code:

- **Night-signal "went live" broadcast — ACTIVE.** `GET /api/night-signals`
  fires `maybeBroadcastNightSignalLive()` (fire-and-forget, deduped per snapshot
  `generatedAt` so it sends at most once per deploy per server instance). A live
  signal is public, so wholesale delivery to `pushTokenStore().list()` is
  correct — this is the one launch event that can target today.
- **Plan-scoped sends (proposal decision, get-in change) — DORMANT.** The
  proposal-decision route wires `notifyPlanUpdate()` fire-and-forget, but
  `resolvePlanTokens()` returns `[]` (the PLAN-SCOPED SEAM) because there is no
  token→plan link. Sending to all tokens would leak Plan A's updates to Plan B's
  devices, so the path stays closed. `getin/route.ts` is read-only, so it has no
  server write moment — its notification rides the plan mutation instead.
  **To activate:** once a token row can be linked to a member/plan, wire
  `resolvePlanTokens()` to that lookup; the rest of the pipeline is unchanged.
   - Add the standard `AppDelegate` forwarding of APNs callbacks to Capacitor
     if the template didn't include it (Capacitor docs → Push Notifications).
4. **Universal links**
   - Add the *Associated Domains* capability with
     `applinks:pubmaxxing.com`.
   - Replace the `TEAMID` placeholder in
     `public/.well-known/apple-app-site-association` with the real Apple Team
     ID (final appID string: `TEAMID.com.pubmaxx.app`). Covered paths:
     `/plan/*`, `/rounds/*`, `/p/*`.
   - Deploy, then verify `https://pubmaxxing.com/.well-known/apple-app-site-association`
     returns `Content-Type: application/json` (header rule in `next.config.mjs`).
5. **Supabase migration** — apply
   `supabase/migrations/20260717120000_0039_push_tokens.sql` to production
   (`supabase db push` per the usual ledger flow); until then the API route
   falls back to the process-memory store.
6. **Wire `registerNativePush()`** into the app boot path once product decides
   *when* to prompt (it is deliberately not called anywhere yet — iOS permission
   prompts are one-shot, so the trigger moment is a product decision).
