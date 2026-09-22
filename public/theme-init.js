// The decisions that have to land BEFORE FIRST PAINT, in the order they matter:
// the native shell's entry route, then the theme and view flags, then the
// landing-only aperture splash. Served as a static file (covered by CSP
// `script-src 'self'`) instead of an inline <script>, so it needs no per-build
// hash, and loads render-blocking from the layout's head on every route.
//
// Everything here is a no-flash guarantee of some kind: the page never shows
// the wrong theme, and the shell never shows a route it is about to leave. One
// file because one request: a second pre-paint script cost every web route a
// fetch for a decision only the shell uses (see the entry block below).
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
// WHAT IT DECIDES, AND WHAT IT DELIBERATELY DOES NOT. Both routing branches of
// lib/entryDecision.ts's `decideEntry` are decidable from storage alone:
//
//   - rule 4, `shell-cold-start`: the first-run mark is present, so this is an
//     ordinary later launch and it lands on /tonight.
//   - rule 2, `native-first-run`: NEITHER the first-run mark NOR a stored city
//     value exists. `shouldRouteNativeFirstRun` needs `readPreferredCity()` to
//     answer null, and with no stored value at all that answer is null under
//     every possible enabled-city table in lib/cities.ts. So this reads the
//     ABSENCE of the key and never its contents, and forks no table.
//
// The ONE case left to the client is a stored city value with the first-run
// mark absent. Whether that value counts depends on whether lib/cities.ts still
// has that city enabled, and a second copy of the city list here would be a
// second place for it to be wrong. AppEntryRoute decides that one exactly as
// before, one paint later.
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

    // Keep callback inputs for AuthProvider. Match readAuthCallbackAttempt at root.
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

    if (local.getItem("pubmax:nativeFirstRun:routed:v1") !== "1") {
      // A stored city is the one thing this file may not judge (see above).
      if (local.getItem("pubmax:preferredCity:v1") !== null) return;
      // Rule 2. The onboarding route is guarded by a session handoff, so the
      // same eligibility AppEntryRoute would have issued is issued here. Both
      // marks are stamped BEFORE navigating, exactly as that component does, so
      // a slow transition can never leave a flag unset and fire twice.
      session.setItem("pubmax:nativeFirstRun:handoff:v1", String(Date.now()));
      local.setItem("pubmax:nativeFirstRun:routed:v1", "1");
      session.setItem("pubmax:entryDecision:consumed:v1", "1");
      window.location.replace("/onboarding");
      return;
    }

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

// Aperture splash eligibility. This used to live in splash-init.js, a second
// render-blocking request on every route for a decision only the landing uses.
// It shares this pre-paint file so the overlay still never flashes and other
// routes pay no extra request.
(function () {
  try {
    if (window.location.pathname !== "/") return;
    if (window.navigator.webdriver) return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (window.sessionStorage.getItem("pubmax-splash-seen")) return;
    window.sessionStorage.setItem("pubmax-splash-seen", "1");
    document.documentElement.dataset.splash = "on";
  } catch {}
})();
