import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { areaCircleForAsk } from "@/lib/concierge/areaCircle";
import { parseConciergeIntent } from "@/lib/concierge/intent";
import { rankConciergeVenues, type ConciergeVenue } from "@/lib/concierge/rank";
import { buildWhatsOnAnswer, detectWhatsOnIntent } from "@/lib/concierge/whatsOn";
import { refineRoutedAskQuery } from "@/lib/ask/router";
import { matchVenueByNameKeyless } from "@/lib/ask/venueResolution";
import { filterRowsByArea, filterRowsByWeekday } from "@/lib/concierge/whatsOn";
import { loadWhatsOn } from "@/lib/whatsOnStore";
import {
  rankBoroughCheapest,
  rankNearMe,
  type PricedPoint,
} from "@/lib/nearMeAnswer";

import type { PalEvalAnswerExpectations, PalEvalPublicCase } from "./types";
import { offlineFetch } from "./offlineFetch";

/** Routing constraints are hand-maintained; data-derived fields are computed below. */
const PAL_EVAL_ROUTING: Record<string, Partial<PalEvalAnswerExpectations>> = {
  "cheapest-camden": { expectedTools: ["cheapest_pint_near"] },
  "quiz-camden": { expectedTools: ["whats_on"], answerIncludes: ["quiz"] },
  "quiz-islington": { expectedTools: ["whats_on"], answerIncludes: ["quiz"] },
  "manchester-outscope": { expectedTools: ["search_venues"] },
  "paris-outscope": { expectedTools: ["search_venues"] },
  "cheapest-near-lamb": { expectedTools: ["cheapest_pint_near"] },
  "venue-drinks-lamb": { expectedTools: ["venue_drinks"] },
  "quiet-bank": { expectedTools: ["search_venues"] },
  "plan-soho": { expectedTools: ["propose_plan"], answerIncludes: ["Plan"] },
  "tube-delays": { expectedTools: ["city_status"] },
  "find-desk-angel": { expectedTools: ["find_desk"] },
  "tonight-soho": { expectedTools: ["tonight_now"] },
  "cheapest-no-anchor": { expectedTools: ["venue_prices"], answerIncludes: ["listed pub"] },
  "heritage-lamb": { expectedTools: ["venue_heritage"], answerIncludes: ["won"] },
  "map-open-lamb": { expectedTools: ["propose_map_action"] },
  "area-buzz-camden": { expectedTools: ["area_buzz", "venue_prices"] },
  "hampstead-quiet": { expectedTools: ["search_venues"] },
  "food-midnight-covent": { expectedTools: ["search_venues"] },
  "wine-lamb-honest": { expectedTools: ["venue_prices"], answerIncludes: ["listed pub"] },
  "dearest-soho-honest": { expectedTools: ["venue_prices"], answerIncludes: ["listed pub"] },
  "report-crowd-lamb": { expectedTools: ["report_occupancy"] },
  "journey-lamb": { expectedTools: ["journey"] },
  "football-whats-on": { expectedTools: ["whats_on"] },
  "no-seats-lamb": { expectedTools: ["report_occupancy"] },
  "followup-cheaper-camden": { expectedTools: ["search_venues"] },
  "desk-then-cheapest": { expectedTools: ["cheapest_pint_near"] },
  "non-alcoholic-soho": { expectedTools: ["search_venues"] },
  "heritage-bank": { expectedTools: ["venue_heritage"] },
  "open-map-bank": { expectedTools: ["propose_map_action"] },
  "crawl-refine-cheaper": {
    anyTools: ["search_venues", "cheapest_pint_near", "propose_plan"],
  },
};

export type ResolveAnswerKeyContext = {
  now: number;
  cityId: string;
};

function toPricedPoints(venues: readonly ConciergeVenue[]): PricedPoint[] {
  return venues
    .filter((v) => v.cheapestPrice != null && Number.isFinite(v.cheapestPrice))
    .map((v) => ({
      id: v.id,
      name: v.name,
      borough: v.area,
      lat: v.lat,
      lng: v.lng,
      cheapestPrice: v.cheapestPrice as number,
    }));
}

function cardFields(
  venueId: string | undefined,
  price: number | null | undefined,
): Partial<PalEvalAnswerExpectations> {
  if (!venueId) return { expectEmpty: true };
  const out: Partial<PalEvalAnswerExpectations> = { minCards: 1, topVenueId: venueId };
  if (price != null && Number.isFinite(price)) out.topPrice = price;
  return out;
}

async function firstSearchVenue(
  query: string,
  cityId: string,
): Promise<{ venueId: string; price: number | null } | null> {
  const venues = await loadConciergeVenues(cityId as "london");
  const parsed = await parseConciergeIntent(query, { skipModel: true });
  const ranked = rankConciergeVenues(venues, parsed.intent, {
    limit: 1,
    areaCircle: areaCircleForAsk(cityId as "london", parsed.intent.area),
  });
  const venue = ranked[0]?.venue;
  if (!venue) return null;
  return { venueId: venue.id, price: venue.cheapestPrice };
}

async function cheapestInBorough(
  borough: string,
  cityId: string,
): Promise<{ venueId: string; price: number } | null> {
  const venues = await loadConciergeVenues(cityId as "london");
  const row = rankBoroughCheapest(toPricedPoints(venues), borough, 1)[0];
  if (!row) return null;
  return { venueId: row.id, price: row.cheapestPrice };
}

async function cheapestNearVenueName(
  venueName: string,
  cityId: string,
): Promise<{ venueId: string; price: number } | null> {
  const venues = await loadConciergeVenues(cityId as "london");
  const anchor = matchVenueByNameKeyless(venues, venueName);
  if (!anchor) return null;
  const points = toPricedPoints(venues);
  const answer = rankNearMe(anchor.lat, anchor.lng, points, { maxAnswers: 5 });
  const row = answer.cards.find((card) => card.id !== anchor.id);
  if (!row) return null;
  return { venueId: row.id, price: row.cheapestPrice };
}

async function firstWhatsOnCard(
  query: string,
  now: number,
): Promise<{ venueId: string; price: number | null } | { minCards: number } | null> {
  const detected = detectWhatsOnIntent(query);
  if (!detected) return null;
  const { rows, readStatus } = await loadWhatsOn(
    {
      ...(detected.kind ? { kind: detected.kind } : {}),
      ...(detected.window === "tonight" ? { window: "tonight" as const } : {}),
    },
    { now, fetchImpl: offlineFetch },
  );
  if (readStatus === "degraded") return null;
  let matched = detected.area ? filterRowsByArea(rows, detected.area) : rows;
  if (detected.window === "weekday" && detected.weekday !== undefined) {
    matched = filterRowsByWeekday(matched, detected.weekday);
  }
  const answer = buildWhatsOnAnswer(detected, matched);
  const item = answer.listings[0];
  if (!item) return null;
  let venueId = item.venueId;
  if (!venueId && item.venue) {
    const venues = await loadConciergeVenues("london");
    const name = item.venue.split(",")[0]?.trim() ?? item.venue;
    venueId = matchVenueByNameKeyless(venues, name)?.id;
  }
  if (!venueId) return { minCards: 1 };
  return {
    venueId,
    price: typeof item.priceGbp === "number" ? item.priceGbp : null,
  };
}

async function whatsOnFields(
  query: string,
  now: number,
): Promise<Partial<PalEvalAnswerExpectations>> {
  const hit = await firstWhatsOnCard(query, now);
  if (!hit) return { expectEmpty: true };
  if ("venueId" in hit) {
    return cardFields(hit.venueId, hit.price);
  }
  return hit;
}

/** Data-derived fields for answer-key.json. Does not call runAsk or runAskTool. */
async function resolveGeneratedAnswerKeyFields(
  caseDef: PalEvalPublicCase,
  ctx: ResolveAnswerKeyContext,
): Promise<Partial<PalEvalAnswerExpectations>> {
  const cityId = caseDef.cityId ?? "london";
  // A short follow-up ("cheaper") is asked in the place of the prior user turn,
  // exactly as runAsk refines it, so multi-turn cases resolve the same question.
  const priorUser = [...(caseDef.turns ?? [])].reverse().find((turn) => turn.role === "user");
  const query = refineRoutedAskQuery(caseDef.query, priorUser?.content);

  switch (caseDef.id) {
    case "cheapest-camden":
    case "desk-then-cheapest": {
      const hit = await cheapestInBorough("Camden", cityId);
      return hit ? cardFields(hit.venueId, hit.price) : { expectEmpty: true };
    }
    case "cheapest-near-lamb": {
      const hit = await cheapestNearVenueName("The Lamb", cityId);
      return hit ? cardFields(hit.venueId, hit.price) : { expectEmpty: true };
    }
    case "venue-drinks-lamb": {
      const venues = await loadConciergeVenues(cityId as "london");
      const venue = matchVenueByNameKeyless(venues, "The Lamb");
      return venue ? cardFields(venue.id, venue.cheapestPrice) : { expectEmpty: true };
    }
    case "quiz-camden":
    case "quiz-islington":
    case "football-whats-on":
      return whatsOnFields(query, ctx.now);
    case "manchester-outscope":
    case "paris-outscope":
    case "cheapest-no-anchor":
    case "wine-lamb-honest":
    case "dearest-soho-honest":
    case "find-desk-angel":
    case "map-open-lamb":
    case "open-map-bank":
    case "report-crowd-lamb":
    case "no-seats-lamb":
    case "journey-lamb":
      return { expectEmpty: true };
    case "tube-delays":
      return { expectEmpty: true, expectDegraded: true };
    case "area-buzz-camden":
      return { minCards: 1, expectDegraded: true };
    case "tonight-soho":
      return { minCards: 1 };
    case "heritage-lamb":
    case "heritage-bank":
      return { minCards: 1 };
    case "quiet-bank":
    case "hampstead-quiet":
    case "food-midnight-covent":
    case "non-alcoholic-soho":
    case "plan-soho":
    case "followup-cheaper-camden":
    case "crawl-refine-cheaper": {
      const hit = await firstSearchVenue(query, cityId);
      return hit ? cardFields(hit.venueId, hit.price) : { expectEmpty: true };
    }
    default:
      return {};
  }
}

export async function resolveFullAnswerKeyEntry(
  caseDef: PalEvalPublicCase,
  ctx: ResolveAnswerKeyContext,
): Promise<PalEvalAnswerExpectations> {
  const routing = PAL_EVAL_ROUTING[caseDef.id] ?? {};
  const generated = await resolveGeneratedAnswerKeyFields(caseDef, ctx);
  return { ...generated, ...routing };
}
