// The decisions that have to land BEFORE FIRST PAINT, in the order they matter:
// the native shell's entry route, then the theme and view flags, then the
// landing-only aperture splash. These bytes are canonical source: the root
// layout inlines them and carries its request nonce when present, while the
// static /app-entry document loads this file directly under CSP `script-src 'self'`.
//
// Everything here is a no-flash guarantee of some kind: the page never shows
// the wrong theme, and the shell never shows a route it is about to leave. One
// canonical file keeps these decisions together: a second pre-paint script
// cost every web route a fetch for a decision only the shell uses (see the
// entry block below).
//
// Keep the theme half in sync with the ThemeToggle storage key ("pubmax-theme").
// ---------------------------------------------------------------------------
// THE SHELL'S ENTRY DECISION, FIRST, BEFORE ANY OF THE THEME WORK BELOW.
//
// New binaries open the static /app-entry document, which runs this script
// without the React layout or landing assets. Older binaries open the root.
// The script also stays in the root head to decide those launches before
// hydration. The earlier React-only rewrite paid two costs on every launch:
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
// is already too late. The root layout inlines these bytes, so every web route
// keeps one render-blocking decision without another script request.
//
// Native first-run launches open onboarding. Returning launches open the
// public homepage. The installed PWA launch policy belongs to entryDecision.ts
// and is unchanged by this native-only script.
//
// A missing city or an unfinished step can establish first-run eligibility
// without duplicating the enabled-city table. At the root, a stored city with
// no completion mark is left to AppEntryRoute. The static /app-entry document
// opens the root, where that same React gate validates the stored city.
// No launch marks first-run complete or changes a stored city.
//
// __tests__/nativeShellEntry.test.ts executes these bytes before React loads.
// ---------------------------------------------------------------------------
(function () {
  var appEntry = window.location.pathname === "/app-entry";
  var routed = false;
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
    // never rewritten. /app-entry is a launch document, not a deep link.
    if (window.location.pathname !== "/" && !appEntry) return;

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
    if (!appEntry && session.getItem("pubmax:entryDecision:consumed:v1") === "1") return;

    // Earlier releases stamped the routed mark when routing STARTED. It means
    // finished only beside the tour mark those releases wrote on Skip or Plan my
    // night. Alone it is a journey that started at the first step and resumes.
    var legacyRouted = local.getItem("pubmax:nativeFirstRun:routed:v1") === "1";
    var tourSeen =
      local.getItem("pubmax-tour-v2-done") === "1" ||
      local.getItem("pubmax-tour-v1-done") === "1";
    if (local.getItem("pubmax:nativeFirstRun:done:v2") !== "1" && !(legacyRouted && tourSeen)) {
      var unfinishedStep = local.getItem("pubmax:nativeFirstRun:step:v1");
      if (unfinishedStep !== null || legacyRouted || local.getItem("pubmax:preferredCity:v1") === null) {
        // Rule 2. The onboarding route is guarded by a session handoff, so the
        // same eligibility AppEntryRoute would have issued is issued here. The
        // unfinished step is durable before navigating. Only an explicit
        // Skip or Plan my night marks the journey complete.
        session.setItem("pubmax:nativeFirstRun:handoff:v1", String(Date.now()));
        if (unfinishedStep === null) local.setItem("pubmax:nativeFirstRun:step:v1", "london");
        session.setItem("pubmax:entryDecision:consumed:v1", "1");
        routed = true;
        window.location.replace("/onboarding");
        return;
      }
      // At the root, AppEntryRoute validates a stored city. The static
      // document opens the root so the same React gate can decide.
      if (!appEntry) return;
    }

    // A returning native launch opens Home. Stamp before leaving the static
    // entry document, so the root pre-paint pass keeps that destination.
    session.setItem("pubmax:entryDecision:consumed:v1", "1");
    if (appEntry) {
      routed = true;
      window.location.replace("/");
    }
  } catch {
    // No bridge, no storage, or a WebView that refuses one of them. The React
    // path in components/native/AppEntryRoute.tsx is still mounted and still
    // takes the same decision, one paint later.
  } finally {
    // A static document has no React fallback. Let the root decide any launch
    // this script could not.
    if (appEntry && !routed) window.location.replace("/");
  }
})();

// ---------------------------------------------------------------------------
// The theme, and the two view flags that ride with it.
// ---------------------------------------------------------------------------
(function () {
  try {
    var t = localStorage.getItem("pubmax-theme");
    if (t !== "light" && t !== "dark") {
      // With no choice, London's night (21:30 to 03:59) is dark, then the OS
      // decides. The same rule and the same two numbers as
      // lib/themePreference.ts (isNightThemeTime); __tests__/themeNight.test.ts
      // runs these bytes against it.
      var night = false;
      try {
        var parts = new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/London",
          hour: "2-digit",
          minute: "2-digit",
          hourCycle: "h23",
        }).formatToParts(new Date());
        var hour = 0;
        var minute = 0;
        for (var i = 0; i < parts.length; i++) {
          if (parts[i].type === "hour") hour = Number(parts[i].value);
          if (parts[i].type === "minute") minute = Number(parts[i].value);
        }
        var minutes = hour * 60 + minute;
        night = minutes >= 21 * 60 + 30 || minutes < 4 * 60;
      } catch {}
      if (night) {
        t = "dark";
        document.documentElement.dataset.nightTheme = "1";
      } else {
        t = window.matchMedia("(prefers-color-scheme: dark)").matches
          ? "dark"
          : "light";
      }
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

// The opening prices on /map (lib/mapOpeningPreview.ts). The prerendered map
// document carries the discs its first frame will draw, and they may only show
// where that first frame is the one they were drawn for: a COLD FIRST VISIT
// (no first-pins mark, the same flag that keeps the map on its eager cell),
// at /map with no query (a query names another view), with no remembered
// opening location (which would move the camera). Decided here, before paint,
// so the preview never flashes on a visit it does not belong to. Keep the keys
// in sync with lib/performanceMarks.ts (FIRST_PINS_SEEN_KEY) and
// lib/mapOpeningLocation.ts (its STORAGE_KEY).
(function () {
  try {
    if (window.location.pathname !== "/map" || window.location.search) return;
    if (localStorage.getItem("pubmax:first-pins-seen:v1") === "1") return;
    if (localStorage.getItem("pubmax:map-opening-location:v1")) return;
    document.documentElement.dataset.mapPreview = "on";
    // The picture of the opening streets under those prices covers a screen
    // up to 440 x 960 CSS px (lib/mapOpeningSnapshot.ts,
    // MAP_OPENING_SNAPSHOT_MAX_VIEWPORT). Decided here rather than in a media
    // query, because the screen is only cut at named breakpoints.
    if (window.innerWidth <= 440 && window.innerHeight <= 960) {
      document.documentElement.dataset.mapGround = "on";
    }
  } catch {}
})();
