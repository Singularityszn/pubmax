// Capacitor iOS wrap (remote-URL mode). The Next.js app is SERVER-RENDERED —
// there is no static export, so the native shell loads the production origin
// directly rather than a bundled webDir. `webDir` must still point at a real
// directory for the CLI's copy step; a tiny stub keeps cap sync from
// baking public/'s ~6 MB of datasets into the binary as dead weight — the
// placeholder index is not served in healthy remote-URL mode, while
// offline.html is served only through server.errorPath after a main-frame
// load failure.
// See docs/CAPACITOR_WRAP.md for the full wrap runbook (signing, APNs, AASA).
import type { CapacitorConfig } from "@capacitor/cli";

import { BRAND_COLORS } from "./lib/brandMark.mjs";

/** The one origin a shipped binary ever loads. */
export const PRODUCTION_SERVER_URL = "https://pubmaxxing.com/";

/**
 * A LOCAL rig loads a local build. `PUBMAX_NATIVE_SERVER_URL` is read at
 * `npx cap sync` time only, so a developer can point the simulator at
 * `http://localhost:<port>` and the emulator at `http://10.0.2.2:<port>` to
 * review a checkout the site has not shipped yet (docs/CAPACITOR_WRAP.md,
 * "Reviewing a local build in the shells"). It reaches nothing a binary ships
 * with: the generated capacitor.config.json files are untracked, the value is
 * absent on every CI and store build, and `__tests__/nativeWrap.test.ts` holds
 * the unset case to production. `cleartext` follows the scheme rather than
 * being a second switch, because an http origin with it off is a blank
 * WebView on Android and nothing on screen says why. The origin always ends
 * in "/" because Android appends `appStartPath` to it as a plain string.
 */
export function nativeServerUrl(
  env: Record<string, string | undefined> = process.env,
): string {
  const local = env.PUBMAX_NATIVE_SERVER_URL?.trim();
  if (!local) return PRODUCTION_SERVER_URL;
  return local.endsWith("/") ? local : `${local}/`;
}

const serverUrl = nativeServerUrl();

const config: CapacitorConfig = {
  appId: "com.pubmaxx.app",
  appName: "PUBMAXXING",
  webDir: "native/web-stub",
  server: {
    url: serverUrl,
    // iOS checks sibling navigation against server.url as a URL prefix.
    // Keep that prefix at the origin and append only the initial launch path,
    // or the entry redirect opens onboarding in Safari instead of the shell.
    appStartPath: "app-entry",
    ...(serverUrl.startsWith("http://") ? { cleartext: true } : {}),
    // Remote-URL mode cannot rely on the site's service worker before the
    // first successful load. Capacitor serves this bundled page when the main
    // frame cannot reach production, so an outage is honest and retryable.
    errorPath: "offline.html",
  },
  ios: {
    // THE FIELD BEHIND THE WEBVIEW IS THE LAUNCH SCREEN'S OWN.
    //
    // Capacitor holds the WKWebView non-opaque for the whole initial load
    // (WebViewDelegationHandler), and with no colour set it hands WebKit
    // UIColor.systemBackground - WHITE in the light appearance. Measured on the
    // iPhone 17 Pro simulator against a local production build on 7 September
    // 2026: the ink launch screen ended at 1601ms, the WHOLE FRAME was a single
    // white colour from 2140ms to 4507ms, and content arrived at 5550ms. Three
    // fields in five seconds, and the middle one belongs to no design.
    //
    // The value is the same constant scripts/gen-native-app-icons.mjs cuts
    // LaunchBackground.colorset from, so the launch screen and the frame behind
    // the page are one colour and cannot drift. The launch field is
    // deliberately the same in light and dark (#523), which is why this is a
    // single value rather than a pair.
    //
    // ANDROID CARRIES NO SUCH KEY, AND NOT BECAUSE IT DOES NOT NEED ONE. It has
    // a white frame of its own, and the two obvious remedies were measured out
    // on the API 36 emulator on 7 September 2026 against a local production
    // build (docs/proof/mobile-shells-refresh/). The defect: a full-frame
    // #FFFFFF stands between the ink system splash and the page for roughly
    // 400ms, with the window's own paper bands correctly painted above and
    // below it (PR #1599, android/app/src/main/res/values*/), so the window
    // background is right and simply does not reach the WebView's rectangle.
    //
    //   RULED OUT 1 — `android.backgroundColor`. Capacitor does apply it
    //   (Bridge.java calls webView.setBackgroundColor before the first load),
    //   but that WebView is OPAQUE, unlike the WKWebView above, so whatever is
    //   drawn in the view is covered. Set to #FF00FF and captured across a
    //   whole launch: not one frame was ever magenta.
    //
    //   RULED OUT 2 — painting the canvas early from public/theme-init.js. It
    //   is render-blocking and ahead of every stylesheet, so it is the earliest
    //   the page can act, and the white frame was unchanged at 2075ms.
    //
    // What is left is the frame Android's WebView paints while it swaps
    // documents, which the entry rewrite makes every launch cross. Holding the
    // system splash until the page has painted is the remedy that fits the
    // evidence, and it is the SplashScreen block under `plugins` below: the
    // plugin holds the Android 12+ system splash until lib/nativeSplash.ts
    // hides it on first paint, or the ceiling does.
    backgroundColor: BRAND_COLORS.inkDeep,
  },
  // THE EDGE CAN TELL THE APP FROM A STRANGER. The WKWebView's own user agent
  // is a plain iPhone WebKit string, so no firewall or bot rule can exempt the
  // shell without exempting every iPhone. This token is the stable key a rule
  // matches on (docs/CAPACITOR_WRAP.md, "Cold start").
  appendUserAgent: "PUBMAXXING-App",
  plugins: {
    // THE LAUNCH MARK STAYS UP UNTIL THE PAGE HAS PAINTED. Measured on the
    // pubmaxx-390x844 simulator on 13 September 2026, a clean install against
    // production: the first document committed 21.5s after launch and every
    // frame before it was the bare ink field, because nothing native held the
    // mark. Auto-hide stays ON because it is the ceiling (12s, the same figure
    // as NATIVE_SPLASH_CEILING_MS in lib/nativeSplash.ts, which the CLI cannot
    // import); lib/nativeSplash.ts hides it sooner, on first paint, and the
    // bundled offline page releases it at once (docs/CAPACITOR_WRAP.md, "Cold
    // start").
    SplashScreen: {
      launchAutoHide: true,
      launchShowDuration: 12_000,
      backgroundColor: BRAND_COLORS.inkDeep,
      showSpinner: false,
    },
    // Capacitor 8 bundles SystemBars in core. CSS inset injection covers older
    // Android WebViews; the runtime seam mirrors the site's light/dark choice.
    SystemBars: {
      hidden: false,
      style: "DEFAULT",
      insetsHandling: "css",
    },
  },
};

export default config;
