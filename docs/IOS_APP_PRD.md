# PUBMAXX iPhone App — Product Requirements (v1)

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
3. **Home-screen presence** — a real App Store icon and a launch that opens straight on the map for a first-time native user (`lib/nativeFirstRun.ts`), rather than the marketing landing page built for organic web traffic.

**What v1 deliberately is NOT:**
- **No offline rebuild.** The shell loads `https://pubmaxxing.com` live (remote-URL mode). There is no bundled copy of the app. If prod is down, the app is down (mitigations in §5).
- **No separate native UI.** No SwiftUI screens, no native navigation, no native map. The only Swift in the repo is the stock Capacitor `AppDelegate`/storyboards (`ios/App/App/`). Every screen is the same server-rendered React the web serves.
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
  appName: "PUBMAXX",
  webDir: "native/web-stub",        // one-file stub — never served
  server: { url: "https://pubmaxxing.com" },
};
```

`webDir` must point at a real directory to satisfy the CLI's copy step, but pointing it at `public/` would bake ~6 MB of datasets/screenshots into the binary as dead weight, so `native/web-stub/index.html` is a one-file placeholder that is never actually served (`docs/CAPACITOR_WRAP.md`).

Stack: **Capacitor 8** (`@capacitor/{core,cli,ios}@^8.4.2`, `@capacitor/camera@^8.2.1`, `@capacitor/push-notifications@^8.1.2`), **Next 16**. Capacitor 8 uses **Swift Package Manager** (`ios/App/CapApp-SPM`) — **no CocoaPods**.

### 2.2 The seam contract (the load-bearing invariant)

**No file imports `@capacitor/*` except the `lib/native*.ts` seam modules. Everything else branches on `isNativeApp()`.**

- `lib/nativePlatform.ts` — the *only* place `window.Capacitor` is probed. `isNativeApp()` is SSR-safe (false on the server) and false on the plain web. `nativePlatform()` returns `"ios" | "android" | null`.
- `lib/nativeCamera.ts`, `lib/nativePush.ts` — dynamically `import("@capacitor/...")` **only on the native path**, so the plugin code never lands in the web bundle. Web/SSR callers get a no-op / `null` and can call unconditionally.

Consequence: the web bundle is provably unaffected by the wrap. The same deploy of pubmaxxing.com serves both the browser and the shell; the shell just injects a `window.Capacitor` bridge before page scripts run, which flips every `isNativeApp()` branch on.

### 2.3 What each PR contributes

```
                        origin/main  (no native code — clean web app)
                             │
              ┌──────────────┴───────────────┐
              │  #295 feat/capacitor-ios-wrap │  ← native STACK BASE
              │  • capacitor.config.ts (remote-URL)
              │  • lib/nativePlatform / nativeCamera / nativePush.ts
              │  • ios/ scaffold (SPM, stock AppDelegate + storyboards)
              │  • POST /api/push-tokens + lib/pushTokenStore.ts
              │  • migration 0039_push_tokens
              │  • public/.well-known/apple-app-site-association (TEAMID placeholder)
              │  • MomentCapture.tsx wired to native camera
              └──────────────┬───────────────┘
                 ┌───────────┴────────────┐
    #299 feat/native-first-run     #300 feat/push-senders
    (stacked on #295)              (stacked on #295)
    • lib/nativeFirstRun.ts        • lib/pushProvider.ts  (noop | apns seam)
      (landing→map, once ever)     • lib/pushSender.ts    (fan-out, prune, dedup)
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

**The unifying ordering guard is NOT landed yet.** `fable-implement-prd.md` Cycle-7 defines a lane `fix/prompt-orchestration` to (a) adopt `promptBudget` across tour / identity / push / A2HS so only one prompt fires per session, and (b) wire `isIdentityNudgePending()` at the `PlanCrew` anchor so push only arms `if (!isIdentityNudgePending())`. As of this writing **that branch does not exist on origin, has no PR number, and there is no `docs/PROMPT_ORCHESTRATION` contract doc in the repo** — the ordering lives only as prose in `fable-implement-prd.md` and in `MERGE_ORDER_2026-07-18.md` §(b)/(c)/(e). See §5 open decisions.

---

## 3. Build-today path (no paid Apple account)

Goal: get PUBMAXX booting in the iOS Simulator and on the owner's own iPhone **today**, using a **free Apple ID personal team**. No enrollment, no $99.

### 3.1 Merge prerequisites

Per `docs/MERGE_ORDER_2026-07-18.md`, the native stack lands **last** in the queue (step 28 `#295` → 29 `#299` → 30 `#300`), after `fix/prompt-orchestration` (step 22), `#312` (24) and `#313` (25). Two honest build targets:

- **Minimal buildable shell (today, lowest risk):** merge **`#295` only**. This gives boots-on-device + real camera + remote-URL shell + AASA scaffold. First-run routing, push prompt, and A2HS suppression are absent. Sufficient to prove the wrap works end-to-end.
- **Full v1 per the §6 acceptance criteria:** requires the native cluster **plus** its prompt neighbours — `#295`, `#299`, `#300`, `#312`, `#313`, and `fix/prompt-orchestration`. Because the native stack sits at the tail of a 30-step queue with three conflict clusters, the pragmatic path is to run the MERGE_ORDER top-to-bottom; the acceptance criteria cannot all be met from `#295` alone.

### 3.2 Ordered steps

1. **Land the prerequisite PRs** (§3.1) on `main` via `MERGE_ORDER_2026-07-18.md`. Sol executes; Fable never merges.
2. **Owner installs full Xcode** (App Store, not just Command Line Tools). Confirm `xcode-select -p` points at `…/Xcode.app`, not `…/CommandLineTools` — Capacitor's `cap open ios` and the SPM build both require it (`docs/CAPACITOR_WRAP.md`).
3. `npm install` — installs `@capacitor/{core,cli,ios,camera,push-notifications}`.
4. **Add the camera usage strings to `ios/App/App/Info.plist`** — `NSCameraUsageDescription` and `NSPhotoLibraryUsageDescription` / `NSPhotoLibraryAddUsageDescription`. **This is a build-today blocker, not a paid-account item:** `@capacitor/camera` will hard-crash the first time it accesses the camera/library without these strings, and the committed `Info.plist` does **not** contain them (see §5 finding F3). This edit needs no Apple account.
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
| Home-screen icon + first-run→map | ✅ works | Local logic + assets; `lib/nativeFirstRun.ts`. |
| A2HS behaviour inside shell | ⚠️ needs the fix in §5/F1 | Not gated on `isNativeApp()` today. |
| **Push delivery** | ❌ won't deliver | APNs requires a **paid** account for the entitlement + an APNs key; `selectPushProvider()` stays on the `noopPushProvider` with no keys. Registration UI can be exercised but no notification arrives. |
| **Universal links** (`/plan/*`, `/rounds/*`, `/p/*`) | ❌ won't verify | AASA carries a `TEAMID` placeholder and Associated Domains needs a real Team ID; personal teams can't validate the entitlement. |

---

## 4. Paid-account activation checklist (later)

When the owner enrolls (the longest pole, per `fable-implement-prd.md` owner queue):

1. **Enroll** in the Apple Developer Program ($99/yr). Obtain the **Team ID**.
2. **APNs Auth Key** — create an APNs key in the developer portal; note `APNS_KEY_ID` and the `.p8` private key.
3. **Server env vars** — set `APNS_KEY_ID`, `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`. The moment all three exist, `selectPushProvider()` (`lib/pushProvider.ts`) flips from `noopPushProvider` to `apnsPushProvider` with no caller change (mirrors the `storeBackend.selectStore` seam).
4. **Implement `apnsPushProvider.send()`** — ⚠️ it is currently a **throwing stub**, not a working sender. The HTTP/2-to-`api.push.apple.com` + per-request ES256 JWT (signed from `APNS_PRIVATE_KEY`, `apns-topic: com.pubmaxx.app`) is a *spec'd-but-unwritten* drop-in (`lib/pushProvider.ts` comment). Env keys alone do not deliver push — this transport must be built. (Interface, payload shape, invalid-token pruning, and the night-signal fan-out in `lib/pushSender.ts` are all done and waiting for it.)
5. **AASA Team ID** — replace `TEAMID` in `public/.well-known/apple-app-site-association` with the real Team ID (final appID `TEAMID.com.pubmaxx.app`), deploy, and verify `https://pubmaxxing.com/.well-known/apple-app-site-association` returns `Content-Type: application/json` (header rule in `next.config.mjs`).
6. **Xcode capabilities** — add **Push Notifications** and **Associated Domains** (`applinks:pubmaxxing.com`) to the App target.
7. **AppDelegate APNs forwarding** — ⚠️ add the `didRegisterForRemoteNotificationsWithDeviceToken` / `didFailToRegisterForRemoteNotificationsWithError` forwarding to Capacitor. The committed `ios/App/App/AppDelegate.swift` is the **stock template and does NOT include it** (see §5/F2); without it the `registration` listener in `lib/nativePush.ts` never receives a token, so no device ever registers even with APNs configured.
8. **TestFlight** — archive, upload, internal testing.
9. **Review-readiness (Apple's thin-wrapper bar).** Apple rejects apps that are "just a website." Our three superpowers are the answer, and they must be demonstrably live at review time: **real camera** capture in moments, **push** notifications (night-signal go-live), and **universal links** that deep-link `/plan`, `/rounds`, `/p` into the app. The first-run→map routing and home-screen identity reinforce that this is an app, not a bookmark. Do not submit for review until push actually delivers (step 4) and universal links verify (step 5–6), or the thin-wrapper rejection is likely.

---

## 5. Risks + open decisions for Sol / owner

**Risks**

- **Remote-URL shell = app breaks if prod breaks.** A WKWebView over `pubmaxxing.com` has no offline copy. Mitigations to decide: ship an `offline.html` and a minimal service worker (the site already has `public/sw.js` for tiles) so a failed load shows a branded retry rather than a WKWebView error; consider a native launch-screen timeout → retry.
- **iOS WKWebView quirks worth a dedicated QA pass:** safe-area insets on notch devices, momentum/rubber-band scroll vs. the map's own gestures, the one-shot geolocation permission prompt (near-me), file-input vs. native-camera handoff, `100vh` keyboard behaviour, and pull-to-refresh. None are blockers; all deserve a device pass.
- **Version skew between shell and site.** The shell is a fixed binary; the site deploys continuously. A site change that assumes `window.Capacitor` semantics, or that breaks the `isNativeApp()` branches, ships to shell users instantly with no app update. Keep the seam contract (§2.2) as a review gate.
- **Push transport is not built** (§4 step 4) — "APNs key = push works" is false; the sender is a throwing stub.

**Open decisions**

- **`fix/prompt-orchestration` is unbuilt and there is no `PROMPT_ORCHESTRATION` contract doc.** The identity > push > A2HS ordering exists only as prose. Sol/owner: land the lane (and, recommended, write the contract doc) before the native cluster merges, or the three prompts can collide on one tap (this is exactly the P1 that deep-review #321 flagged).
- **A2HS-inside-shell suppression is a required fix (F1 below), not just a QA note.**
- **What v1.1 static-fallback could look like:** a thin bundled `webDir` (map shell + last-known cheapest-pubs rows from the slim index) that renders when `server.url` is unreachable, then hands off to the live site when connectivity returns. This reclaims graceful degradation without a native rebuild. Out of scope for v1; noted for the roadmap.

**Findings surfaced while grounding this PRD** (these are real gaps in the open branches, not hypotheticals):

- **F1 — A2HS is not suppressed inside the native shell (REQUIRED FIX for §6).** `#313`'s `detectA2hsPlatform()` (`lib/a2hsPrompt.ts`) classifies purely on `display-mode: standalone` / `navigator.standalone` / UA regex, and `components/pwa/A2HSInstallPrompt.tsx` **never imports `isNativeApp()`.** In the Capacitor iOS WKWebView: `display-mode` is not `standalone`, `navigator.standalone` is `false`, and the UA (`iPhone…`, no `CriOS`/`FBAN`/`Instagram`) matches **none** of the `IN_APP_WEBVIEW` / `IOS_NON_SAFARI` suppression regexes — so it falls through to `"ios-safari"` and the app would show the "Add to Home Screen" instruction sheet **inside the already-installed native app.** Fix: treat `isNativeApp()` as a suppression, same as `standalone` (early-return in the component or a branch in `detectA2hsPlatform`). Cheap, but must land before v1.
- **F2 — `AppDelegate.swift` lacks the APNs registration forwarding.** The committed `ios/App/App/AppDelegate.swift` is the stock Capacitor template (`didFinishLaunching`, `open url`, `continue userActivity` only). It is missing `application(_:didRegisterForRemoteNotificationsWithDeviceToken:)` / `…didFailToRegisterForRemoteNotificationsWithError:` forwarding to `NotificationCenter`/Capacitor. `docs/CAPACITOR_WRAP.md` step 3 flags this conditionally ("if the template didn't include it") — it did not. Must be added when push is activated (§4 step 7) or registration silently never completes.
- **F3 — `Info.plist` has no camera/photo usage strings.** `ios/App/App/Info.plist` contains no `NSCameraUsageDescription` / `NSPhotoLibraryUsageDescription`. `@capacitor/camera` crashes on first access without them. This is a **build-today** blocker for the camera path (§3.2 step 4), independent of any Apple account.
- **F4 — Associated Domains entitlement file is absent.** The `ios/` tree has no `App.entitlements`. Beyond the AASA `TEAMID` placeholder, the Associated Domains capability itself must be added in Xcode (paid team) — noted in §4 step 6; called out here so it isn't assumed present.
- **F5 — Doc naming.** The task referenced `docs/MERGE_ORDER v2` and a `docs/PROMPT_ORCHESTRATION` contract. The actual merge doc is `docs/MERGE_ORDER_2026-07-18.md` (amended 2026-07-18 from the two deep reviews — effectively "v2"). No `PROMPT_ORCHESTRATION` doc exists anywhere in the repo (see open decisions).

---

## 6. Acceptance criteria — "app v1 built"

v1 is "built" when, on the merged native cluster (§3.1 full target):

1. **Boots on Simulator and on a physical device** via free personal-team signing; the app opens and loads pubmaxxing.com in the WKWebView with no error screen.
2. **The map loop works** end-to-end inside the shell — near-me answer, map pan/tap, venue sheets, prices (the same server-rendered surfaces the web serves; `isNativeApp()` branches do not degrade them).
3. **Moment capture uses the native camera** — the moment composer's picker routes through `captureNativePhoto()` (`lib/nativeCamera.ts`) inside the shell, returns a `File`, and the existing upload pipeline is unchanged. Requires F3 (Info.plist strings) landed.
4. **First-run routes to the map** — a genuinely first-time native launch with no persisted city preference redirects landing → `/map` exactly once (`shouldRouteNativeFirstRun`, `lib/nativeFirstRun.ts`); never over an existing city choice, never twice.
5. **Prompts obey orchestration** — on a plan-join tap, identity nudge takes precedence, the push explainer defers to it and only arms after a qualifying action (`lib/nativePushPrompt.ts`), and no more than one interruptive prompt fires per session. **Gated on `fix/prompt-orchestration` landing** (currently unbuilt — §5).
6. **A2HS is suppressed inside the shell** — the "Add to Home Screen" prompt never appears inside the native app. **⚠️ Not satisfied by the current branches** — `#313` does not check `isNativeApp()` (finding F1). **This is a required fix before v1 can pass criterion 6.**

Criteria 1–4 are met by `#295`(+F3) and `#299`. Criteria 5 and 6 each depend on an unbuilt/needed change (prompt-orchestration lane; A2HS native-guard fix) — both flagged above so Sol can schedule them into the queue before the native stack lands.
