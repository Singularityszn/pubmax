import "server-only";

// The points read: a person's own records, counted by lib/points.ts.
//
// Failed record reads contribute zero. A failed record, district, challenge
// or alias read marks the answer degraded, including the identity fallback for
// aliases.

import { callerUserId } from "@/lib/authServer";
import {
  buildChallengeSet,
  challengeOfTheMonthAt,
  challengeProgress,
  type ChallengeSet,
} from "@/lib/challenges";
import { getCity } from "@/lib/cities";
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
  /** Pubs the owner sent in that a person accepted. */
  addedPubs(ownerUserId: string): Promise<number>;
  /** Fixes the owner sent that a person resolved. */
  fixedPubs(ownerUserId: string): Promise<number>;
  drinkReviews(ownerHandle: string): Promise<number>;
  /** The pubs we list in each London postcode district. */
  londonDistricts(): Promise<ReadonlyMap<string, readonly string[]>>;
  /** Every challenge's targets, from the pubs we list in London. */
  challenges(): Promise<ChallengeSet>;
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

function loggedAt(value: string | undefined): string | null {
  if (!value || !(Date.parse(value) > 0)) return null;
  return new Date(value).toISOString();
}

function firstLoggedDates(
  rows: ReadonlyArray<{ venueId: string; date: string | null }>,
  canonical: (venueId: string) => string,
): (venueId: string) => string | null {
  const first = new Map<string, string | null>();
  for (const row of rows) {
    const id = canonical(row.venueId);
    const held = first.get(id);
    if (held === null) continue;
    first.set(id, row.date === null ? null : held && held < row.date ? held : row.date);
  }
  return (venueId) => first.get(venueId) ?? null;
}

/** The owner's points and level, from their own records. */
export async function readPointsBreakdown(
  owner: PointsOwner,
  deps: PointsDeps = defaultPointsDeps(),
): Promise<PointsBreakdown> {
  const handle = normalizeHandle(owner.handle);
  const userId = owner.userId?.trim() || "";
  const [diary, drops, plans, beenHere, added, fixed, reviews, districts, challengeSet, canonical] = await Promise.all([
    userId ? settle(() => deps.diary(userId), []) : none([]),
    handle ? settle(() => deps.drops(handle), [] as PointsDrop[]) : none([] as PointsDrop[]),
    userId ? settle(() => deps.plans(userId), []) : none([]),
    handle ? settle(() => deps.beenHere(handle), []) : none([]),
    userId ? settle(() => deps.addedPubs(userId), 0) : none(0),
    userId ? settle(() => deps.fixedPubs(userId), 0) : none(0),
    handle ? settle(() => deps.drinkReviews(handle), 0) : none(0),
    settle(() => deps.londonDistricts(), new Map<string, readonly string[]>() as ReadonlyMap<string, readonly string[]>),
    settle(() => deps.challenges(), new Map() as ChallengeSet),
    settle(() => deps.venueAliases(), (venueId: string) => venueId),
  ]);

  const venues = await foldBeenVenues(
    { diary: diary.value, drops: drops.value, plans: plans.value, beenHere: beenHere.value },
    canonical.value,
    deps,
  );
  const visited = new Set(venues.map((venue) => venue.venueId));
  const finished = finishedDistricts(districts.value, visited);
  const priced = drops.value.filter((drop) => drop.priced);
  const degraded = [diary, drops, plans, beenHere, added, fixed, reviews, districts, challengeSet, canonical].some(
    (read) => read.failed,
  );
  const completeHistory = [diary, drops, plans, beenHere, canonical].every((read) => !read.failed);
  const logged = firstLoggedDates(
    [
      ...[...diary.value, ...plans.value].map((row) => ({ venueId: row.venueId, date: loggedAt(row.date) })),
      ...drops.value.map((drop) => ({ venueId: drop.venueId, date: loggedAt(drop.createdAt) })),
      ...beenHere.value.map((row) => ({ venueId: row.venueId, date: loggedAt(row.savedAt) })),
    ],
    canonical.value,
  );
  const challenges = challengeProgress(challengeSet.value, visited, completeHistory ? logged : () => null);

  return buildPointsBreakdown(
    {
      been: venues.length,
      priceLogged: priced.length,
      drinkReview: reviews.value,
      priceChecked: priced.filter((drop) => drop.checked).length,
      district: finished.length,
      letterArea: finishedLetterAreas(districts.value, finished).length,
      pubAdded: added.value,
      pubFixed: fixed.value,
      challenge: challenges.filter((challenge) => challenge.finished).length,
      challengeDoubled: challenges.filter((challenge) => challenge.doubled).length,
    },
    finished,
    degraded ? "degraded" : "ready",
    { progress: challenges, ofTheMonth: challengeOfTheMonthAt(new Date()) },
  );
}

export async function readPointsStanding(
  owner: PointsOwner,
  deps: PointsDeps = defaultPointsDeps(),
): Promise<PointsStanding> {
  const { status, total, level } = await readPointsBreakdown(owner, deps);
  return { status, total, level };
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

function londonIndexRead<T>(build: (index: Map<string, IndexedVenue>) => T): () => Promise<T> {
  const byIndex = new WeakMap<Map<string, IndexedVenue>, T>();
  return async () => {
    const index = await readCityVenueIndex(getCity("london"));
    if (!index) throw new Error("London venues unavailable");
    if (byIndex.has(index)) return byIndex.get(index)!;
    const built = build(index);
    byIndex.set(index, built);
    return built;
  };
}

const londonVenues = (index: Map<string, IndexedVenue>) =>
  [...index.values()].map(({ slimVenue }) => ({
    id: slimVenue.id,
    name: slimVenue.name,
    sourceName: slimVenue.sourceName,
    lat: slimVenue.lat,
    lng: slimVenue.lng,
    kind: slimVenue.kind,
    borough: slimVenue.borough,
    searchText: slimVenue.filterHints?.searchText,
  }));

const readLondonDistricts = londonIndexRead((index) => londonDistricts(londonVenues(index)));
const readChallengeSet = londonIndexRead((index) => buildChallengeSet(londonVenues(index)));

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
    addedPubs: (ownerUserId) => venueSubmissionStore().countAcceptedForOwner(ownerUserId),
    fixedPubs: (ownerUserId) => venueCorrectionsStore().countResolvedForOwner(ownerUserId),
    drinkReviews: (ownerHandle) => ratingsStore().countDrinkReviews(ownerHandle),
    londonDistricts: readLondonDistricts,
    challenges: readChallengeSet,
  };
}
