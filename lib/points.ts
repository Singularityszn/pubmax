// Points and levels: what a person's own records earn, and the level a total
// reaches. The one owner of the values, so the profile card, the read and the
// leaderboards that build on it cannot drift.
//
// A PURE LEAF. It imports no store and no React. lib/points.server.ts reads
// the records; this module only counts them.
//
// A POINT IS A RECORD, NEVER A DRINK. A pub counts once, however many visits
// say so, through the same fold the passport's Been list uses
// (lib/profilePassport.ts). A price counts because it is on the map, and a pint
// with no price earns nothing. A pub added or fixed counts once a person has
// accepted it. Nothing counts days running.

const POINTS_EACH = {
  /** A pub on the Been list: diary, Pint Drop, finished plan or Been here. */
  been: 10,
  /** A Pint Drop with a price. */
  priceLogged: 5,
  /** A price a bill check or a second drinker confirmed. On top of priceLogged. */
  priceChecked: 10,
  /** A London postcode district where you have been to every pub we list. */
  district: 50,
  /** A pub you sent in that a person accepted. */
  pubAdded: 20,
  /** A fix to a pub's details that a person resolved. */
  pubFixed: 5,
} as const;

export type PointsLineKey = keyof typeof POINTS_EACH;

const LINE_ORDER: readonly PointsLineKey[] = [
  "been",
  "priceLogged",
  "priceChecked",
  "district",
  "pubAdded",
  "pubFixed",
];

type PointsLine = { key: PointsLineKey; count: number; each: number; points: number };

export type PointsBreakdown = {
  /** "degraded" when a store did not answer: its line counts 0, never a guess. */
  status: "ready" | "degraded";
  total: number;
  level: number;
  /** The total this level starts at. */
  levelFloor: number;
  /** The total the next level starts at, or null at the top level. */
  nextLevelAt: number | null;
  lines: PointsLine[];
  /** The finished London postcode districts, in order. */
  districts: string[];
};

// ── Levels ──────────────────────────────────────────────────────────────────

/** The total each level starts at. Level 1 starts at 0. */
const LEVEL_FLOORS = [0, 50, 150, 300, 500, 800, 1200, 1700, 2400, 3200, 4200, 5500, 7000, 9000, 12000] as const;

export function levelFor(total: number): { level: number; floor: number; next: number | null } {
  const points = Number.isFinite(total) && total > 0 ? total : 0;
  let index = 0;
  while (index + 1 < LEVEL_FLOORS.length && points >= LEVEL_FLOORS[index + 1]!) index += 1;
  return { level: index + 1, floor: LEVEL_FLOORS[index]!, next: LEVEL_FLOORS[index + 1] ?? null };
}

export type PointsCounts = Record<PointsLineKey, number>;

export function buildPointsBreakdown(
  counts: PointsCounts,
  districts: readonly string[],
  status: PointsBreakdown["status"],
): PointsBreakdown {
  const lines = LINE_ORDER.map((key) => {
    const count = Math.max(0, Math.floor(counts[key] || 0));
    return { key, count, each: POINTS_EACH[key], points: count * POINTS_EACH[key] };
  });
  const total = lines.reduce((sum, line) => sum + line.points, 0);
  const { level, floor, next } = levelFor(total);
  return { status, total, level, levelFloor: floor, nextLevelAt: next, lines, districts: [...districts] };
}

// ── London postcode districts ───────────────────────────────────────────────

/** The London postal areas. An outer-London town postcode (CR, BR, KT…) is not one. */
const LONDON_AREAS: ReadonlySet<string> = new Set(["E", "EC", "N", "NW", "SE", "SW", "W", "WC"]);

const FULL_POSTCODE = /\b([a-z]{1,2})(\d{1,2})[a-z]?\s*\d[a-z]{2}\b/i;

/** A district needs this many pubs on our list before it can be finished. */
export const DISTRICT_MIN_PUBS = 3;

/**
 * The London postcode district of the first full postcode in `text`, such as
 * "SE1" for "se1 9dd" and "W1" for "w1d 3aj", or null. A sub-district letter
 * folds into its district. Only a full postcode counts, so a stray "SW19" in a
 * name never places a pub.
 */
export function londonPostcodeDistrict(text: string): string | null {
  const match = FULL_POSTCODE.exec(text ?? "");
  if (!match) return null;
  const area = match[1]!.toUpperCase();
  return LONDON_AREAS.has(area) ? `${area}${match[2]}` : null;
}

export type DistrictVenue = { id: string; kind?: string; searchText?: string };

/**
 * The pubs we list in each London postcode district, by venue id. Bars and
 * restaurants are left out, a pub with no postcode on file is left out, and so
 * is a district with fewer than DISTRICT_MIN_PUBS pubs.
 */
export function londonDistricts(venues: readonly DistrictVenue[]): Map<string, string[]> {
  const byDistrict = new Map<string, string[]>();
  for (const venue of venues) {
    if (!venue.id || (venue.kind !== undefined && venue.kind !== "pub")) continue;
    const district = londonPostcodeDistrict(venue.searchText ?? "");
    if (!district) continue;
    const ids = byDistrict.get(district) ?? [];
    if (!ids.includes(venue.id)) ids.push(venue.id);
    byDistrict.set(district, ids);
  }
  for (const [district, ids] of byDistrict) {
    if (ids.length < DISTRICT_MIN_PUBS) byDistrict.delete(district);
  }
  return byDistrict;
}

/** The districts where every listed pub is in `visited`, in order. */
export function finishedDistricts(
  districts: ReadonlyMap<string, readonly string[]>,
  visited: ReadonlySet<string>,
): string[] {
  return [...districts]
    .filter(([, ids]) => ids.length > 0 && ids.every((id) => visited.has(id)))
    .map(([district]) => district)
    .sort((a, b) => a.localeCompare(b, "en-GB", { numeric: true }));
}

// ── Copy ────────────────────────────────────────────────────────────────────

export const POINTS_COPY = {
  kicker: "Points",
  lines: {
    been: "Pubs you've been to",
    priceLogged: "Prices you logged",
    priceChecked: "Prices checked",
    district: "Postcode districts finished",
    pubAdded: "Pubs you added",
    pubFixed: "Pub fixes",
  } satisfies Record<PointsLineKey, string>,
  howTitle: "How points work",
  how: [
    "10 for each pub on your Been list, however you logged it.",
    "5 for each price you log, and 10 more when a bill or a second drinker checks it.",
    "50 for a London postcode district once you've been to every pub we list in it.",
    "20 for a pub you add and 5 for a fix, once a person accepts it.",
  ],
  fence: "Points count what you put on the map. How much you drink never counts.",
  degraded: "Some of your records didn't load, so this total may be low. Try again later.",
} as const;
