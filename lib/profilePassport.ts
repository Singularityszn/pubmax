// The profile passport: the Been list, the explicit overlap with a mate, the
// taste card in stored facts, and the top-ten share. Round 2 of the Beli parity
// ledger (docs/plans/WEEK1_HYGIENE_BUILD_2026-10-30.md section 2).
//
// A PURE LEAF. It imports no store and no React, so the browser components and
// the server reads share one set of rules and cannot drift.
//
// THE FENCES (ADR 0017, docs/MASTER_PRD.md):
//   - No aggregate score, no leaderboard, no streak, no match percentage. The
//     overlap is two lists of pub names, sorted by name so it shows neither
//     person's order.
//   - The diary and a completed plan are private (lib/diary.ts has one
//     visibility, "private"). Only the owner's own Been read carries them. A
//     mate or a reader of a public account sees the Pint Drops the drop store
//     already lets them read, and nothing else.
//   - The taste card holds stored facts with a date. No inference and no
//     personality word. An empty line is left out and an empty card is no card.
//   - The share card carries names in rank order and nothing else: no score,
//     no band word, no figure but the place.

import { londonDayKey } from "@/lib/pintContributions";

const BEEN_SOURCES = ["diary", "pint_drop", "plan"] as const;
export type BeenSource = (typeof BEEN_SOURCES)[number];

/** One record that the owner was at a pub on a London day. */
export type BeenSighting = {
  venueId: string;
  venueName: string;
  /** London calendar day, YYYY-MM-DD. */
  date: string;
  source: BeenSource;
};

/** One pub in the Been list: every sighting of it folded into one row. */
export type BeenVenue = {
  venueId: string;
  venueName: string;
  /** The latest London day any source puts the owner there. */
  lastDate: string;
  /** Which records say so, in BEEN_SOURCES order. */
  sources: BeenSource[];
};

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

/** A YYYY-MM-DD day for a stored day or an ISO instant, or "" when unreadable. */
export function passportDay(value: string | null | undefined): string {
  if (typeof value !== "string" || !value) return "";
  if (DAY_KEY.test(value)) return value;
  return londonDayKey(value);
}

/**
 * Fold the three sources into one row per pub. A pub logged in the diary, in a
 * drop and on a plan is ONE pub you have been to, so the count is distinct
 * venues, never records. Newest day first, then name.
 */
export function aggregateBeen(sightings: readonly BeenSighting[]): BeenVenue[] {
  const byVenue = new Map<string, { row: BeenVenue; nameDate: string }>();
  for (const sighting of sightings) {
    const venueId = sighting.venueId?.trim();
    const date = passportDay(sighting.date);
    if (!venueId || !date) continue;
    const name = sighting.venueName?.trim() ?? "";
    const held = byVenue.get(venueId);
    if (!held) {
      byVenue.set(venueId, {
        row: { venueId, venueName: name, lastDate: date, sources: [sighting.source] },
        nameDate: name ? date : "",
      });
      continue;
    }
    if (date > held.row.lastDate) held.row.lastDate = date;
    if (!held.row.sources.includes(sighting.source)) held.row.sources.push(sighting.source);
    // The newest record that carries a name names the row.
    if (name && date >= held.nameDate) {
      held.row.venueName = name;
      held.nameDate = date;
    }
  }
  return [...byVenue.values()]
    .map(({ row }) => ({
      ...row,
      sources: BEEN_SOURCES.filter((source) => row.sources.includes(source)),
    }))
    .sort(
      (a, b) =>
        b.lastDate.localeCompare(a.lastDate) ||
        a.venueName.localeCompare(b.venueName) ||
        a.venueId.localeCompare(b.venueId),
    );
}

// ── Who may read what ────────────────────────────────────────────────────────

/** What the reader of a request is to the profile, decided from the bearer. */
export type PassportRelation = "owner" | "mate" | "stranger";

export type PassportRead = "been" | "overlap" | "taste";

/**
 * `full` is the owner's own read. `shared` is what a mate, or any reader of a
 * public account, may hold. `none` is a refusal.
 */
export type PassportAccess = "full" | "shared" | "none";

export function passportAccess(
  read: PassportRead,
  relation: PassportRelation,
  accountPrivate: boolean,
): PassportAccess {
  switch (read) {
    case "been":
      if (relation === "owner") return "full";
      if (relation === "mate") return "shared";
      return accountPrivate ? "none" : "shared";
    case "overlap":
      // Two people's lists side by side are a thing only mates share.
      return relation === "mate" ? "full" : "none";
    case "taste":
      return relation === "owner" ? "full" : "none";
  }
}

/** The sources a Been read may fold in at each access. */
export function beenSourcesFor(access: PassportAccess): readonly BeenSource[] {
  if (access === "full") return BEEN_SOURCES;
  if (access === "shared") return ["pint_drop"];
  return [];
}

// ── Explicit overlap ─────────────────────────────────────────────────────────

export type PassportVenue = { venueId: string; venueName: string };

/** A ranked pub, place 1 first. */
export type RankedVenue = PassportVenue & { place: number };

const OVERLAP_TOP = 5;

function byName(a: PassportVenue, b: PassportVenue): number {
  return a.venueName.localeCompare(b.venueName) || a.venueId.localeCompare(b.venueId);
}

function topOf(list: readonly RankedVenue[], count: number): RankedVenue[] {
  return [...list].sort((a, b) => a.place - b.place).slice(0, count);
}

/**
 * Pubs both of you put in your top five. Sorted by name, so the row says the
 * pub is in both lists and never where it sits in either one.
 */
export function sharedTopFive(
  viewer: readonly RankedVenue[],
  owner: readonly RankedVenue[],
): PassportVenue[] {
  const mine = new Set(topOf(viewer, OVERLAP_TOP).map((venue) => venue.venueId));
  return topOf(owner, OVERLAP_TOP)
    .filter((venue) => mine.has(venue.venueId))
    .map(({ venueId, venueName }) => ({ venueId, venueName }))
    .sort(byName);
}

/** Pubs on both Want-to-try lists, sorted by name. Pending pastes never match. */
export function sharedWantToTry(
  viewer: readonly PassportVenue[],
  owner: readonly PassportVenue[],
): PassportVenue[] {
  const mine = new Set(viewer.map((venue) => venue.venueId).filter(Boolean));
  const seen = new Set<string>();
  const out: PassportVenue[] = [];
  for (const venue of owner) {
    if (!venue.venueId || !mine.has(venue.venueId) || seen.has(venue.venueId)) continue;
    seen.add(venue.venueId);
    out.push({ venueId: venue.venueId, venueName: venue.venueName });
  }
  return out.sort(byName);
}

// ── Your taste, in facts ─────────────────────────────────────────────────────

type TasteFactKey = "drink" | "borough" | "era" | "fair_pint";

export type TasteFact = {
  key: TasteFactKey;
  label: string;
  value: string;
  /** The London day the fact was stored, YYYY-MM-DD. */
  date: string;
};

type TasteRankedVenue = RankedVenue & {
  borough: string | null;
  /** The heritage record's own date label ("Built 1729"), or null. */
  dateLabel: string | null;
  /** When this place in the list was stored. */
  updatedAt: string;
};

export type TasteInput = {
  /** The owner's own drops: the drink they logged and when. */
  drinks: ReadonlyArray<{ drink: string; date: string }>;
  ranked: readonly TasteRankedVenue[];
  fairPint: { pence: number; date: string } | null;
};

export const TASTE_COPY = {
  title: "Your taste, in facts",
  drink: "Most logged drink",
  borough: "The borough you rank highest",
  era: "Dates on the pubs in your top five",
  fairPint: "Your fair pint",
} as const;

function times(count: number): string {
  return count === 1 ? "logged once" : `logged ${count} times`;
}

function pounds(pence: number): string {
  return `£${(pence / 100).toFixed(2).replace(/\.00$/, "")}`;
}

/**
 * Each line is a stored fact with its day. Nothing is guessed: a line with no
 * record behind it is left out, and no records at all is an empty list, which
 * the card reads as "do not render".
 */
export function buildTasteFacts(input: TasteInput): TasteFact[] {
  const facts: TasteFact[] = [];

  const tally = new Map<string, { drink: string; count: number; date: string }>();
  for (const entry of input.drinks) {
    const drink = entry.drink?.trim();
    const date = passportDay(entry.date);
    if (!drink || !date) continue;
    const key = drink.toLocaleLowerCase("en-GB");
    const held = tally.get(key);
    if (!held) tally.set(key, { drink, count: 1, date });
    else {
      held.count += 1;
      if (date > held.date) {
        held.date = date;
        held.drink = drink;
      }
    }
  }
  const top = [...tally.values()].sort(
    (a, b) => b.count - a.count || b.date.localeCompare(a.date) || a.drink.localeCompare(b.drink),
  )[0];
  if (top) {
    facts.push({ key: "drink", label: TASTE_COPY.drink, value: `${top.drink}, ${times(top.count)}`, date: top.date });
  }

  const ordered = [...input.ranked].sort((a, b) => a.place - b.place);
  const first = ordered[0];
  const firstDay = passportDay(first?.updatedAt);
  if (first?.borough?.trim() && firstDay) {
    facts.push({
      key: "borough",
      label: TASTE_COPY.borough,
      value: `${first.borough.trim()}, where your number one, ${first.venueName}, stands`,
      date: firstDay,
    });
  }

  const dated = ordered
    .slice(0, OVERLAP_TOP)
    .filter((venue) => venue.dateLabel?.trim() && passportDay(venue.updatedAt));
  if (dated.length) {
    const date = dated.map((venue) => passportDay(venue.updatedAt)).sort().at(-1) ?? "";
    facts.push({
      key: "era",
      label: TASTE_COPY.era,
      value: dated.map((venue) => `${venue.venueName}: ${venue.dateLabel!.trim()}`).join("; "),
      date,
    });
  }

  const fairDay = passportDay(input.fairPint?.date);
  if (input.fairPint && Number.isFinite(input.fairPint.pence) && input.fairPint.pence > 0 && fairDay) {
    facts.push({ key: "fair_pint", label: TASTE_COPY.fairPint, value: pounds(input.fairPint.pence), date: fairDay });
  }

  return facts;
}

// ── The top-ten share ────────────────────────────────────────────────────────

export const TOP_TEN = 10;

/** The first ten of the owner's list, place 1 first, names only. */
export function topTenForShare(ranked: readonly RankedVenue[]): RankedVenue[] {
  return topOf(ranked, TOP_TEN)
    .filter((venue) => venue.venueId)
    .map((venue, index) => ({ venueId: venue.venueId, venueName: venue.venueName, place: index + 1 }));
}

/** The heading of the shared page and card. */
export function topTenTitle(handle: string): string {
  return `@${handle}'s top ten, in their order`;
}

// ── Copy ────────────────────────────────────────────────────────────────────

export const PASSPORT_COPY = {
  cover: "Passport",
  been: "Been",
  wantToTry: "Want to try",
  fairPint: "Fair pint",
  patch: "Patch",
  beenTitle: "Been",
  beenEmptyOwner: "Log a visit in your diary or drop a pint, and the pub lands here.",
  beenEmptyOther: "No pubs here yet.",
  showOnMap: "Show on the map",
  rankedTitle: "Your pubs, ranked",
  rankedLine: "Only you see this list.",
  rankedEmpty: "Rank a pub from its page and your list starts here.",
  share: "Share your top ten",
  shareReady: "Link copied.",
  shareFailed: "That link did not work. Try again.",
  overlapTop: "Pubs you both rank in your top five",
  overlapWanted: "Pubs you both want to try",
  sourceLabel: {
    diary: "Diary",
    pint_drop: "Pint Drop",
    plan: "Plan",
  } satisfies Record<BeenSource, string>,
} as const;

/** "Mon, 4 Oct 2026" style day for a YYYY-MM-DD key. */
export function passportDayLabel(day: string): string {
  const parsed = Date.parse(`${day}T12:00:00Z`);
  if (!Number.isFinite(parsed)) return day;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(parsed));
}
