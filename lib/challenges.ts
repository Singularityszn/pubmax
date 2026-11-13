// Targets use only stored London venues, so their counts never estimate
// missing pubs.
//
// A PURE LEAF. It imports no store and no React. lib/points.server.ts reads
// the records and lib/points.ts prices a finished challenge.

import { londonDayKey } from "@/lib/londonHour";
import { haversineKm } from "@/lib/haversine";
import { londonDistricts, type DistrictVenue } from "@/lib/points";

export const CHALLENGE_IDS = ["red-lion", "kings-head", "ship", "every-district", "trades", "monopoly"] as const;
export type ChallengeId = (typeof CHALLENGE_IDS)[number];

type ChallengeTarget = { label: string; venueIds: string[]; mapVenueId?: string };
export type ChallengeSet = ReadonlyMap<ChallengeId, readonly ChallengeTarget[]>;

export type ChallengeVenue = DistrictVenue & { name: string; sourceName?: string; borough?: string; lat?: number; lng?: number };

/** A target still to do. A pub opens on the map; a district has no one pub to open. */
type ChallengeLeft = { label: string; venueId?: string };

export type ChallengeProgress = {
  id: ChallengeId;
  done: number;
  total: number;
  finished: boolean;
  /** Finished inside a month when it was the challenge of the month. */
  doubled: boolean;
  finishedAt: string | null;
  left: ChallengeLeft[];
};

// ── Names ───────────────────────────────────────────────────────────────────

/** The name each named-pub challenge looks for, after namePlate() folds it. */
const NAMED: ReadonlyArray<readonly [ChallengeId, string]> = [
  ["red-lion", "red lion"],
  ["kings-head", "kings head"],
  ["ship", "ship"],
];

const TRADES = new Set([
  "bricklayers arms", "carpenters arms", "masons arms", "blacksmiths arms",
  "builders arms", "coopers arms", "brewers arms", "bakers arms", "butchers arms",
  "weavers arms", "coachmakers arms",
]);

const MONOPOLY_STREETS: ReadonlyArray<readonly [string, string, readonly string[]]> = [
  ["Old Kent Road", "old kent road", ["Southwark"]],
  ["Whitechapel Road", "whitechapel road", ["Tower Hamlets"]],
  ["The Angel Islington", "islington high street", ["Islington"]],
  ["Euston Road", "euston road", ["Camden", "Westminster"]],
  ["Pentonville Road", "pentonville road", ["Islington"]],
  ["Pall Mall", "pall mall", ["Westminster"]],
  ["Whitehall", "whitehall", ["Westminster"]],
  ["Northumberland Avenue", "northumberland avenue", ["Westminster"]],
  ["Bow Street", "bow street", ["Westminster"]],
  ["Marlborough Street", "marlborough street", ["Westminster"]],
  ["Vine Street", "vine street", ["Westminster"]],
  ["Strand", "strand", ["Westminster"]],
  ["Fleet Street", "fleet street", ["City of London", "Westminster"]],
  ["Trafalgar Square", "trafalgar square", ["Westminster"]],
  ["Leicester Square", "leicester square", ["Westminster"]],
  ["Coventry Street", "coventry street", ["Westminster"]],
  ["Piccadilly", "piccadilly", ["Westminster"]],
  ["Regent Street", "regent street", ["Westminster"]],
  ["Oxford Street", "oxford street", ["Westminster"]],
  ["Bond Street", "bond street", ["Westminster"]],
  ["Park Lane", "park lane", ["Westminster"]],
  ["Mayfair", "mayfair", ["Westminster"]],
];

const PUB_WORDS = "(?:pub|inn|tavern|hotel)";
const TRAILING_PUB_WORDS = new RegExp(` ${PUB_WORDS}(?: and ${PUB_WORDS})?$`);
const TRAILING_POSTCODE = / [a-z]{1,2}\d{1,2}[a-z]?$/;
const LEADING_WORDS = /^(?:(?:the|ye|old|olde) )+/;

function fold(text: string): string {
  return text
    .toLowerCase()
    .replace(/[’‘`´']/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The name on a pub's sign with the extras taken off: "The", "Ye Olde" and
 * "Old" in front; a place after a comma, a dash or in brackets; a trailing
 * postcode or borough; and a trailing "Inn", "Tavern", "Pub" or "Hotel". So
 * "Ye Olde Red Lion", "Kings Head Harrow" and "Ship Tavern, London" read as
 * "red lion", "kings head" and "ship", while "Red Lion & Sun" and "Ship
 * Aground" stay different pubs.
 */
export function namePlate(name: string, borough = ""): string {
  let plate = fold(name.replace(/\s*\([^)]*\)/g, "").split(/,| - | – /)[0] ?? "");
  const place = fold(borough);
  if (place && plate.endsWith(` ${place}`)) plate = plate.slice(0, -place.length - 1);
  plate = plate.replace(TRAILING_POSTCODE, "").replace(TRAILING_PUB_WORDS, "");
  return plate.replace(LEADING_WORDS, "").trim();
}

function pubLabel(venue: ChallengeVenue, district: string | null): string {
  const where = [venue.borough, district].filter(Boolean).join(" ");
  return where ? `${venue.name}, ${where}` : venue.name;
}

function monopolyTargets(venues: readonly ChallengeVenue[], pubs: readonly ChallengeVenue[]): ChallengeTarget[] {
  return MONOPOLY_STREETS.flatMap(([street, streetAddress, boroughs]) => {
    const onStreet = (pub: ChallengeVenue) => {
      if (!boroughs.includes(pub.borough ?? "")) return false;
      const name = fold(pub.sourceName ?? pub.name);
      let address = fold(pub.searchText ?? "");
      if (!address.startsWith(`${name} `)) return false;
      address = address.slice(name.length + 1);
      address = address.replace(/\brd\b/g, "road").replace(/\bst\b/g, "street").replace(/\bave\b/g, "avenue");
      return ` ${address} `.includes(` ${streetAddress} `);
    };
    const point = (venue: ChallengeVenue): [number, number] | null =>
      Number.isFinite(venue.lat) && Number.isFinite(venue.lng) ? [venue.lng!, venue.lat!] : null;
    const anchors = venues.filter(onStreet).map(point).filter((value) => value !== null);
    const choices = pubs.flatMap((pub) => {
      if (onStreet(pub)) return [{ pub, distance: 0 }];
      const location = point(pub);
      if (!location || !anchors.length) return [];
      const distance = Math.min(...anchors.map((anchor) => haversineKm(anchor, location)));
      return distance <= 0.15 ? [{ pub, distance }] : [];
    });
    const venue = choices.sort((a, b) => a.distance - b.distance || a.pub.id.localeCompare(b.pub.id, "en-GB"))[0]?.pub;
    return venue ? [{ label: `${street}: ${venue.name}`, venueIds: [venue.id], mapVenueId: venue.id }] : [];
  });
}

/** Every challenge's targets, from the pubs we list in London. */
export function buildChallengeSet(venues: readonly ChallengeVenue[]): ChallengeSet {
  const pubs = venues.filter((venue) => venue.id && (venue.kind === undefined || venue.kind === "pub"));
  const districts = londonDistricts(pubs);
  const districtOf = new Map<string, string>();
  for (const [district, ids] of districts) for (const id of ids) districtOf.set(id, district);

  const set = new Map<ChallengeId, ChallengeTarget[]>();
  for (const [id, plate] of NAMED) {
    const seen = new Set<string>();
    const targets = pubs
      .filter((venue) => namePlate(venue.name, venue.borough) === plate && !seen.has(venue.id) && seen.add(venue.id))
      .map((venue) => ({
        label: pubLabel(venue, districtOf.get(venue.id) ?? null),
        venueIds: [venue.id],
        mapVenueId: venue.id,
      }))
      .sort((a, b) => a.label.localeCompare(b.label, "en-GB"));
    set.set(id, targets);
  }
  const trades = [...new Map(pubs.filter((pub) => TRADES.has(namePlate(pub.name, pub.borough)))
    .map((pub) => [pub.id, pub])).values()];
  set.set("trades", trades.map((pub) => ({
    label: pubLabel(pub, districtOf.get(pub.id) ?? null), venueIds: [pub.id], mapVenueId: pub.id,
  })).sort((a, b) => a.label.localeCompare(b.label, "en-GB")));
  set.set("monopoly", monopolyTargets(venues, pubs));
  set.set(
    "every-district",
    [...districts]
      .map(([district, ids]) => ({ label: district, venueIds: [...ids] }))
      .sort((a, b) => a.label.localeCompare(b.label, "en-GB", { numeric: true })),
  );
  return set;
}

// ── The challenge of the month ──────────────────────────────────────────────

const MONTH_KEY = /^(\d{4})-(\d{2})$/;

/**
 * The challenge of the month for a London month ("2026-11"): a fixed turn
 * through the challenges, so every month has one and nobody picks it.
 */
export function challengeOfTheMonth(monthKey: string): ChallengeId | null {
  const match = MONTH_KEY.exec(monthKey);
  if (!match) return null;
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  const months = Number(match[1]) * 12 + month - 1;
  return CHALLENGE_IDS[months % CHALLENGE_IDS.length]!;
}

/** The challenge of the month in London at `at`. */
export function challengeOfTheMonthAt(at: Date): ChallengeId | null {
  return challengeOfTheMonth(londonDayKey(at).slice(0, 7));
}

// ── Progress ────────────────────────────────────────────────────────────────

/**
 * Progress on every challenge. `visited` holds the Been list's current venue
 * ids. `firstLoggedAt` gives the timestamp a pub was first logged, if known.
 * An unknown first timestamp can hide an earlier completion, so it must
 * leave the finish date unknown. See README.md's profile features for bonus rules.
 */
export function challengeProgress(
  set: ChallengeSet,
  visited: ReadonlySet<string>,
  firstLoggedAt: (venueId: string) => string | null,
): ChallengeProgress[] {
  return CHALLENGE_IDS.map((id) => {
    const targets = set.get(id) ?? [];
    const left: ChallengeLeft[] = [];
    const doneIn: Array<string | null> = [];
    for (const target of targets) {
      const months = target.venueIds.filter((venueId) => visited.has(venueId)).map(firstLoggedAt);
      if (!months.length) {
        left.push(target.mapVenueId ? { label: target.label, venueId: target.mapVenueId } : { label: target.label });
        continue;
      }
      // An undated pub may be the earliest sighting, so its target's first
      // timestamp must stay unknown even when another pub has a date.
      doneIn.push(months.every(Boolean) ? (months as string[]).sort()[0]! : null);
    }
    const total = targets.length;
    const finished = total > 0 && left.length === 0;
    const finishedAt = finished && doneIn.every(Boolean) ? (doneIn as string[]).sort().at(-1) ?? null : null;
    const finishMonth = finishedAt ? londonDayKey(new Date(finishedAt)).slice(0, 7) : undefined;
    const doubled = finished && finishMonth !== undefined && challengeOfTheMonth(finishMonth) === id;
    return { id, done: total - left.length, total, finished, doubled, finishedAt, left };
  });
}

// ── Copy ────────────────────────────────────────────────────────────────────

export const CHALLENGE_COPY = {
  kicker: "Challenges",
  title: "Your challenges",
  titles: {
    "red-lion": "Every Red Lion",
    "kings-head": "Every King's Head",
    ship: "Every Ship",
    "every-district": "One pub in every postcode district",
    trades: "Pubs named after trades",
    monopoly: "The London Monopoly board",
  } satisfies Record<ChallengeId, string>,
  deks: {
    "red-lion": "Every pub called the Red Lion that we list in London.",
    "kings-head": "Every pub called the King's Head that we list in London.",
    ship: "Every pub called the Ship that we list in London.",
    "every-district": "One pub in each London postcode district where we list a pub.",
    trades: "The Bricklayers Arms, Carpenters Arms and other trade names on our London pub list.",
    monopoly: "One listed pub on each street, or within 150 metres of a listed address there. Streets we cannot place are left out.",
  } satisfies Record<ChallengeId, string>,
  units: {
    "red-lion": "pubs",
    "kings-head": "pubs",
    ship: "pubs",
    "every-district": "districts",
    trades: "pubs",
    monopoly: "streets",
  } satisfies Record<ChallengeId, string>,
  monthly: "Challenge of the month. Finish it this month for double points.",
  doubled: "Finished in its month. Double points.",
  finished: "Finished.",
  leftTitle: "Still to do",
  fence: "Counts come from the pubs we list. A pub counts once it is on your Been list.",
} as const;
