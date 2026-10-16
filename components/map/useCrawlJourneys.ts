"use client";

// London-only: fetch CityMCP TfL journeys for consecutive crawl stops, every
// leg of the route in one request (F10). Fail-soft — empty map on any error. Debounces on route identity; aborts
// in-flight work on unmount / route change. React 19: deferred setState.

import { useEffect, useMemo, useState } from "react";

import { discardBody } from "@/lib/responseBody";
import { formatJourneySummary } from "@/lib/formatJourney";
import type { Venue } from "@/lib/venues";

export type CrawlJourneyLegSummary = {
  fromId: string;
  toId: string;
  summary: string;
  durationMinutes?: number;
  modes: string[];
};

type JourneyApiAnswer = {
  durationMinutes?: number;
  legs?: Array<{ mode?: string; summary?: string; durationMinutes?: number }>;
};

type CrawlLegsApiResponse = {
  legs?: Array<{ journeys?: JourneyApiAnswer[]; error?: string }>;
  error?: string;
};

const EMPTY: CrawlJourneyLegSummary[] = [];

/** ~11 m: the precision `routeKey` already treats as the same stop. */
const COORD_DECIMALS = 4;
/** The journey route answers at most this many stops per request. */
const MAX_STOPS_PER_REQUEST = 12;

function stopPoint(venue: Venue): string {
  return `${venue.latitude.toFixed(COORD_DECIMALS)},${venue.longitude.toFixed(COORD_DECIMALS)}`;
}

function routeKey(route: readonly Venue[]): string {
  return route.map((v) => `${v.id}:${stopPoint(v)}`).join("|");
}

/**
 * One GET for every leg of the crawl (F10). Coordinates are rounded so two
 * readers mapping the same pubs share one CDN key, and the legs ride one
 * request so a crawl pays one function invocation rather than one per leg.
 */
export function crawlJourneysUrl(route: readonly Venue[]): string {
  const params = new URLSearchParams({
    stops: route.map(stopPoint).join(";"),
    limit: "1",
  });
  return `/api/citymcp/journey?${params}`;
}

function summariseLeg(
  from: Venue,
  to: Venue,
  best: JourneyApiAnswer | undefined,
): CrawlJourneyLegSummary | null {
  if (!best?.legs?.length) return null;
  const modes = best.legs
    .map((leg) => String(leg.mode ?? "").trim())
    .filter(Boolean);
  return {
    fromId: from.id,
    toId: to.id,
    summary: formatJourneySummary({
      durationMinutes: best.durationMinutes,
      legs: modes.map((mode) => ({ mode })),
    }),
    durationMinutes:
      typeof best.durationMinutes === "number" ? best.durationMinutes : undefined,
    modes,
  };
}

/** Pair each answered leg with the consecutive stops it joins. */
export function crawlLegsFromResponse(
  route: readonly Venue[],
  body: CrawlLegsApiResponse,
): CrawlJourneyLegSummary[] {
  const out: CrawlJourneyLegSummary[] = [];
  const legs = Array.isArray(body.legs) ? body.legs : [];
  for (let i = 0; i < route.length - 1; i += 1) {
    const from = route[i];
    const to = route[i + 1];
    if (!from || !to) continue;
    const leg = summariseLeg(from, to, legs[i]?.journeys?.[0]);
    if (leg) out.push(leg);
  }
  return out;
}

/**
 * Split a route into request-sized runs of stops. Runs overlap by one stop so
 * the leg between them is still asked; a mapped route (12 stops) is one run.
 */
export function crawlJourneyChunks(route: readonly Venue[]): Venue[][] {
  const chunks: Venue[][] = [];
  for (let start = 0; start < route.length - 1; start += MAX_STOPS_PER_REQUEST - 1) {
    chunks.push(route.slice(start, start + MAX_STOPS_PER_REQUEST));
  }
  return chunks;
}

async function fetchCrawlLegs(
  route: readonly Venue[],
  signal: AbortSignal,
): Promise<CrawlJourneyLegSummary[]> {
  const results: CrawlJourneyLegSummary[] = [];
  for (const chunk of crawlJourneyChunks(route)) {
    if (signal.aborted) return EMPTY;
    const res = await fetch(crawlJourneysUrl(chunk), {
      signal,
      headers: { accept: "application/json" },
    });
    if (!res.ok) {
      discardBody(res);
      continue;
    }
    results.push(...crawlLegsFromResponse(chunk, (await res.json()) as CrawlLegsApiResponse));
  }
  return results;
}

/**
 * Fetch TfL journey summaries for each consecutive pair in `route`.
 * Only runs when `enabled` (London) and route has ≥2 stops.
 */
export function useCrawlJourneys(
  route: readonly Venue[],
  enabled: boolean,
): {
  byToIndex: Map<number, CrawlJourneyLegSummary>;
  loading: boolean;
  totalMinutes: number | null;
} {
  const key = useMemo(() => routeKey(route), [route]);
  const [legs, setLegs] = useState<CrawlJourneyLegSummary[]>(EMPTY);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!enabled || route.length < 2) {
      Promise.resolve().then(() => {
        setLegs(EMPTY);
        setLoading(false);
      });
      return;
    }

    const controller = new AbortController();
    Promise.resolve().then(() => setLoading(true));

    (async () => {
      const results = await fetchCrawlLegs(route, controller.signal);
      if (controller.signal.aborted) return;
      Promise.resolve().then(() => {
        setLegs(results);
        setLoading(false);
      });
    })().catch(() => {
      if (controller.signal.aborted) return;
      Promise.resolve().then(() => {
        setLegs(EMPTY);
        setLoading(false);
      });
    });

    return () => controller.abort();
    // key captures route identity; route array is read inside for coords.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- key is the stable identity
  }, [enabled, key]);

  const byToIndex = useMemo(() => {
    const map = new Map<number, CrawlJourneyLegSummary>();
    for (let i = 0; i < route.length - 1; i += 1) {
      const to = route[i + 1];
      if (!to) continue;
      const found = legs.find((leg) => leg.toId === to.id && leg.fromId === route[i]?.id);
      if (found) map.set(i + 1, found);
    }
    return map;
  }, [legs, route]);

  const totalMinutes = useMemo(() => {
    if (legs.length === 0) return null;
    let sum = 0;
    let n = 0;
    for (const leg of legs) {
      if (typeof leg.durationMinutes === "number") {
        sum += leg.durationMinutes;
        n += 1;
      }
    }
    return n > 0 ? sum : null;
  }, [legs]);

  return { byToIndex, loading, totalMinutes };
}
