# PUBMAXXING iPhone App — Product Requirements (v1)

**Status:** For Sol's review. Enables the app BUILD today (owner installs Xcode; free personal-team signing) with **paid Apple Developer enrollment deferred**.
**Author:** Fable 5 (architect/reviewer — no inline execution).
**Date:** 2026-07-18.
**Scope:** London-only v1. Every claim below is grounded in the repo; file references are inline.

> **Historical implementation snapshot.** This PRD records the 18 July review
> state and is not the current build ledger. Since then, F1-F3 have landed,
> native cold start is owner-locked to `/tonight`, the APNs HTTP/2 transport is
> implemented behind its no-op/configured provider seam, and Android is also
> scaffolded. F4 (real Team ID + Associated Domains) remains owner-blocked.
> Use `docs/CAPACITOR_WRAP.md` and
> `docs/screenshots/WRAPPED_BUILD_GATE_Z_2026-07-20.md` for current build truth.

Source branches read for this PRD (all open, none merged — Sol's queue):
- `#295` `feat/capacitor-ios-wrap` — shell, seams, `ios/` scaffold, push-token API + migration, AASA. Base of the native stack.
- `#299` `feat/native-first-run` (stacked on #295) — first-run redirect + contextual push prompt.
- `#300` `feat/push-senders` (stacked on #295) — server-side send pipeline behind an APNs-ready seam.
- `#312` `feat/identity-nudges`, `#313` `feat/a2hs-flow` — the two other interruptive-prompt surfaces the app must coordinate with.
- `docs/merge-order-matrix` → `docs/MERGE_ORDER_2026-07-18.md` (PR #316) — the executable merge plan ("MERGE_ORDER v2").
- `fable-implement-prd.md` — session decision log + PR queue.
- Grounding runbook: `docs/CAPACITOR_WRAP.md` (present on #295/#299/#300).

---

## 1. Product definition

**The iPhone app IS the mobile-web THE LOCAL / near-me experience, wrapped in a native shell, given three native superpowers.** It is not a reimplementation. The persona is unchanged from the mobile-web loop (`fable-implement-prd.md`): *a 9-to-5 worker leaving the office, any night, who wants a cheap good pint near where they are* and needs open → answer in seconds.

The three native superpowers the shell adds on top of the site:

1. **Real camera** — moment capture goes through `@capacitor/camera` instead of the WKWebView file-input (`lib/nativeCamera.ts`, wired into `components/moment/MomentCapture.tsx`). The web `capture="environment"` attribute is unreliable inside WKWebView; the native path returns a `File` shaped exactly like a file-input selection, so the rest of the moment pipeline is unchanged.
2. **Push** — device-token registration today (`lib/nativePush.ts` → `POST /api/push-tokens`), server-side delivery behind an APNs-ready seam (`lib/pushProvider.ts`, `lib/pushSender.ts`). The launch payload is the **night-signal "went live" broadcast** (`broadcastNightSignalLive()`), the only push that can send pre-identity (see §2).
3. **Home-screen presence** - a real App Store icon and a launch that opens the dedicated onboarding route once for a first-time native user (`lib/nativeFirstRun.ts`), rather than the marketing landing page built for organic web traffic. Later root launches use `/tonight`.

**What v1 deliberately is NOT:**
- **No offline rebuild.** The shell loads `https://pubmaxxing.com` live (remote-URL mode). There is no bundled copy of the product UI. A failed main-frame load uses the bundled `native/web-stub/offline.html` retry page.
- **No separate native UI.** No SwiftUI screens, no native navigation, no native map. The only Swift in the repo is the Capacitor `AppDelegate`/storyboards (`ios/App/App/`), including the APNs registration forwarding required by the push plugin. Every screen is the same server-rendered React the web serves.
- **No multi-city.** London only. Wave-2 nine-city and Wave-4 Pub Pal voice are deferred (`fable-implement-prd.md` decision 3).
- **No new product surface.** The app ships no feature the site doesn't already have; it upgrades three interaction points (camera, push, first-run) and adds an install identity.

---

## 2. Architecture as built

### 2.1 Remote-URL Capacitor shell — and why no static export

The Next.js app is **server-rendered** (App Router, API routes, per-request data). There is no `next export`. So the shell runs in **remote-URL mode**: `capacitor.config.ts` sets `server.url: "https://pubmaxxing.com"` and the WKWebView loads the live origin.

```ts
// capacitor.config.ts (#295)
const config: CapacitorConfig = {
  appId: "com.pubmaxx.app",
  appName: "PUBMAXXING",
  webDir: "native/web-stub",
  server: {
    url: "https://pubmaxxing.com",
    errorPath: "offline.html",
  },
};
```

`webDir` must point at a real directory to satisfy the CLI's copy step, but pointing it at `public/` would bake ~6 MB of datasets/screenshots into the binary as dead weight. `native/web-stub/index.html` is the placeholder and `offline.html` is the retry surface used by `server.errorPath` (`docs/CAPACITOR_WRAP.md`).

Stack: **Capacitor 8** (`@capacitor/{core,cli,ios,android}@^8.5.0`, `@capacitor/camera@^8.2.3`, `@capacitor/push-notifications@^8.1.2`), **Next 16**. Capacitor 8 uses **Swift Package Manager** (`ios/App/CapApp-SPM`) - **no CocoaPods**.

### 2.2 The seam contract (the load-bearing invariant)

**No file imports `@capacitor/*` except the `lib/native*.ts` seam modules. Everything else branches on `isNativeApp()`.**

- `lib/nativePlatform.ts` — the *only* place `window.Capacitor` is probed. `isNativeApp()` is SSR-safe (false on the server) and false on the plain web. `nativePlatform()` returns `"ios" | "android" | null`.
- `lib/nativeCamera.ts`, `lib/nativePush.ts` — dynamically `import("@capacitor/...")` **only on the native path**, so the plugin code never lands in the web bundle. Web/SSR callers get a no-op / `null` and can call unconditionally.

Consequence: the web bundle is provably unaffected by the wrap. The same deploy of pubmaxxing.com serves both the browser and the shell; the shell just injects a `window.Capacitor` bridge before page scripts run, which flips every `isNativeApp()` branch on.

### 2.3 Historical PR composition (18 July)

```
                        origin/main  (18 July snapshot)
                             │
              ┌──────────────┴───────────────┐
              │  #295 feat/capacitor-ios-wrap │  ← native STACK BASE
              │  • capacitor.config.ts (remote-URL)
              │  • lib/nativePlatform / nativeCamera / nativePush.ts
              │  • ios/ scaffold (SPM, AppDelegate + storyboards)
              │  • POST /api/push-tokens + lib/pushTokenStore.ts
              │  • migration 0039_push_tokens
              │  • public/.well-known/apple-app-site-association (TEAMID placeholder)
              │  • MomentCapture.tsx wired to native camera
              └──────────────┬───────────────┘
                 ┌───────────┴────────────┐
    #299 feat/native-first-run     #300 feat/push-senders
    (stacked on #295)              (stacked on #295)
    • lib/nativeFirstRun.ts        • lib/pushProvider.ts  (noop | apns seam)
      (landing→onboarding once)    • lib/pushSender.ts    (fan-out, prune, dedup)
    • lib/nativePushPrompt.ts      • broadcastNightSignalLive() — the launch push
    • components/native/           • notifyPlanUpdate() — DORMANT (no identity)
      NativePushPrompt.tsx
```

Two adjacent (non-stacked) prompt surfaces the shell must coordinate with:
- `#312 feat/identity-nudges` — sign-in offers after first plan action / first moment draft.
- `#313 feat/a2hs-flow` — install prompt (`lib/a2hsPrompt.ts`, `lib/promptBudget.ts`, `components/pwa/A2HSInstallPrompt.tsx`).

### 2.4 Prompt orchestration (identity > push > A2HS)

Three interruptive prompts can fire off the same plan-join tap. The intended ordering is **identity nudge first, push defers to it, A2HS lowest**. Today this is enforced by:
- **The push gate already defers structurally.** `lib/nativePushPrompt.ts` never fires at boot — iOS' permission dialog is one-shot, so it waits for the first *meaningful* plan action (join / start / confirm), shows an in-app explainer first, and only "Enable" calls `registerNativePush()`. "Later" re-offers only after the *next* qualifying action (monotonic action-sequence gate).
- **A2HS has its own proven-value gate** (`lib/a2hsPrompt.ts`: second distinct day OR one completed night) plus a per-session `lib/promptBudget.ts` (#313).

**The unifying ordering guard is implemented.** Tour, analytics consent, identity, push, web push, Cheap Pint Ping, and A2HS use the shared session budget in `lib/promptBudget.ts`. `components/plan/PlanCrew.tsx` records the identity trigger first and arms native push only when `isIdentityNudgePending()` is false. `docs/PROMPT_ORCHESTRATION.md` owns the contract.

---

## 3. Build-today path (no paid Apple account)

Goal: get PUBMAXXING booting in the iOS Simulator and on the owner's own iPhone **today**, using a **free Apple ID personal team**. No enrollment, no $99.

### 3.1 Current branch prerequisite

The July merge queue is historical. Current native release branch consolidates the Capacitor shells, first-run route, native camera, push prompt, prompt orchestration, A2HS native suppression, APNs delivery, and Android FCM delivery. Merge still waits for focused checks and native runtime proof. Paid-account capabilities and credentials remain owner gates.

### 3.2 Ordered steps

1. **Land the consolidated native branch** only after its focused checks and native runtime gates pass.
2. **Owner installs full Xcode** (App Store, not just Command Line Tools). Confirm `xcode-select -p` points at `…/Xcode.app`, not `…/CommandLineTools` — Capacitor's `cap open ios` and the SPM build both require it (`docs/CAPACITOR_WRAP.md`).
3. `npm install` — installs `@capacitor/{core,cli,ios,camera,push-notifications}`.
4. **Verify the committed camera usage strings** in `ios/App/App/Info.plist`: `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription`. These are present and must remain before camera or library access.
5. `npx cap sync ios` — refreshes plugins + `capacitor.config.ts` into `ios/`.
6. `npx cap open ios` — opens `ios/App` in Xcode.
7. **Free personal-team signing** — App target → Signing & Capabilities → uncheck nothing, select the owner's personal Apple ID as Team ("Personal Team"), confirm bundle id `com.pubmaxx.app`. Xcode auto-manages a development cert. (Personal teams cannot add the Push Notifications or Associated Domains entitlements — see expected gaps.)
8. **Run on the Simulator** — the app boots, loads pubmaxxing.com, the full THE LOCAL loop works. Camera on Simulator has no hardware; `CameraSource.Prompt` falls back to the photo library — enough to exercise the native path.
9. **Run on the owner's own iPhone** — free personal-team provisioning signs to a physically-connected device (7-day cert; re-sign weekly). Real camera works here.

### 3.3 Expected gaps at the free-account stage (all honest, all expected)

| Superpower | Free personal team | Why |
|---|---|---|
| Remote-URL shell + full site loop | ✅ works | Just a WKWebView over prod. |
| Real camera capture | ✅ works on device (Simulator falls back to library) | Only needs the Info.plist strings from step 4. |
| Home-screen icon + first-run onboarding | ✅ implemented | Local logic + assets; `lib/nativeFirstRun.ts`. Runtime proof remains required. |
| A2HS behaviour inside shell | ✅ suppressed | `detectA2hsPlatform()` treats the Capacitor shell as already installed. |
| **Push delivery** | ❌ won't deliver | APNs requires a **paid** account for the entitlement + an APNs key; `selectPushProvider("ios")` stays on the `noopPushProvider` with no keys. Registration UI can be exercised but no notification arrives. |
| **Universal links** (`/plan/*`, `/rounds/*`, `/p/*`) | ❌ won't verify | AASA carries a `TEAMID` placeholder and Associated Domains needs a real Team ID; personal teams can't validate the entitlement. |

---

## 4. Paid-account activation checklist (later)

When the owner enrolls (the longest pole, per `fable-implement-prd.md` owner queue):

1. **Enroll** in the Apple Developer Program ($99/yr). Obtain the **Team ID**.
2. **APNs Auth Key** — create an APNs key in the developer portal; note `APNS_KEY_ID` and the `.p8` private key.
3. **Server env vars** - set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`. The moment all three exist, `selectPushProvider("ios")` (`lib/pushProvider.ts`) flips from `noopPushProvider` to `apnsPushProvider` with no caller change (mirrors the `storeBackend.selectStore` seam).
4. **Verify `apnsPushProvider.send()`** - the HTTP/2 transport, ES256 provider JWT, payload mapping, invalid-token pruning, and night-signal fan-out are implemented. Live delivery still needs the owner APNs key, entitlement, signed build, and physical-device receipt proof.
5. **AASA Team ID** — replace `TEAMID` in `public/.well-known/apple-app-site-association` with the real Team ID (final appID `TEAMID.com.pubmaxx.app`), deploy, and verify `https://pubmaxxing.com/.well-known/apple-app-site-association` returns `Content-Type: application/json` (header rule in `next.config.mjs`).
6. **Xcode capabilities** — add **Push Notifications** and **Associated Domains** (`applinks:pubmaxxing.com`) to the App target.
7. **AppDelegate APNs forwarding** - verify the committed `didRegisterForRemoteNotificationsWithDeviceToken` and `didFailToRegisterForRemoteNotificationsWithError` forwarding remains connected to Capacitor. Live registration still needs the entitlement, signed build, and physical-device proof.
8. **TestFlight** — archive, upload, internal testing.
9. **Review-readiness (Apple's thin-wrapper bar).** Apple rejects apps that are "just a website." Our three superpowers are the answer, and they must be demonstrably live at review time: **real camera** capture in moments, **push** notifications (night-signal go-live), and **universal links** that deep-link `/plan`, `/rounds`, `/p` into the app. First-run onboarding, `/tonight` cold starts, and home-screen identity reinforce that this is an app, not a bookmark. Do not submit for review until push actually delivers (step 4) and universal links verify (step 5-6), or the thin-wrapper rejection is likely.

---

## 5. Risks + open decisions for Sol / owner

**Risks**

- **Remote-URL shell = app breaks if prod breaks.** A WKWebView over `pubmaxxing.com` has no offline copy. Mitigations to decide: ship an `offline.html` and a minimal service worker (the site already has `public/sw.js` for tiles) so a failed load shows a branded retry rather than a WKWebView error; consider a native launch-screen timeout → retry.
- **iOS WKWebView quirks worth a dedicated QA pass:** safe-area insets on notch devices, momentum/rubber-band scroll vs. the map's own gestures, the one-shot geolocation permission prompt (near-me), file-input vs. native-camera handoff, `100vh` keyboard behaviour, and pull-to-refresh. None are blockers; all deserve a device pass.
- **Version skew between shell and site.** The shell is a fixed binary; the site deploys continuously. A site change that assumes `window.Capacitor` semantics, or that breaks the `isNativeApp()` branches, ships to shell users instantly with no app update. Keep the seam contract (§2.2) as a review gate.
- **Push delivery still needs owner proof** (§4 step 4) - source transport exists, but APNs credentials, entitlement, signed build, and physical receipt remain required.

**Open decisions**

- **What v1.1 static-fallback could look like:** a thin bundled `webDir` (map shell + last-known cheapest-pubs rows from the slim index) that renders when `server.url` is unreachable, then hands off to the live site when connectivity returns. This reclaims graceful degradation without a native rebuild. Out of scope for v1; noted for the roadmap.

**Findings surfaced while grounding this PRD:**

- **F1 - CLOSED:** `lib/a2hsPrompt.ts` accepts the canonical native-shell result and classifies it as installed. `components/pwa/A2HSInstallPrompt.tsx` supplies that result through `isNativeAppShell()`.
- **F2 - CLOSED:** `ios/App/App/AppDelegate.swift` forwards APNs registration success and failure to the Capacitor notification names.
- **F3 - CLOSED:** `ios/App/App/Info.plist` contains camera and photo-library usage descriptions.
- **F4 - OPEN OWNER GATE:** the `ios/` tree has no `App.entitlements`. A real Team ID, Associated Domains, Push Notifications capability, and signed-device proof remain required.
- **F5 - CLOSED:** `docs/PROMPT_ORCHESTRATION.md` exists. The historical merge document remains `docs/MERGE_ORDER_2026-07-18.md`.

---

## 6. Acceptance criteria — "app v1 built"

v1 is "built" when, on the merged native cluster (§3.1 full target):

1. **Boots on Simulator and on a physical device** via free personal-team signing; the app opens and loads pubmaxxing.com in the WKWebView with no error screen.
2. **The map loop works** end-to-end inside the shell — near-me answer, map pan/tap, venue sheets, prices (the same server-rendered surfaces the web serves; `isNativeApp()` branches do not degrade them).
3. **Moment capture uses the native camera** - the moment composer's picker routes through `captureNativePhoto()` (`lib/nativeCamera.ts`) inside the shell, returns a `File`, and the existing upload pipeline is unchanged. Camera and photo-library usage strings are present. Physical-device proof remains required.
4. **First-run opens onboarding once** - a genuinely first-time native launch with no persisted city preference redirects landing to `/onboarding` exactly once (`shouldRouteNativeFirstRun`, `lib/nativeFirstRun.ts`); never over an existing city choice, never twice. Later root launches use `/tonight`.
5. **Prompts obey orchestration** - on a plan-join tap, identity nudge takes precedence, the push explainer defers to it and only arms after a qualifying action (`lib/nativePushPrompt.ts`), and no more than one interruptive prompt fires per session. Source implementation is present and owned by `docs/PROMPT_ORCHESTRATION.md`.
6. **A2HS is suppressed inside the shell** - the "Add to Home Screen" prompt never appears inside the native app. The source gate is implemented through `isNativeAppShell()` and `detectA2hsPlatform()`.

Source support for criteria 3-6 is present. Criteria 1-4 still need simulator and physical-device proof before v1 can be called built.
