// Tonight-list de-duplication (draft plan F6, decision #11). Pure and React-free.
//
// The live-taste P0: /tonight rendered ~60 near-identical "Curry Club - every
// Thursday" rows in one endless column. This collapses chain-wide duplicate
// offers into ONE card per offer family, carrying the nearest venue plus the
// rest as expandable alternates, so a syndicated promotion reads as one deal at
// many pubs rather than sixty separate recommendations.
//
// This is the canonical model, and it is the ONLY model. It used to sit behind
// a rollout flag CI set and no deployment ever did, so every reader got the
// older collapse while the tests proved the newer one (see the retired-flag
// fence in __tests__/trustedHandoffFlags.test.ts). The exact
// group key carries the normalised schedule, so distinct schedules never
// collapse; groups are ordered by the deterministic locality tie-break
// (distance, confidence, source observation, start, group key, venue id); and a
// first-ten family-diversity cap runs before the caller's limit. The card shape
// is unchanged (nearest hero + alternates + venueCount), so the shipped
// expander and family facets keep working.
//
// No em dashes or en dashes in any string this module builds (product-copy rule).

import {
  distanceKm,
  isUsableRow,
  normaliseText,
  startMs,
  venueIdentity,
  type NearPoint,
} from "@/lib/dealsDigest";
import type { WhatsOnConfidence, WhatsOnRow } from "@/lib/whatsOn";

export type { NearPoint } from "@/lib/dealsDigest";

export type TonightGroupedRow = {
  /** The venue to render as the card: the nearest in the family when a near
   *  point is known, otherwise the soonest (then input order). */
  row: WhatsOnRow;
  /** Other venues running the same deal, nearest-first — the expander content.
   *  Empty for a lone listing. */
  alternates: WhatsOnRow[];
  /** Distinct real venues in the family (the card's venue + alternates). 1 for a
   *  lone listing; drives the "Same deal at N pubs" disclosure. */
  venueCount: number;
};

// Number of leading results the family-diversity cap protects, and how many of
// one family it allows inside that window. Fixed by contract 4.11 ("No family
// appears more than twice in first ten"); independent of the caller's API limit.
const DIVERSITY_WINDOW = 10;
const DIVERSITY_FAMILY_CAP = 2;

const CONFIDENCE_RANK: Record<WhatsOnConfidence, number> = {
  confirmed: 2,
  listed: 1,
  derived: 0,
};

// The normalised schedule signature: the row's absolute start instant plus its
// end (when present). Two offers at genuinely different times or nights are
// distinct schedules and never collapse; the same syndicated instant across many
// pubs still shares one signature and collapses to one card. Unparseable starts
// fall back to the raw trimmed string so a malformed schedule never silently
// merges with a valid one.
function scheduleSignature(row: WhatsOnRow): string {
  const start = Date.parse(row.startsAt ?? "");
  const rawStart = String(row.startsAt ?? "").trim();
  const startSig = Number.isFinite(start)
    ? new Date(start).toISOString()
    : rawStart || normaliseText(row.timeEvidence ?? "");
  const end = row.endsAt != null ? Date.parse(row.endsAt) : NaN;
  const endSig = Number.isFinite(end) ? new Date(end).toISOString() : "";
  return `${startSig}\u0000${endSig}`;
}

// Exact group key: normalised title + kind + source publisher + normalised
// schedule (contract 4.11). NUL separators never occur in scraped or authored
// strings, so the joined fields cannot collide across a boundary.
//
// A QUIZ IS ONE PUB'S NIGHT, never one offer at many pubs, so a quiz row also
// keys on its venue. A quiz company's directory titles every venue's quiz the
// same way ("Pub quiz - Wednesdays 7:30pm"), and without the venue four
// separate quizzes in four boroughs folded into one card under "Same deal at 4
// pubs", while the home page counted them as four things on tonight.
function exactKey(row: WhatsOnRow): string {
  const venue = row.kind === "quiz" ? `\u0000${venueIdentity(row)}` : "";
  return `${row.kind}\u0000${normaliseText(row.title)}\u0000${normaliseText(row.source?.label ?? "")}\u0000${scheduleSignature(row)}${venue}`;
}

// Family-diversity key: normalised title + kind only (contract 4.11). A family
// can span several exact groups (distinct sources or schedules); the cap keeps
// any one family from dominating the first ten.
function familyKey(row: WhatsOnRow): string {
  return `${row.kind}\u0000${normaliseText(row.title)}`;
}

// Source observation instant in ms, or -Infinity when absent/unparseable so an
// unknown-freshness group sorts LAST under the descending source-observation
// tie-break (contract: "Source observation descending; unknown last").
function observedMs(row: WhatsOnRow): number {
  const ms = Date.parse(row.observedAt);
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

type Group = {
  exact: string;
  family: string;
  hero: WhatsOnRow;
  alternates: WhatsOnRow[];
  venueCount: number;
  heroDistance: number;
  topConfidence: WhatsOnConfidence;
  freshestObservedMs: number;
  soonestStartMs: number;
  heroVenueId: string;
};

/**
 * Group the Tonight list's chain-wide duplicate offers. Rows sharing an exact
 * (kind, title, publisher, schedule) family collapse into one entry carrying the
 * nearest venue plus the rest as alternates. Malformed rows are dropped. Pure
 * and non-mutating; an empty input yields an empty list.
 */
export function groupTonightListings(
  rows: readonly WhatsOnRow[],
  near: NearPoint | null,
): TonightGroupedRow[] {
  // 1. Bucket usable rows by the exact (schedule-aware) group key.
  const buckets = new Map<string, { row: WhatsOnRow; index: number }[]>();
  rows.forEach((row, index) => {
    if (!isUsableRow(row)) return;
    const key = exactKey(row);
    const bucket = buckets.get(key);
    if (bucket) bucket.push({ row, index });
    else buckets.set(key, [{ row, index }]);
  });

  // 2. Within each group, order members nearest-first (then soonest, then input
  //    order) so the hero is the nearest venue when a near point is known.
  const groups: Group[] = [];
  for (const [exact, members] of buckets) {
    const ordered = [...members].sort((a, b) => {
      const da = distanceKm(a.row, near);
      const db = distanceKm(b.row, near);
      if (da !== db) return da - db;
      const sa = startMs(a.row);
      const sb = startMs(b.row);
      if (sa !== sb) return sa - sb;
      return a.index - b.index;
    });
    const memberRows = ordered.map((m) => m.row);
    const hero = memberRows[0];
    if (!hero) continue;
    groups.push({
      exact,
      family: familyKey(hero),
      hero,
      alternates: memberRows.slice(1),
      venueCount: new Set(memberRows.map(venueIdentity)).size,
      heroDistance: distanceKm(hero, near),
      topConfidence: memberRows.reduce<WhatsOnConfidence>(
        (best, r) => (CONFIDENCE_RANK[r.confidence] > CONFIDENCE_RANK[best] ? r.confidence : best),
        hero.confidence,
      ),
      freshestObservedMs: memberRows.reduce((max, r) => Math.max(max, observedMs(r)), Number.NEGATIVE_INFINITY),
      soonestStartMs: memberRows.reduce((min, r) => Math.min(min, startMs(r)), Number.POSITIVE_INFINITY),
      heroVenueId: venueIdentity(hero),
    });
  }

  // 3. Deterministic tie-break (contract 4.11): distance asc (missing last),
  //    confidence desc, source observation desc (unknown last), start asc, then
  //    the stable group key and hero venue id so the order is fully determined.
  const sorted = groups.sort((a, b) => {
    if (a.heroDistance !== b.heroDistance) return a.heroDistance - b.heroDistance;
    const byConfidence = CONFIDENCE_RANK[b.topConfidence] - CONFIDENCE_RANK[a.topConfidence];
    if (byConfidence !== 0) return byConfidence;
    if (a.freshestObservedMs !== b.freshestObservedMs) return b.freshestObservedMs - a.freshestObservedMs;
    if (a.soonestStartMs !== b.soonestStartMs) return a.soonestStartMs - b.soonestStartMs;
    if (a.exact !== b.exact) return a.exact < b.exact ? -1 : 1;
    if (a.heroVenueId !== b.heroVenueId) return a.heroVenueId < b.heroVenueId ? -1 : 1;
    return 0;
  });

  // 4. First-ten family diversity: no family fills more than two of the leading
  //    ten slots. A deferred group keeps its sorted position in the tail, so the
  //    order stays deterministic and no group is ever dropped.
  const selected: Group[] = [];
  const deferred: Group[] = [];
  const familyInWindow = new Map<string, number>();
  for (const group of sorted) {
    if (selected.length >= DIVERSITY_WINDOW) {
      deferred.push(group);
      continue;
    }
    const count = familyInWindow.get(group.family) ?? 0;
    if (count >= DIVERSITY_FAMILY_CAP) {
      deferred.push(group);
      continue;
    }
    familyInWindow.set(group.family, count + 1);
    selected.push(group);
  }

  return [...selected, ...deferred].map((group) => ({
    row: group.hero,
    alternates: group.alternates,
    venueCount: group.venueCount,
  }));
}
