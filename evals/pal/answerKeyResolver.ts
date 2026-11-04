import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { VENUE_ALIAS_FILES } from "@/lib/venueAliasesFile.mjs";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import { loadPalEvalVenueIndex } from "./venueIndex";
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
  "heritage-lamb": { expectedTools: ["venue_heritage"] },
  "map-open-lamb": { expectedTools: ["propose_map_action"] },
  "area-buzz-camden": { expectedTools: ["area_buzz", "venue_prices"] },
  "hampstead-quiet": { expectedTools: ["search_venues"] },
  "food-midnight-covent": { expectedTools: ["search_venues"] },
  "wine-lamb-honest": { expectedTools: ["venue_drinks"], answerIncludes: ["No people-logged wine prices recorded", "The Lamb"] },
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

const LAMB_CASE = { id: "heritage-lamb", query: "Tell me the heritage of The Lamb", cityId: "london" };
const LAMB_NOW = Date.parse("2026-07-21T18:00:00.000Z");
const LAMB_CLARIFICATION = "I cannot tell which pub you mean. Choose the pub on the map, then ask about its history.";

export type HeritageAmbiguityEvidence = {
  lambCandidates: Array<{ id: string; name: string; lat: number; lng: number; searchNames: string[]; eligible: boolean }>;
  lambAliasEdges: Array<[source: string, from: string, to: string]>;
  lambClusters: Array<{ source: string; canonicalId: string; canonicalName: string; members: Array<{ id: string; name: string }> }>;
};

const LAMB_IDENTITIES: HeritageAmbiguityEvidence["lambCandidates"] = [
  { id: "venue-1yd70c7", name: "The Lamb", lat: 51.5231, lng: -0.119017, searchNames: ["The Lamb"], eligible: true },
  { id: "venue-46mqmt", name: "The Lamb", lat: 51.3920141, lng: -0.3114144, searchNames: ["The Lamb"], eligible: true },
  { id: "venue-kuml9r", name: "The Lamb", lat: 51.5353993, lng: 0.0215447, searchNames: ["The Lamb"], eligible: true },
  { id: "venue-o3sr33", name: "The Lamb", lat: 51.6254907, lng: -0.0636229, searchNames: ["The Lamb"], eligible: true },
  { id: "venue-uov7ku", name: "The Lamb", lat: 51.5487, lng: -0.106981, searchNames: ["The Lamb"], eligible: true },
];

/** Read the name identities and canonical connectivity relevant to the unqualified Lamb case. */
export function loadHeritageAmbiguityEvidence(root = process.cwd()): HeritageAmbiguityEvidence {
  const read = (file: string) => JSON.parse(readFileSync(join(root, file), "utf8"));
  const rows = rowsFromSlimPayload(read("public/data/venues_slim.json")) as Array<{
    id: string; name: string; lat: number; lng: number; kind?: unknown; borough?: unknown; cheapestPrice?: unknown;
  }> | null;
  if (!rows) throw new Error("Authored policy evidence needs venue rows.");
  const index = loadPalEvalVenueIndex(root);
  // Independent spelling normalization implements the documented name contract,
  // without invoking the production matcher or ranking candidates.
  const lambName = (name: string) => name.toLowerCase().replace(/&/g, " and ")
    .replace(/['\u2019\u2018]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().replace(/^the\s+/, "") === "lamb";
  const lambCandidates = rows.filter((row) => (index.namesById.get(row.id) ?? []).some(lambName))
    .map((row) => ({ id: row.id, name: row.name, lat: row.lat, lng: row.lng,
      searchNames: [...(index.namesById.get(row.id) ?? [])].sort(),
      // Independently bind admission validity, not incidental price amounts.
      eligible: typeof row.id === "string" && row.id.length > 0
        && typeof row.name === "string" && row.name.length > 0
        && (row.kind === undefined || row.kind === "pub")
        && typeof row.borough === "string"
        && typeof row.lat === "number" && Number.isFinite(row.lat)
        && typeof row.lng === "number" && Number.isFinite(row.lng)
        && (row.cheapestPrice === null || (typeof row.cheapestPrice === "number" && Number.isFinite(row.cheapestPrice))),
    }))
    .sort((a, b) => a.id.localeCompare(b.id));
  const ids = new Set([...LAMB_IDENTITIES, ...lambCandidates].map((row) => row.id));
  const aliasDocs = VENUE_ALIAS_FILES.map((source) => ({ source, doc: read(source) as {
    aliases: Record<string, unknown>;
    clusters?: Array<{ canonicalId: string; canonicalName: string; mergedFrom: Array<{ id: string; name: string }> }>;
  } }));
  // Independently mirror admission and source order, then retain the connected
  // component of the relevant IDs. Do not call the production resolver/flattener.
  const effective = new Map<string, { source: string; to: string }>();
  for (const { source, doc } of aliasDocs) {
    if (source === VENUE_ALIAS_FILES[0] && !Array.isArray(doc.clusters)) {
      throw new Error(`Authored policy cluster evidence unavailable: ${source}`);
    }
    if (!doc.aliases || typeof doc.aliases !== "object" || Array.isArray(doc.aliases)) {
      throw new Error(`Authored policy alias evidence unavailable: ${source}`);
    }
    for (const [from, to] of Object.entries(doc.aliases)) {
      if (typeof to === "string" && to && from !== to) effective.set(from, { source, to });
    }
  }
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const [from, { to }] of effective) {
      if (ids.has(from) || ids.has(to)) {
        if (!ids.has(from) || !ids.has(to)) expanded = true;
        ids.add(from);
        ids.add(to);
      }
    }
  }
  const lambAliasEdges: HeritageAmbiguityEvidence["lambAliasEdges"] = [...effective]
    .filter(([from, { to }]) => ids.has(from) || ids.has(to))
    .map(([from, { source, to }]): [string, string, string] => [source, from, to])
    .sort((a, b) => a.join("\0").localeCompare(b.join("\0")));
  const lambClusters = aliasDocs.flatMap(({ source, doc }) => (doc.clusters ?? [])
    .filter((cluster) => ids.has(cluster.canonicalId) || lambName(cluster.canonicalName)
      || cluster.mergedFrom.some((member) => ids.has(member.id) || lambName(member.name)))
    .map((cluster) => ({ source, canonicalId: cluster.canonicalId, canonicalName: cluster.canonicalName,
      members: cluster.mergedFrom.map(({ id, name }) => ({ id, name })).sort((a, b) => a.id.localeCompare(b.id)) })))
    .sort((a, b) => `${a.source}\0${a.canonicalId}`.localeCompare(`${b.source}\0${b.canonicalId}`));
  return { lambCandidates, lambAliasEdges, lambClusters };
}

/** This authored ambiguity applies only to the unchanged, unqualified public input. */
export function resolveHeritageAmbiguityExpectation(
  caseDef: PalEvalPublicCase,
  ctx: ResolveAnswerKeyContext,
  evidence?: HeritageAmbiguityEvidence,
): PalEvalAnswerExpectations | null {
  if (caseDef.id !== LAMB_CASE.id) return null;
  if (!isDeepStrictEqual(caseDef, LAMB_CASE)
    || !isDeepStrictEqual(ctx, { now: LAMB_NOW, cityId: "london" })) {
    throw new Error("Heritage ambiguity input changed; review required.");
  }
  const current = evidence ?? loadHeritageAmbiguityEvidence();
  if (!isDeepStrictEqual(current.lambCandidates, LAMB_IDENTITIES)
    || current.lambAliasEdges.length !== 0 || current.lambClusters.length !== 0) {
    throw new Error("Heritage ambiguity evidence changed; review required.");
  }
  return {
    expectEmpty: true,
    answerIncludes: [LAMB_CLARIFICATION],
    honestTerminal: { answer: LAMB_CLARIFICATION, tool: "venue_heritage" },
    expectedTools: ["venue_heritage"],
  };
}

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
      priceSource: v.priceSource,
      priceObservedAt: v.priceObservedAt,
      anchorLabel: v.anchorLabel,
      cheapestPint: v.cheapestPint,
      measure: v.measure,
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
  now: number,
): Promise<{ venueId: string; price: number | null } | null> {
  const venues = await loadConciergeVenues(cityId as "london");
  const parsed = await parseConciergeIntent(query, { skipModel: true });
  const ranked = rankConciergeVenues(venues, parsed.intent, {
    limit: 1,
    now,
    areaCircle: areaCircleForAsk(cityId as "london", parsed.intent.area),
  });
  const venue = ranked[0]?.venue;
  if (!venue) return null;
  return { venueId: venue.id, price: venue.cheapestPrice };
}

async function cheapestInBorough(
  borough: string,
  cityId: string,
  now: number,
): Promise<{ venueId: string; price: number } | null> {
  const venues = await loadConciergeVenues(cityId as "london");
  const row = rankBoroughCheapest(toPricedPoints(venues), borough, 1, now)[0];
  if (!row) return null;
  return { venueId: row.id, price: row.cheapestPrice };
}

async function cheapestNearVenueName(
  venueName: string,
  cityId: string,
  now: number,
): Promise<{ venueId: string; price: number } | null> {
  const venues = await loadConciergeVenues(cityId as "london");
  const anchor = matchVenueByNameKeyless(venues, venueName);
  if (!anchor) return null;
  const points = toPricedPoints(venues);
  const answer = rankNearMe(anchor.lat, anchor.lng, points, { maxAnswers: 5, now });
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

function staticAnswerKeyFields(caseId: string): Partial<PalEvalAnswerExpectations> | null {
  switch (caseId) {
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
    case "heritage-bank":
      return { minCards: 1 };
    default:
      return null;
  }
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
  const staticFields = staticAnswerKeyFields(caseDef.id);
  if (staticFields) return staticFields;

  switch (caseDef.id) {
    case "cheapest-camden":
    case "desk-then-cheapest": {
      const hit = await cheapestInBorough("Camden", cityId, ctx.now);
      return hit ? cardFields(hit.venueId, hit.price) : { expectEmpty: true };
    }
    case "cheapest-near-lamb": {
      const hit = await cheapestNearVenueName("The Lamb", cityId, ctx.now);
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
    case "quiet-bank":
    case "hampstead-quiet":
    case "food-midnight-covent":
    case "non-alcoholic-soho":
    case "plan-soho":
    case "followup-cheaper-camden":
    case "crawl-refine-cheaper": {
      const hit = await firstSearchVenue(query, cityId, ctx.now);
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
  const ambiguity = resolveHeritageAmbiguityExpectation(caseDef, ctx);
  if (ambiguity) return ambiguity;
  const routing = PAL_EVAL_ROUTING[caseDef.id] ?? {};
  const generated = await resolveGeneratedAnswerKeyFields(caseDef, ctx);
  return { ...generated, ...routing };
}
