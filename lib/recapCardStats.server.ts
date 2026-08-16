import "server-only";

import type { RecapCardStats } from "@/lib/recapCard";

// Server-only by the `.server.ts` convention used across lib/ (e.g.
// pintIndexSnapshot.server.ts): imported only by the Node-runtime OG route.

// Single integration seam between the recap OG card (Lane 3) and the public-safe
// recap composer (Lane 2). The card route calls ONLY this function — it never
// joins the plan store or resolves crew handles itself.
//
// Lane 2 owns the pure public composer `lib/recapView.ts` (on feat/recap-page).
// It stays null-safe: `composeRecapFromPublishedStory` returns null unless the
// story is published + not-private, and it reads only published+approved
// moments. Ownership split agreed with Lane 2:
//   • Lane 2 sources stopCount / pintCount / cheapest price / (route stops).
//   • Lane 3 (here) sources boroughsCrossed (geo) and crew (consent) — those
//     joins live on our side; Lane 2 deliberately never touches crew.
//   • ending is NULL on the public path by design (it lives on the plan
//     completion, which the public story does not join). RecapCardStats.ending
//     is nullable and the card hides the ending tile when absent.
//
// Until feat/recap-page merges into this branch, importing lib/recapView.ts /
// getPublishedRecapSource would not compile here, so this returns null — honest
// and safe: an approved recap still renders RICH (title + date); an unapproved
// one still renders the brand-generic FALLBACK. Privacy never depends on stats.
//
// WIRE-UP (drop-in once the branches merge — Lane 2 confirmed these exports):
//
//   import { getPublishedRecapSource } from "@/lib/nightMemoryStore"; // read-only,
//     // enforces published + !private + publishedMomentIds — the ONE shared
//     // privacy choke point (reuse it; do not add a second gate).
//   import { composeRecapFromPublishedStory } from "@/lib/recapView";
//
//   const src = await getPublishedRecapSource(storyId);
//   if (!src) return null;
//   const view = composeRecapFromPublishedStory({
//     story: src.story, moments: src.moments, pintDropsById, venueNames,
//   });
//   if (!view) return null;
//   return {
//     stopCount: view.stats.stopCount,
//     pintsLogged: view.stats.pintCount,
//     cheapestPintGbp: view.stats.cheapestPintGbp, // Lane 2 adding a numeric field
//                                                  // so we skip parsing priceLabel
//     ending: view.ending?.kind ?? null,           // null on the public path
//     boroughsCrossed: boroughsFrom(src.moments),  // our geo join (venueIndex)
//     crew: consentClearedCrew(src),               // our consent join — public only
//     nightDateIso: view.completedAt ?? src.story.publishedAt,
//   };
//
// Keep the mapping defensive here; selectRecapCardData clamps again downstream.

export async function recapCardStats(storyId: string): Promise<RecapCardStats | null> {
  void storyId;
  return null;
}
