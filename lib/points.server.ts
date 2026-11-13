import "server-only";

// The points read: a person's own records, counted by lib/points.ts.
//
// readPointsBreakdown is the one server function that answers "how many points
// has this account, and from what". It takes no request, so the mates' board
// (lib/matesBoard.server.ts) can call it for any account it may show. The
// profile card asks through readProfilePoints, which lets the owner alone read
// it. readPointsStanding adds what the same records earned this month.
//
// Failed record reads contribute zero. A failed record, district or alias
// read marks the answer degraded, including the identity fallback for aliases.

import { callerUserId } from "@/lib/authServer";
import { getCity } from "@/lib/cities";
import { londonWallClockInstant } from "@/lib/lastOrders";
import { pintDropsStore } from "@/lib/pintDropsStore";
import {
  buildPointsBreakdown,
  finishedDistricts,
  finishedLetterAreas,
  londonDistricts,
  type PointsBreakdown,
  type PointsStanding,
} from "@/lib/points";
import {
  defaultPassportDeps,
  foldBeenVenues,
  type PassportDeps,
  type PassportResult,
} from "@/lib/profilePassport.server";
import { passportDay, type BeenSighting, type PassportVenue } from "@/lib/profilePassport";
import { normalizeHandle } from "@/lib/profiles";
import type { ProfileRecord } from "@/lib/profileStore";
import { ratingsStore } from "@/lib/ratingsStore";
import { loadVenueAliasResolver } from "@/lib/venueAliases";
import { venueCorrectionsStore } from "@/lib/venueCorrectionsStore";
import { readCityVenueIndex, type IndexedVenue } from "@/lib/venueIndex";
import { venueSubmissionStore } from "@/lib/venueSubmissionStore";

/** One of the owner's own Pint Drops, as the points read needs it. */
type PointsDrop = { venueId: string; createdAt: string; priced: boolean; checked: boolean };

export type PointsDeps = Pick<
  PassportDeps,
  "verifyCaller" | "profiles" | "withdrawn" | "diary" | "plans" | "beenHere" | "venue" | "venueAliases"
> & {
  /** The owner's own drops, read as the owner. */
  drops(ownerHandle: string): Promise<PointsDrop[]>;
  /** Pubs the owner sent in that a person accepted, at or after `since` when given. */
  addedPubs(ownerUserId: string, since?: string): Promise<number>;
  /** Fixes the owner sent that a person resolved, at or after `since` when given. */
  fixedPubs(ownerUserId: string, since?: string): Promise<number>;
  drinkReviews(ownerHandle: string): Promise<number>;
  /** The pubs we list in each London postcode district. */
  londonDistricts(): Promise<ReadonlyMap<string, readonly string[]>>;
};

type PointsOwner = Pick<ProfileRecord, "handle" | "userId">;

async function settle<T>(read: () => Promise<T>, fallback: T): Promise<{ value: T; failed: boolean }> {
  try {
    return { value: await read(), failed: false };
  } catch {
    return { value: fallback, failed: true };
  }
}

const none = <T>(value: T) => settle(async () => value, value);

/** Every record that earns points, read once. */
type PointsRecords = {
  diary: BeenSighting[];
  drops: PointsDrop[];
  plans: BeenSighting[];
  beenHere: PassportVenue[];
  added: number;
  fixed: number;
  reviews: number;
  districts: ReadonlyMap<string, readonly string[]>;
  canonical: (venueId: string) => string;
  degraded: boolean;
};

async function readPointsRecords(owner: PointsOwner, deps: PointsDeps): Promise<PointsRecords> {
  const handle = normalizeHandle(owner.handle);
  const userId = owner.userId?.trim() || "";
  const [diary, drops, plans, beenHere, added, fixed, reviews, districts, canonical] = await Promise.all([
    userId ? settle(() => deps.diary(userId), []) : none([]),
    handle ? settle(() => deps.drops(handle), [] as PointsDrop[]) : none([] as PointsDrop[]),
    userId ? settle(() => deps.plans(userId), []) : none([]),
    handle ? settle(() => deps.beenHere(handle), []) : none([]),
    userId ? settle(() => deps.addedPubs(userId), 0) : none(0),
    userId ? settle(() => deps.fixedPubs(userId), 0) : none(0),
    handle ? settle(() => deps.drinkReviews(handle), 0) : none(0),
    settle(() => deps.londonDistricts(), new Map<string, readonly string[]>() as ReadonlyMap<string, readonly string[]>),
    settle(() => deps.venueAliases(), (venueId: string) => venueId),
  ]);
  return {
    diary: diary.value,
    drops: drops.value,
    plans: plans.value,
    beenHere: beenHere.value,
    added: added.value,
    fixed: fixed.value,
    reviews: reviews.value,
    districts: districts.value,
    canonical: canonical.value,
    degraded: [diary, drops, plans, beenHere, added, fixed, reviews, districts, canonical].some((read) => read.failed),
  };
}

async function countPoints(records: PointsRecords, deps: PointsDeps): Promise<PointsBreakdown> {
  const venues = await foldBeenVenues(
    { diary: records.diary, drops: records.drops, plans: records.plans, beenHere: records.beenHere },
    records.canonical,
    deps,
  );
  const finished = finishedDistricts(records.districts, new Set(venues.map((venue) => venue.venueId)));
  const priced = records.drops.filter((drop) => drop.priced);

  return buildPointsBreakdown(
    {
      been: venues.length,
      priceLogged: priced.length,
      drinkReview: records.reviews,
      priceChecked: priced.filter((drop) => drop.checked).length,
      district: finished.length,
      letterArea: finishedLetterAreas(records.districts, finished).length,
      pubAdded: records.added,
      pubFixed: records.fixed,
    },
    finished,
    records.degraded ? "degraded" : "ready",
  );
}

/** The owner's points and level, from their own records. */
export async function readPointsBreakdown(
  owner: PointsOwner,
  deps: PointsDeps = defaultPointsDeps(),
): Promise<PointsBreakdown> {
  return countPoints(await readPointsRecords(owner, deps), deps);
}

/** The London day a stored instant falls on, or "" when it cannot be read. */
function recordDay(value: string): string {
  return Number.isFinite(Date.parse(value)) ? passportDay(value) : "";
}

/**
 * The owner's total and level, and the points their records earned since
 * `monthStart` (a London day, YYYY-MM-01).
 *
 * This month's points are the total less what the same records earned before
 * the month began. A record counts this month only when it carries a date we
 * trust inside the month: a diary visit, a finished plan, a Pint Drop, or a
 * pub added or fixed that a person accepted this month. A Been here save has
 * no date, and a drink review keeps only its latest re-rate, so both count all
 * time and never this month. A district counts this month when this month's
 * records finished it. A price checked counts in the month its drop was logged.
 */
export async function readPointsStanding(
  owner: PointsOwner,
  monthStart: string,
  deps: PointsDeps = defaultPointsDeps(),
): Promise<PointsStanding> {
  const userId = owner.userId?.trim() || "";
  const since = new Date(londonWallClockInstant(monthStart, 0)).toISOString();
  const [records, addedSince, fixedSince] = await Promise.all([
    readPointsRecords(owner, deps),
    userId ? settle(() => deps.addedPubs(userId, since), 0) : none(0),
    userId ? settle(() => deps.fixedPubs(userId, since), 0) : none(0),
  ]);
  const before: PointsRecords = {
    ...records,
    diary: records.diary.filter((sighting) => sighting.date < monthStart),
    plans: records.plans.filter((sighting) => sighting.date < monthStart),
    drops: records.drops.filter((drop) => recordDay(drop.createdAt) < monthStart),
    added: Math.max(0, records.added - addedSince.value),
    fixed: Math.max(0, records.fixed - fixedSince.value),
  };
  const [all, earlier] = await Promise.all([countPoints(records, deps), countPoints(before, deps)]);
  return {
    status: all.status === "degraded" || addedSince.failed || fixedSince.failed ? "degraded" : "ready",
    total: all.total,
    level: all.level,
    monthTotal: Math.max(0, all.total - earlier.total),
  };
}

type PointsFailure = Extract<PassportResult<never>, { ok: false }>;

const NOT_FOUND: PointsFailure = { ok: false, status: 404, code: "NOT_FOUND", error: "No profile with that handle." };
const OWNER_ONLY: PointsFailure = { ok: false, status: 403, code: "OWNER_ONLY", error: "Only the owner sees this." };
const UNAVAILABLE: PointsFailure = {
  ok: false,
  status: 503,
  code: "STORE_UNAVAILABLE",
  error: "This is unavailable right now.",
};

/** GET /api/profiles/[handle]/points: the owner's own breakdown, and nobody else's. */
export async function readProfilePoints(
  request: Request,
  rawHandle: string,
  deps: PointsDeps = defaultPointsDeps(),
): Promise<PassportResult<PointsBreakdown>> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) return NOT_FOUND;
  let profile: ProfileRecord | null;
  try {
    if (await deps.withdrawn(request, handle)) return NOT_FOUND;
    profile = await deps.profiles.getByHandle(handle);
  } catch {
    return UNAVAILABLE;
  }
  if (!profile || profile.tombstonedAt) return NOT_FOUND;
  let caller: string | null;
  try {
    caller = (await deps.verifyCaller(request))?.trim() || null;
  } catch {
    caller = null;
  }
  const owner = profile.userId?.trim() || null;
  if (!caller || !owner || caller !== owner) return OWNER_ONLY;
  return { ok: true, body: await readPointsBreakdown(profile, deps) };
}

// ── The real stores ─────────────────────────────────────────────────────────

const districtsByIndex = new WeakMap<Map<string, IndexedVenue>, Map<string, string[]>>();

async function readLondonDistricts(): Promise<Map<string, string[]>> {
  const index = await readCityVenueIndex(getCity("london"));
  if (!index) throw new Error("London venues unavailable");
  const held = districtsByIndex.get(index);
  if (held) return held;
  const districts = londonDistricts(
    [...index.values()].map(({ slimVenue }) => ({
      id: slimVenue.id,
      kind: slimVenue.kind,
      searchText: slimVenue.filterHints?.searchText,
    })),
  );
  districtsByIndex.set(index, districts);
  return districts;
}

function defaultPointsDeps(): PointsDeps {
  const passport = defaultPassportDeps();
  return {
    verifyCaller: callerUserId,
    profiles: passport.profiles,
    withdrawn: passport.withdrawn,
    diary: passport.diary,
    plans: passport.plans,
    beenHere: passport.beenHere,
    venue: passport.venue,
    venueAliases: async () => {
      const aliases = await loadVenueAliasResolver();
      if (aliases.status === "unavailable") throw new Error("Venue aliases unavailable");
      return aliases.canonical;
    },
    async drops(ownerHandle) {
      const key = normalizeHandle(ownerHandle);
      const drops = await pintDropsStore().listOwnContributions(key);
      return drops.map((drop) => {
        const priced = typeof drop.priceGbp === "number" && Number.isFinite(drop.priceGbp);
        return {
          venueId: drop.venueId,
          createdAt: drop.createdAt,
          priced,
          checked: priced && (drop.priceEvidence === "receipt" || Boolean(drop.confirmation)),
        };
      });
    },
    addedPubs: (ownerUserId, since) => venueSubmissionStore().countAcceptedForOwner(ownerUserId, since),
    fixedPubs: (ownerUserId, since) => venueCorrectionsStore().countResolvedForOwner(ownerUserId, since),
    drinkReviews: (ownerHandle) => ratingsStore().countDrinkReviews(ownerHandle),
    londonDistricts: readLondonDistricts,
  };
}
