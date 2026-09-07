// The decisions that have to land BEFORE FIRST PAINT, in the order they matter:
// the native shell's entry route, then the theme and the two view flags that
// ride with it. Served as a static file (covered by CSP `script-src 'self'`)
// instead of an inline <script>, so it needs no per-build hash, and loaded
// render-blocking from the layout's head on every route.
//
// Apply the theme before paint and send returning native launches to Tonight.
// One file avoids an extra request on every web route.
//
// Keep the theme half in sync with the ThemeToggle storage key ("pubmax-theme").
// ---------------------------------------------------------------------------
// THE SHELL'S ENTRY DECISION, FIRST, BEFORE ANY OF THE THEME WORK BELOW.
//
// capacitor.config.ts is a remote-URL wrap, so every native launch opens the
// site ROOT. lib/entryDecision.ts then rewrites that to /tonight or /onboarding
// from a React effect, which only runs after the landing page has been
// rendered, hydrated and painted. Two costs, both paid on every launch:
//
//   1. The first screen of the app is a page the reader never asked for, and
//      then loses. Its hero photograph, its price card and its rails are all
//      fetched and rendered for over a second of screen time.
//   2. Landing then Tonight is TWO routes, and reaching a second route is one
//      of the answers lib/consentAnswerMoment.ts waits for before it lets the
//      analytics consent card in. So the shell's own rewrite told the card the
//      product had answered, and the card arrived on the first screen a new
//      person ever saw - the exact thing that module exists to prevent.
//
// WHY IT LIVES HERE RATHER THAN IN A FILE OF ITS OWN. It shipped as
// public/native-entry-init.js and every web route paid a request for a script
// that is a no-op in every browser; the perf gate on PR 1632 measured
// /discover and /drinks at 57 requests against a budget of 56.
// public/map-first-paint-init.js is the house answer to a script only one
// surface needs, loaded by that surface's own page, but this decision has to
// land before the browser does any work on the document and a page-level script
// is already too late. This file is the one that is already render-blocking in
// the layout's head on every route, so the decision rides it and costs nothing.
//
// Only returning launches route here. AppEntryRoute owns first-run navigation
// through router.replace: proxy.ts redirects /onboarding document requests
// home, while client navigation can consume the session handoff. A hard
// redirect would spend both entry markers and return home without onboarding.
//
// __tests__/nativeShellEntry.test.ts runs THIS FILE against a window of its
// own, which is why every reference below goes through `window`.
// ---------------------------------------------------------------------------
(function () {
  try {
    var capacitor = window.Capacitor;
    if (
      !capacitor ||
      typeof capacitor.isNativePlatform !== "function" ||
      capacitor.isNativePlatform() !== true
    ) {
      return;
    }
    // Rule 1 of decideEntry: a deep link is an explicit destination and is
    // never rewritten.
    if (window.location.pathname !== "/") return;

    // AuthProvider must consume root callbacks before any entry redirect.
    // Supabase can clamp the callback destination to the site root.
    var callbackHash = new URLSearchParams((window.location.hash || "").slice(1));
    var callbackQuery = new URLSearchParams(window.location.search || "");
    if (
      callbackQuery.get("_authCallback") === "1" ||
      (callbackHash.get("access_token") && callbackHash.get("refresh_token"))
    ) return;

    var session = window.sessionStorage;
    var local = window.localStorage;
    if (!session || !local) return;

    // Rule 3: the cold-start decision has already run this session, so this is
    // an in-app tap on the wordmark and it stays on the landing page.
    if (session.getItem("pubmax:entryDecision:consumed:v1") === "1") return;

    if (local.getItem("pubmax:nativeFirstRun:routed:v1") !== "1") return;

    // Rule 4. Stamp before navigating, exactly as AppEntryRoute does, so a slow
    // transition cannot leave the flag unset and bounce the next arrival.
    session.setItem("pubmax:entryDecision:consumed:v1", "1");
    window.location.replace("/tonight");
  } catch {
    // No bridge, no storage, or a WebView that refuses one of them. The React
    // path in components/native/AppEntryRoute.tsx is still mounted and still
    // takes the same decision, one paint later.
  }
})();

// ---------------------------------------------------------------------------
// The theme, and the two view flags that ride with it.
// ---------------------------------------------------------------------------
(function () {
  try {
    var t = localStorage.getItem("pubmax-theme");
    if (t !== "light" && t !== "dark") {
      t = window.matchMedia("(prefers-color-scheme: dark)").matches
        ? "dark"
        : "light";
    }
    document.documentElement.dataset.theme = t;
  } catch {}

  // Legacy Mode: larger type / higher contrast / stronger focus rings / forced
  // reduced motion, for older and low-vision users (issue #28). Same no-flash
  // pattern as the theme above — read before paint so there is no flash of
  // small/low-contrast type before this attribute lands. Keep in sync with the
  // LegacyToggle storage key ("pubmax-legacy").
  try {
    var legacy = localStorage.getItem("pubmax-legacy");
    if (legacy === "1") {
      document.documentElement.dataset.legacy = "1";
    }
  } catch {}

  // View Mode (Lock-In / Ledger): a view layer over one data stream. Applied
  // no-flash before paint like the flags above. Ledger IS the heritage view, so
  // it also drives data-legacy (the same key/attribute as Legacy Mode) — never a
  // second accessibility flag. Default is Lock-In. Keep in sync with
  // lib/viewMode.ts (keys "pubmax-mode" / "pubmax-legacy").
  try {
    var mode = localStorage.getItem("pubmax-mode");
    if (mode !== "lock-in" && mode !== "ledger") {
      mode = localStorage.getItem("pubmax-legacy") === "1" ? "ledger" : "lock-in";
    }
    document.documentElement.dataset.mode = mode;
    if (mode === "ledger") {
      document.documentElement.dataset.legacy = "1";
    }
  } catch {}
})();
