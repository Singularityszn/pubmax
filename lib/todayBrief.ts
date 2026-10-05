// Morning brief composition core (Lane A, /today). Pure, React-free, no fetch
// and no clock of its own: every function takes `now`, so the whole surface is
// unit-testable with fixed dates. The route wires the bundled data (weather
// snapshot, baseline what's-on rows, heritage cache) and the current time in;
// this module turns them into the small, honest string bags the cards render.
//
// Honesty rules, matching the rest of the app:
//   - weather: the observation's own facts whenever a real, not-future reading
//     exists for the area; a verdict only when the reading is fresh AND the rules
//     table fires. A reading past its own expiry keeps its facts and a "last
//     checked" line, and carries no verdict.
//   - tonight picks: ranked from the already-windowed rows, never padded; an
//     empty night stays empty (the card shows its own honest empty state).
//   - pub fact: one genuinely sourced heritage fact (seed-only pubs are skipped)
//     carrying its provenance label; no invented facts, no unattributed claims.
//
// No em dashes or en dashes anywhere (product-copy rule extends to the strings
// this module builds).

import type { Route } from "next";

import type { AppOrExternalLink } from "@/lib/appLink";
import {
  evaluateDrinkWeather,
  type DrinkWeatherRuleId,
  type VenueLens,
} from "@/lib/drinkWeather";
import { daySlot } from "@/lib/daySlot";
import { haversineKm } from "@/lib/haversine";
import { firstHttp } from "@/lib/httpUrl";
import type { NightAreaSlug } from "@/lib/nightAreas";
import { formatConditionDate, londonMonth } from "@/lib/tonightConditions";
import { latestWeatherForArea } from "@/lib/weatherSnapshots";
import { observationFacts } from "@/lib/weatherObservationCopy";
import { whatsOnBarePriceGbp, type WhatsOnConfidence, type WhatsOnKind, type WhatsOnRow } from "@/lib/whatsOn";

// A central district for the location-free morning glance. The brief is a
// city-level weather read, so the card never claims this is "your area"; it just
// needs a representative observation to run the rules against.
export const BRIEF_DEFAULT_AREA: NightAreaSlug = "piccadilly-soho";

// ---------------------------------------------------------------------------
// Card 1: drink-weather verdict, with an honest staleness line.
// ---------------------------------------------------------------------------

export type WeatherBrief = {
  /** "Saturday 19 Jul" (London time). */
  dateLabel: string;
  /** The verdict's calm line, e.g. "Beer garden weather. Lager or cider." */
  verdictLine: string;
  /** The exact weather rule selected from this displayed observation; null when stale or no rule fired. */
  ruleId: DrinkWeatherRuleId | null;
  /** Lower-case drink phrase, e.g. "a cold lager or cider". */
  drinkSuggestion: string;
  /** The verdict's venue classification, so surfaces above the card (the /today
   *  greeting) can phrase the same verdict without re-deriving one. */
  venueLens: VenueLens;
  /** True once the observation has aged past its own expiry at `now`. */
  stale: boolean;
  /** "Checked 2 hours ago" (fresh) or "Last checked 3 days ago" (stale). */
  checkedLabel: string;
  /** Attribution for the weather claim. */
  source: { publisher: string; url: string };
  /** Numbers-led line: temp, rain, wind, sunset, day or night. */
  factsLine: string;
};

/**
 * Build the weather card, or null when there is no honest reading to show: an
 * invalid or future-generated snapshot, no observation for the area, or a
 * future-dated observation. A stale reading, or a fresh one the rules table has
 * no verdict for, still returns its facts with every verdict field empty.
 */
export function buildWeatherBrief(
  snapshot: unknown,
  now: Date,
  area: NightAreaSlug = BRIEF_DEFAULT_AREA,
): WeatherBrief | null {
  const read = latestWeatherForArea(snapshot, area, now.getTime());
  if (!read) return null;
  const { observation, stale } = read;
  const { factsLine, checkedLabel, isDay } = observationFacts({ observation, nightArea: area, now, stale });
  const verdict = stale
    ? null
    : evaluateDrinkWeather({
        tempC: observation.feelsLikeC,
        precipitationProbabilityPct: observation.precipitationProbabilityPct,
        month: londonMonth(now),
        dayPart: daySlot(now),
        isDay,
      });

  return {
    dateLabel: formatConditionDate(now),
    verdictLine: verdict?.line ?? "",
    ruleId: verdict?.ruleId ?? null,
    drinkSuggestion: verdict?.drinkSuggestion ?? "",
    venueLens: verdict?.venueLens ?? "any",
    stale,
    checkedLabel,
    source: { publisher: observation.source.publisher, url: observation.source.sourceUrl },
    factsLine,
  };
}

// ---------------------------------------------------------------------------
// Card 2: tonight's top picks.
// ---------------------------------------------------------------------------

// A confirmed listing outranks a merely listed one, which outranks a
// cross-referenced inference. Mirrors the store's collision ranking so the brief
// never elevates a weaker row over a stronger one.
const CONFIDENCE_RANK: Record<WhatsOnConfidence, number> = {
  confirmed: 2,
  listed: 1,
  derived: 0,
};

/**
 * Rank already-windowed What's-On rows for the brief and take up to `limit`
 * distinct titles. Chain-wide promotions can arrive once per venue; treating
 * those copies as three separate recommendations makes the brief look broken.
 * Title identity is deliberately conservative rather than fuzzy: Unicode
 * compatibility form, case, and whitespace are ignored, but punctuation and
 * wording still distinguish genuinely different listings.
 *
 * Highest confidence first, then soonest start, then original order (stable).
 * Pure: the caller supplies rows already filtered to tonight's window via the
 * store's #409 interval-overlap windowing. An empty input yields an empty list.
 */
export function rankTonightPicks(rows: readonly WhatsOnRow[], limit = 3): WhatsOnRow[] {
  const ranked = rows
    .map((row, index) => ({ row, index }))
    .sort((a, b) => {
      const byConfidence = CONFIDENCE_RANK[b.row.confidence] - CONFIDENCE_RANK[a.row.confidence];
      if (byConfidence !== 0) return byConfidence;
      const byStart =
        Date.parse(a.row.startsAt ?? "") - Date.parse(b.row.startsAt ?? "");
      if (Number.isFinite(byStart) && byStart !== 0) return byStart;
      return a.index - b.index;
    });

  const cappedLimit = limit === Number.POSITIVE_INFINITY
    ? ranked.length
    : Number.isFinite(limit)
      ? Math.max(0, Math.floor(limit))
      : 0;
  if (cappedLimit === 0) return [];
  const seenTitles = new Set<string>();
  const picks: WhatsOnRow[] = [];
  for (const { row } of ranked) {
    const titleKey = row.title
      .normalize("NFKC")
      .toLocaleLowerCase("en-GB")
      .trim()
      .replace(/\s+/g, " ");
    if (seenTitles.has(titleKey)) continue;
    seenTitles.add(titleKey);
    picks.push(row);
    if (picks.length >= cappedLimit) break;
  }
  return picks;
}

/** Map deep-link (own venue) or external source URL, or no link. */
type TonightPickLink = AppOrExternalLink | { href: null; external: false };

// Serializable subset of a pick for the client card (the row's link is resolved
// here so the client never re-derives it).
export type TonightPickDto = TonightPickLink & {
  id: string;
  title: string;
  placeName: string;
  kind: WhatsOnKind;
  kindLabel: string;
  sourceLabel: string;
  priceGbp: number | null;
  /** Venue coordinate when the row carries one; lets the client order picks
   *  around the viewer's remembered patch (#427) without another fetch. */
  lat: number | null;
  lng: number | null;
  /** Honest one-line note when this pick stands in for a syndicated deal running
   *  at several venues ("Same deal at 12 pubs"), or null for a single venue. The
   *  count is real row data (lib/dealsDigest.ts), never padded. */
  venueNote?: string | null;
};

const KIND_LABEL: Record<WhatsOnKind, string> = {
  sport: "Sport",
  quiz: "Quiz",
  deal: "Deal",
  music: "Live music",
  event: "Event",
};

/** Reduce a row to the card DTO. A resolved venue deep-links to the map; a
 * scraped-by-name row links out to its source; otherwise no link. */
export function toTonightPickDto(row: WhatsOnRow): TonightPickDto {
  const venueId = typeof row.venueId === "string" && row.venueId.length > 0 ? row.venueId : null;
  const sourceUrl = firstHttp(row.source?.url);
  let link: TonightPickLink = { href: null, external: false };
  if (venueId) {
    const href: Route = `/map?sel=${encodeURIComponent(venueId)}`;
    link = { href, external: false };
  } else if (sourceUrl) {
    link = { href: sourceUrl, external: true };
  }
  return {
    ...link,
    id: row.id,
    title: row.title,
    placeName: row.placeName,
    kind: row.kind,
    kindLabel: KIND_LABEL[row.kind],
    sourceLabel: row.source.label,
    priceGbp: whatsOnBarePriceGbp(row),
    lat: typeof row.lat === "number" && Number.isFinite(row.lat) ? row.lat : null,
    lng: typeof row.lng === "number" && Number.isFinite(row.lng) ? row.lng : null,
  };
}

/**
 * Stable-reorder the (already server-chosen) picks so the ones nearest a point
 * lead. Same picks, same count — only the order moves; rows without a
 * coordinate keep their relative order at the tail. Pure for hermetic tests;
 * the client calls it with the remembered patch's heart (#427 seam) so Today
 * agrees with the map's Near me about which corner of London is "yours".
 */
export function orderPicksNear(
  picks: readonly TonightPickDto[],
  point: { lat: number; lng: number } | null,
): TonightPickDto[] {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return [...picks];
  }
  const km = (pick: TonightPickDto): number =>
    pick.lat != null && pick.lng != null
      ? haversineKm([pick.lng, pick.lat], [point.lng, point.lat])
      : Number.POSITIVE_INFINITY;
  return picks
    .map((pick, index) => ({ pick, index, km: km(pick) }))
    .sort((a, b) => a.km - b.km || a.index - b.index)
    .map((entry) => entry.pick);
}

// ---------------------------------------------------------------------------
// Card 4: the daily editorial pick.
// ---------------------------------------------------------------------------
//
// It lives in lib/pubOfTheDay now, and it is built from the JOINED historic
// index rather than the name-keyed heritage cache this module used to read.
// Astra F08 (6 Sep 2026): a name key cannot tell two London pubs of one name
// apart, and no content test stood between a Wikidata classification and the
// card, so "Sun Inn / pub in Barnes, London, UK" shipped as an editorial pick
// with no way into the product. `pickPubOfTheDayFact` and `TodayFact` are
// retired rather than kept beside it: two pickers is two answers.
