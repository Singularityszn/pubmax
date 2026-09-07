// The native shell's cold-start entry decision, taken BEFORE the landing page
// renders. Same reason and same pattern as theme-init.js and splash-init.js:
// served as a static file (CSP `script-src 'self'`, no per-build hash) and
// loaded as a render-blocking classic script in <head>.
//
// WHY THIS EXISTS. capacitor.config.ts is a remote-URL wrap, so every native
// launch opens the site ROOT. lib/entryDecision.ts then rewrites that to
// /tonight or /onboarding — but it rewrites from a React effect, which only
// runs after the landing page has been rendered, hydrated and painted. Two
// costs, both paid on every launch:
//
//   1. The first screen of the app is a page the reader never asked for, and
//      then loses. Its hero photograph, its price card and its rails are all
//      fetched and rendered for over a second of screen time.
//   2. Landing then Tonight is TWO routes, and reaching a second route is one
//      of the answers lib/consentAnswerMoment.ts waits for before it lets the
//      analytics consent card in. So the shell's own rewrite told the card the
//      product had answered, and the card arrived on the first screen a new
//      person ever saw — the exact thing that module exists to prevent.
//
// WHAT IT DECIDES, AND WHAT IT DELIBERATELY DOES NOT. Both routing branches of
// lib/entryDecision.ts's `decideEntry` are decidable from storage alone, and
// the file takes both:
//
//   · rule 4, `shell-cold-start`: the first-run mark is present, so this is an
//     ordinary later launch and it lands on /tonight.
//   · rule 2, `native-first-run`: NEITHER the first-run mark NOR a stored city
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
