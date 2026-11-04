// URL-only map arrival rules shared by the map and the root prompt budget.
// Keep map rendering, venue data and price helpers outside this module.

import { parseUkPlaceMapArrival } from "@/lib/ukPlaceSearch";
import { isUkNationalBrowse } from "@/lib/ukNationalBrowse";

// §4.5: did the page arrive with any crawl-shaping URL param (a shared/deep
// link)? If any are present the arrival is intentional and we never onboard.
// Module-level (pure) so the branch lives off PubMap's complexity budget.
// `drink=` counts (landing drink-shape taps) but is NOT a planner-open signal.
export function hasCrawlArrivalParams(search: string): boolean {
  // Intentional deep links (landmark/band/food/log/etc.) must also suppress
  // curated onboarding — not only crawl planner params (#79 follow-up).
  return /[?&](pubs|sel|style|mode|q|area|drink|cocktails|landmark|band|food|garden|max|alt|log|crawl|experience|mapNotice)=/.test(
    search,
  );
}

export type MapIntentQuery = string | { get(name: string): string | null };

export function hasMapLogIntent(query: MapIntentQuery): boolean {
  if (typeof query !== "string") return query.get("log") === "1";
  const normalized = query.startsWith("?") ? query.slice(1) : query;
  return new URLSearchParams(normalized).get("log") === "1";
}

// Trusted-handoff arrival markers not already recognised by
// hasCrawlArrivalParams: the planner deep link (plan=1), the accepted-handoff
// sentinel (accept=1), and the fixed acceptance source (src=<source>).
const TRUSTED_HANDOFF_ARRIVAL_PARAM = /[?&](plan|accept|src)=/;

/** Whether the frozen arrival search string alone marks an explicit Map arrival. */
export function searchHasExplicitMapIntent(search: string): boolean {
  return (
    hasCrawlArrivalParams(search) ||
    hasMapLogIntent(search) ||
    TRUSTED_HANDOFF_ARRIVAL_PARAM.test(search) ||
    parseUkPlaceMapArrival(search) !== null ||
    isUkNationalBrowse(search)
  );
}
