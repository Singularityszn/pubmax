// Code finds Ask-router candidates; the model selects among them.

import { NIGHT_AREAS } from "@/lib/nightAreas";
import {
  ASK_ROUTER_NONE,
  ASK_ROUTER_VENUE_CANDIDATE_CAP,
} from "@/lib/ask/routerPolicy";

export type AskVenueCandidate = {
  id: string;
  name: string;
  area: string;
};

export type AskAreaCandidate = {
  id: string;
  name: string;
};

const STOP_TOKENS = new Set([
  "the",
  "a",
  "an",
  "and",
  "in",
  "at",
  "near",
  "to",
  "of",
  "for",
  "with",
  "please",
  "pub",
  "pubs",
]);

function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !STOP_TOKENS.has(part));
}

function venueHitsQuery(venue: AskVenueCandidate, query: string): boolean {
  const haystack = query.toLowerCase();
  const name = venue.name.toLowerCase();
  if (name.length >= 4 && haystack.includes(name)) return true;
  const venueTokens = tokens(venue.name);
  if (venueTokens.length === 0) return false;
  const queryTokens = new Set(tokens(query));
  return venueTokens.some((token) => queryTokens.has(token));
}

function pushUnique(
  out: AskVenueCandidate[],
  seen: Set<string>,
  rows: readonly AskVenueCandidate[],
): void {
  for (const row of rows) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    out.push(row);
    if (out.length >= ASK_ROUTER_VENUE_CANDIDATE_CAP) return;
  }
}

/**
 * Substring hits, then recently viewed, then nearby, capped.
 * Recently viewed that also hit the query go first.
 */
export function findAskVenueCandidates(
  query: string,
  input: {
    venues?: readonly AskVenueCandidate[];
    nearbyVenues?: readonly AskVenueCandidate[];
    recentlyViewed?: readonly AskVenueCandidate[];
  } = {},
): AskVenueCandidate[] {
  const out: AskVenueCandidate[] = [];
  const seen = new Set<string>();
  const pool = input.venues ?? [];
  const hits = pool.filter((venue) => venueHitsQuery(venue, query));
  const viewedHits = (input.recentlyViewed ?? []).filter((venue) =>
    venueHitsQuery(venue, query),
  );
  pushUnique(out, seen, viewedHits);
  pushUnique(out, seen, hits);
  pushUnique(out, seen, input.recentlyViewed ?? []);
  pushUnique(out, seen, input.nearbyVenues ?? []);
  return out;
}

function londonAreaLabels(): AskAreaCandidate[] {
  const out: AskAreaCandidate[] = [];
  const seen = new Set<string>();
  for (const area of NIGHT_AREAS) {
    if (area.cityId !== "london") continue;
    const labels = [area.name, ...area.aliases];
    for (const part of area.name.split(/\s*[&,]\s*/)) {
      if (part.trim()) labels.push(part.trim());
    }
    for (const label of labels) {
      const id = label
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "");
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push({ id, name: label });
    }
  }
  // Test and regex cases name these even when they are not a night-area seed.
  for (const extra of ["Bank", "Westminster"]) {
    const id = extra.toLowerCase();
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: extra });
  }
  return out;
}

let cachedLondonAreas: AskAreaCandidate[] | undefined;

function knownAskAreas(): AskAreaCandidate[] {
  cachedLondonAreas ??= londonAreaLabels();
  return cachedLondonAreas;
}

/** Areas whose name appears in the query, plus `none`. Always includes none. */
export function findAskAreaCandidates(query: string): AskAreaCandidate[] {
  const haystack = query.toLowerCase();
  const hits = knownAskAreas().filter((area) =>
    haystack.includes(area.name.toLowerCase()),
  );
  return [...hits, { id: ASK_ROUTER_NONE, name: "none of these areas" }];
}
