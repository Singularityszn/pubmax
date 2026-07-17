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
2. **Camera permission string** — add `NSCameraUsageDescription` (and
   `NSPhotoLibraryUsageDescription` / `NSPhotoLibraryAddUsageDescription`) to
   `ios/App/App/Info.plist`; required by `@capacitor/camera`.
3. **Push (APNs)**
   - Add the *Push Notifications* capability to the App target.
   - Create an APNs Auth Key in the Apple Developer portal; store it wherever
     the server-side sender will live. Server-side push **sending** is not
     built yet — `/api/push-tokens` only registers device tokens.
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
