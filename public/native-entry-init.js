// The native shell's cold-start entry decision, taken BEFORE the landing page
// renders. Same reason and same pattern as theme-init.js and splash-init.js:
// served as a static file (CSP `script-src 'self'`, no per-build hash) and
// loaded as a render-blocking classic script in <head>.
//
// WHY THIS EXISTS. capacitor.config.ts is a remote-URL wrap, so every native
// launch opens the site ROOT. lib/entryDecision.ts then rewrites that to
// /tonight — but it rewrites from a React effect, which only runs after the
// landing page has been rendered, hydrated and painted. Measured inside the
// iPhone 17 Pro simulator against production on 7 September 2026: the landing
// painted at 7.9s and was replaced at 9.2s. Two costs, both paid on every
// launch:
//
//   1. The first screen of the app is a page the reader never asked for, and
//      then loses. Its hero photograph, its price card and its rails are all
//      fetched and rendered for 1.3 seconds of screen time.
//   2. Landing then Tonight is TWO routes, and reaching a second route is one
//      of the answers lib/consentAnswerMoment.ts waits for before it lets the
//      analytics consent card in. So the shell's own rewrite told the card the
//      product had answered, and the card arrived on the first screen a new
//      person ever saw — the exact thing that module exists to prevent.
//
// WHAT IT DECIDES, AND WHAT IT DELIBERATELY DOES NOT. Exactly one branch of
// lib/entryDecision.ts's `decideEntry` is decidable from storage alone: a shell
// cold start at the root AFTER the one-time native first run has already gone
// (rule 4, `shell-cold-start`). The first-run branch needs readPreferredCity(),
// whose answer depends on the enabled-city table in lib/cities.ts, and a static
// file cannot read that table. Forking it here would be a second place for the
// city list to be wrong, so the genuine first launch is left to AppEntryRoute
// exactly as before — it happens once per install, and the consent half of it
// is fixed in that component instead.
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

    // Rule 2 is not ours (see above): with the first-run mark absent this may
    // still be a genuine first launch, so leave the whole decision alone.
    if (local.getItem("pubmax:nativeFirstRun:routed:v1") !== "1") return;

    // Stamp before navigating, exactly as AppEntryRoute does, so a slow
    // transition cannot leave the flag unset and bounce the next arrival.
    session.setItem("pubmax:entryDecision:consumed:v1", "1");
    window.location.replace("/tonight");
  } catch {
    // No bridge, no storage, or a WebView that refuses one of them. The React
    // path in components/native/AppEntryRoute.tsx is still mounted and still
    // takes the same decision, one paint later.
  }
})();
