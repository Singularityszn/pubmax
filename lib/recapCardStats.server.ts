import type { RecapCardStats } from "@/lib/recapCard";

// Server-only by the `.server.ts` convention used across lib/ (e.g.
// pintIndexSnapshot.server.ts): imported only by the Node-runtime OG route.

// Single integration seam between the recap OG card (Lane 3) and the public-safe
// recap composer (Lane 2). The card route calls ONLY this function — it never
// joins the plan store or resolves crew handles itself.
//
// Lane 2 owns `lib/recapView`, which joins the published NightStory to its
// `planCompletionId` and returns a public-safe, consent-gated stats object
// (route stops, pints logged, boroughs crossed, ending, cheapest pint, and only
// crew names explicitly cleared for sharing). Until that composer lands this
// returns `null`, which is honest and safe: the card still renders the RICH
// variant (title + date) for an approved-shared recap, it just omits the stat
// furniture — and renders the brand-generic FALLBACK for anything unapproved,
// regardless of this function. Privacy never depends on stats being present.
//
// WIRE-UP (one edit, once Lane 2 pings the export name/shape):
//   import { composeRecapView } from "@/lib/recapView";
//   const view = await composeRecapView(storyId);      // already public-safe
//   return view ? { stopCount: view.stopCount, ... } : null;
// Keep the defensive shape mapping here so a composer change can't reach the
// renderer un-clamped (selectRecapCardData clamps again as belt-and-braces).

export async function recapCardStats(storyId: string): Promise<RecapCardStats | null> {
  void storyId;
  return null;
}
