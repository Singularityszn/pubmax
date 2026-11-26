import "server-only";

import { canonicalBundledVenueId } from "@/lib/bundledVenueAliases";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { comparablePint, isComparablePintServing } from "@/lib/comparablePint.mjs";
import { rankConciergeVenues } from "@/lib/concierge/rank";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { tryGetNightArea } from "@/lib/nightAreas";
import { planAreaContains } from "@/lib/planAreaHours";
import { listedPriceExpiresAt } from "@/lib/priceTier";
import { PLAN_SHORTLIST_MOODS, type ShortlistOption } from "@/lib/planShortlist";
import { lookupVenueDetail } from "@/lib/venueDetailIndex";
import { isPublicRankablePub } from "@/lib/venueKindFilters";
import { venueListedPint } from "@/lib/venueListedPint";

type ShortlistFilters = {
  area: NonNullable<ReturnType<typeof tryGetNightArea>>;
  mood: (typeof PLAN_SHORTLIST_MOODS)[number];
  pintLimit: number | null;
  anchor: string | null;
};

export function shortlistFilters(values: URLSearchParams): ShortlistFilters | null {
  const area = tryGetNightArea(values.get("area"));
  if (!area || area.cityId !== DEFAULT_CITY_ID) return null;
  const mood = PLAN_SHORTLIST_MOODS.find((value) => value === values.get("mood")) ?? "balanced";
  const price = values.get("pintLimit");
  const pintLimit = price ? Number(price) : null;
  if (pintLimit !== null && (!/^\d+(?:\.\d{1,2})?$/.test(price!) || pintLimit <= 0 || pintLimit > 100)) return null;
  const anchor = values.get("anchor");
  return { area, mood, pintLimit, anchor: anchor && anchor.length <= 120 ? canonicalBundledVenueId(anchor) : null };
}

export async function shortlistCandidates({ area, mood, pintLimit, anchor }: ShortlistFilters): Promise<ShortlistOption[]> {
  const now = Date.now();
  const venues = (await loadConciergeVenues(DEFAULT_CITY_ID, now)).filter((venue) => !venue.promoted && isPublicRankablePub(venue));
  const pinned = venues.find((venue) => venue.id === anchor);
  const local = venues.filter((venue) => planAreaContains(area, venue) && venue.id !== pinned?.id);
  const rank = (pool: typeof venues) => rankConciergeVenues(pool, {
    mood: [mood], groupSize: 1, ...(pintLimit === null ? {} : { maxPintPrice: pintLimit }),
  }, { limit: 6, now });
  const ranked = [...(pinned ? rank([pinned]) : []), ...rank(local)].slice(0, 6);

  return Promise.all(ranked.map(async ({ venue, reasons }) => {
    const detail = await lookupVenueDetail(venue.id);
    const price = detail.status === "found" ? venueListedPint(detail.venue) : null;
    const latestListing = listedPriceExpiresAt(price?.observedOn);
    const listedPint = price?.publisher && latestListing !== null && latestListing >= now
      && price.priceGbp === comparablePint(venue, now) && price.observedOn === venue.priceObservedAt?.slice(0, 10)
      && isComparablePintServing({ cheapestPint: price.pintName ?? undefined }) ? price : null;
    return {
      venueId: venue.id,
      venueName: venue.name,
      lat: venue.lat,
      lng: venue.lng,
      listedPint,
      reasons: [
        venue.id === pinned?.id ? "Starting pub" : `In the ${area.name} search area`,
        ...reasons.filter((reason) => !reason.includes("within budget")),
        ...(pintLimit === null ? [] : [
          !listedPint ? "No current listed pint to check against the limit"
            : listedPint.priceGbp <= pintLimit ? "Listed pint meets the per-pint limit"
            : "Listed pint exceeds the per-pint limit",
        ]),
      ],
    };
  }));
}
