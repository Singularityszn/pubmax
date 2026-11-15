import { semanticAskRequest } from "@/lib/ask/requestPolicy";
import type { AskToolContext } from "@/lib/ask/toolContract";
import {
  venuePricedDrinks,
  venueQuizListings,
  type RequirementContext,
  type VenueRequirement,
} from "@/lib/concierge/requirements";
import { detectWhatsOnIntent, filterRowsByWeekday } from "@/lib/concierge/whatsOn";
import { londonDayKey } from "@/lib/londonHour";
import { filterOutListings } from "@/lib/outListings";
import { loadWebsiteAmenitiesByVenue } from "@/lib/pubWebsiteAmenityEvidence.server";
import { getPricedVenues } from "@/lib/venuePriceIndex";
import type { WhatsOnRow } from "@/lib/whatsOn";
import { loadWhatsOn, type FetchLive } from "@/lib/whatsOnStore";

const NO_LIVE_LISTINGS: FetchLive = async () => ({ rows: [], sourceObservedAt: null });

async function quizListings(query: string, now: number) {
  const request = semanticAskRequest(query, false);
  const time = detectWhatsOnIntent(request);
  const { rows, readStatus } = await loadWhatsOn(
    { kind: "quiz", ...(time?.window === "tonight" ? { window: "tonight" as const } : {}) },
    { now, fetchLive: NO_LIVE_LISTINGS },
  );
  if (readStatus === "degraded") return null;
  let matching: WhatsOnRow[] = rows;
  if (time?.window === "weekday" && time.weekday !== undefined) {
    matching = filterRowsByWeekday(rows, time.weekday);
  } else if (!time?.window && /\btoday\b/i.test(request)) {
    const today = londonDayKey(now);
    matching = rows.filter((row) => {
      const start = row.startsAt ? Date.parse(row.startsAt) : Number.NaN;
      return Number.isFinite(start) ? londonDayKey(start) === today : row.startsDate === today;
    });
  } else if (!time?.window && /\bthis weekend\b/i.test(request)) {
    matching = filterOutListings(rows, "weekend", now);
  }
  return venueQuizListings(matching, now);
}

export async function requirementContext(
  requirements: readonly VenueRequirement[],
  ctx: AskToolContext,
  query: string,
): Promise<RequirementContext> {
  const now = ctx.now ?? Date.now();
  const asks = (kind: VenueRequirement["kind"]) => requirements.some((requirement) => requirement.kind === kind);
  const [quizEvidence, pricedDrinks, websiteAmenities] = await Promise.all([
    asks("quiz") ? quizListings(query, now).catch(() => null) : new Map(),
    asks("drink") && ctx.cityId === "london"
      ? getPricedVenues().then((venues) => venuePricedDrinks(venues, now), () => null)
      : asks("drink") ? null : new Map(),
    (asks("darts") || asks("pool")) && ctx.cityId === "london"
      ? loadWebsiteAmenitiesByVenue().catch(() => null)
      : asks("darts") || asks("pool") ? null : new Map(),
  ]);
  return { now, quizListings: quizEvidence, pricedDrinks, websiteAmenities };
}
