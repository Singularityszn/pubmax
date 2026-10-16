// Where the native shell's first-run surface lives.
//
// A LEAF, importing nothing, because two very different readers need this one
// string. `lib/entryDecision.ts` re-exports it and owns the decision to send a
// first launch there; `proxy.ts` reads it to keep a plain web document request
// off the route entirely, and a middleware bundle may not drag the city tables,
// the Capacitor probe and the storage seams in behind one path.
//
// Owner-locked, issue #441.
export const ONBOARDING_PATH = "/onboarding";

/**
 * The web's one door into the journey: the chip `/near` offers a first-time
 * visitor (components/nearme/NearOnboardingChip.tsx). The landing primary
 * answers first and never sends anybody here (owner decision 16 Oct 2026).
 */
export const WEB_ONBOARDING_START_HREF = "/onboarding?start=web";

/**
 * Whether a location search string carries the web start mark,
 * `/onboarding?start=web`. The native shell is let in by a one-time handoff
 * (lib/nativeFirstRun.ts). The web has no handoff to consume, so the /near
 * chip says so with this query. A typed or shared URL still meets proxy.ts's
 * 307 before any document renders, so the mark alone never opens the route to
 * a stranger.
 */
export function webOnboardingStartRequested(search: string): boolean {
  return new URLSearchParams(search).get("start") === "web";
}
