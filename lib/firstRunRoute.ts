// Where the native shell's one-time first-run surface lives.
//
// A LEAF, importing nothing, because two very different readers need this one
// string. `lib/entryDecision.ts` re-exports it and owns the decision to send a
// first launch there; `proxy.ts` reads it to keep a plain web document request
// off the route entirely, and a middleware bundle may not drag the city tables,
// the Capacitor probe and the storage seams in behind one path.
//
// Owner-locked, issue #441.
export const ONBOARDING_PATH = "/onboarding";
