// Venue name resolution for Ask tools (TypeSafe item 6).
//
// Code finds token-sharing candidates; Jev picks the intended pub, or none.
// Keyless fallback is today's exact / startsWith / includes matcher.
// Thresholds: __tests__/fixtures/typesafe/venue-resolution-probabilities.json

import { choice } from "@typesafe-ai/sdk";

import stationZones from "@/data/tfl_station_zones.json";
import { NIGHT_AREAS } from "@/lib/nightAreas";
import localityGazetteer from "@/public/data/london_localities.json";

import {
  normalizeVenueIdentityName,
  significantNameTokens,
} from "../../scripts/lib/venueCanonicalization.mjs";

export const VENUE_RESOLUTION_CANDIDATE_LIMIT = 12;

export const NONE_OPTION = "none";

/** Publish only at or above this; from venue-resolution-probabilities.json */
export const INTENDED_VENUE_FLOOR = 0.55;

export type VenueNameMatchInput = {
  id: string;
  name: string;
  area: string;
  searchText?: string;
};

export type VenueResolutionCandidate = {
  name: string;
  area: string;
  address: string;
};

function candidateOptionKey(index: number): string {
  return `c${index}`;
}

function venueResolutionAddress(venue: VenueNameMatchInput): string {
  const text = venue.searchText?.trim();
  if (!text) return venue.area;
  const name = venue.name.trim().toLowerCase();
  let rest = text;
  if (rest.toLowerCase().startsWith(name)) {
    rest = rest.slice(name.length).trim();
  }
  const cut = rest.split(",")[0]?.trim() ?? rest;
  return cut || venue.area;
}

export function toVenueResolutionCandidate(
  venue: VenueNameMatchInput,
): VenueResolutionCandidate {
  return {
    name: venue.name,
    area: venue.area,
    address: venueResolutionAddress(venue),
  };
}

/** Lower-case words only: "&" reads as "and", apostrophes drop, other marks split. */
function wordsOnly(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['\u2019\u2018]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Place names of two or more words: night areas, London localities, TfL stations. */
const PLACE_PHRASES: readonly string[][] = [
  ...new Set(
    [
      ...NIGHT_AREAS.flatMap((area) => [area.name, ...area.aliases, ...area.transportAnchors]),
      ...localityGazetteer.localities.map((locality) => locality.name),
      ...stationZones.stations.map((station) => station.name),
    ].map(wordsOnly),
  ),
]
  .map((phrase) => phrase.split(" "))
  .filter((words) => words.length > 1);

/** Every index where `phrase` starts as whole words inside `words`. */
function startsOf(words: readonly string[], phrase: readonly string[]): number[] {
  const starts: number[] = [];
  for (let at = 0; at + phrase.length <= words.length; at++) {
    if (phrase.every((word, offset) => words[at + offset] === word)) starts.push(at);
  }
  return starts;
}

/**
 * The pub a whole sentence names ("How much is a pint at The Blackfriar?").
 * The keyless name matcher below asks whether the pub name contains the query,
 * which a sentence never satisfies. It is NOT folded into that matcher: a bare
 * name that is not listed ("The Crown & Sceptre") must not land on a shorter
 * listed pub ("The Crown"). matchVenueByName runs it only for a caller that
 * holds the user's whole question, and only when no model judged the query.
 * The pub name must appear in the query as two or more whole words, with or
 * without its leading "The": one word is a place word as often as a pub, so
 * The Bridge is never found in "near London Bridge". Nor may the name's words
 * past "The" share a word with a place name in the query at least as long:
 * The Kings is not in "near the Kings Cross station", nor The Hill in "Harrow
 * on the Hill", nor the Elephant and Castle pub in "near the Elephant and
 * Castle". Unsure is no answer. The longest name wins, and two different pubs
 * sharing that longest name are no answer at all.
 */
export function matchVenueNameWithinQuery<T extends VenueNameMatchInput>(
  venues: readonly T[],
  query: string,
): T | null {
  const words = wordsOnly(query).split(" ");
  const places = PLACE_PHRASES.flatMap((place) =>
    startsOf(words, place).map((start) => [start, start + place.length] as const),
  );
  const namedOutsidePlace = (name: readonly string[]) =>
    startsOf(words, name).some((start) => {
      const from = name[0] === "the" ? start + 1 : start;
      const to = start + name.length;
      return !places.some(
        ([placeFrom, placeTo]) => placeFrom < to && from < placeTo && placeTo - placeFrom >= to - from,
      );
    });
  let best: T | null = null;
  let bestLength = 0;
  let tied = false;
  for (const venue of venues) {
    const full = wordsOnly(venue.name).split(" ");
    const names = full[0] === "the" ? [full, full.slice(1)] : [full];
    for (const name of names) {
      if (name.length < 2) continue;
      if (!namedOutsidePlace(name)) continue;
      const length = name.join(" ").length;
      if (length > bestLength) {
        best = venue;
        bestLength = length;
        tied = false;
      } else if (length === bestLength && best && best.id !== venue.id) {
        tied = true;
      }
    }
  }
  return tied ? null : best;
}

/** Keyless fallback: exact, then startsWith, then includes. Array order breaks ties. */
export function matchVenueByNameKeyless<T extends VenueNameMatchInput>(
  venues: readonly T[],
  name: string,
): T | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const exact = venues.find((v) => v.name.toLowerCase() === needle);
  if (exact) return exact;
  const starts = venues.find((v) => v.name.toLowerCase().startsWith(needle));
  if (starts) return starts;
  return venues.find((v) => v.name.toLowerCase().includes(needle)) ?? null;
}

function queryTokens(query: string): string[] {
  return significantNameTokens(normalizeVenueIdentityName(query));
}

function venueTokens(venue: VenueNameMatchInput): string[] {
  return [
    ...significantNameTokens(normalizeVenueIdentityName(venue.name)),
    ...significantNameTokens(normalizeVenueIdentityName(venue.area)),
  ];
}

/**
 * Every venue whose name or area shares a distinctive token with the query,
 * ranked so exact and prefix hits sit first, capped at 12.
 */
export function collectVenueNameCandidates<T extends VenueNameMatchInput>(
  venues: readonly T[],
  query: string,
  limit: number = VENUE_RESOLUTION_CANDIDATE_LIMIT,
): T[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];
  const qTokens = queryTokens(query);
  if (qTokens.length === 0) return [];
  const qSet = new Set(qTokens);

  const scored: Array<{ venue: T; rank: number }> = [];
  for (const venue of venues) {
    const shared = venueTokens(venue).filter((token) => qSet.has(token)).length;
    if (shared === 0) continue;
    const lower = venue.name.toLowerCase();
    let rank = shared * 10;
    if (lower === needle) rank += 400;
    else if (lower.startsWith(needle)) rank += 300;
    else if (lower.includes(needle)) rank += 200;
    scored.push({ venue, rank });
  }
  scored.sort((a, b) => b.rank - a.rank);
  return scored.slice(0, limit).map((row) => row.venue);
}

export function uniqueExactVenueNameMatch<T extends VenueNameMatchInput>(
  venues: readonly T[],
  name: string,
): T | null {
  const needle = name.trim().toLowerCase();
  if (!needle) return null;
  const hits = venues.filter((v) => v.name.toLowerCase() === needle);
  return hits.length === 1 ? (hits[0] ?? null) : null;
}

/**
 * A judged answer is only a probability when it is a real number in [0, 1].
 * `"0.95"`, `95` and `true` all satisfy `>= 0.55` under JavaScript coercion.
 */
export function isVenueResolutionProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

/**
 * Pick a candidate option key, or null for none / below-floor / malformed.
 * Never publishes on argmax without the floor. Prefers none over a wrong pub.
 */
export function pickIntendedVenueOption(
  choice: unknown,
  probabilities: unknown,
  floor: number = INTENDED_VENUE_FLOOR,
): string | null {
  if (typeof choice !== "string" || !choice) return null;
  if (!probabilities || typeof probabilities !== "object" || Array.isArray(probabilities)) {
    return null;
  }
  const probs = probabilities as Record<string, unknown>;
  for (const value of Object.values(probs)) {
    if (!isVenueResolutionProbability(value)) return null;
  }
  const p = probs[choice];
  if (!isVenueResolutionProbability(p)) return null;
  if (choice === NONE_OPTION) return null;
  if (p < floor) return null;
  return choice;
}

export function optionIndex(option: string): number | null {
  if (!/^c\d+$/.test(option)) return null;
  const index = Number.parseInt(option.slice(1), 10);
  return Number.isInteger(index) && index >= 0 ? index : null;
}

export function intendedVenueQuestions(candidates: VenueResolutionCandidate[]) {
  const criteria: Record<string, { what: string; not_for: string; examples?: string[] }> = {
    [NONE_OPTION]: {
      what: "The query does not name exactly one of these pubs",
      not_for:
        "A query that clearly names one listed candidate, even if shortened or missing The",
      examples: [
        "Crown when several Crowns are listed",
        "Bell when Bell and Crown is also listed",
        "Soho",
        "a quiet pint",
      ],
    },
  };
  for (const [index, candidate] of candidates.entries()) {
    criteria[candidateOptionKey(index)] = {
      what: `${candidate.name} in ${candidate.area}, ${candidate.address}`,
      not_for: "A different pub that only shares a word of the name",
    };
  }
  return {
    intendedVenue: choice(
      {
        question: "Which listed pub in `candidates` does `query` name?",
        inspect: "query",
        compare: ["query", "candidates"],
        focus:
          "Pick the one pub the drinker meant. Choose none when the query is an area, a shared pub word that names several pubs, a typo that does not land on one candidate, or anything that is not one of these pubs.",
      },
      criteria,
    ),
  };
}

export function venueResolutionState(
  query: string,
  candidates: VenueResolutionCandidate[],
): { query: string; candidates: VenueResolutionCandidate[] } {
  return { query, candidates };
}
