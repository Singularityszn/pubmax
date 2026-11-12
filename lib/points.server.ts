import "server-only";

// The points read: a person's own records, counted by lib/points.ts.
//
// readPointsBreakdown is the one server function that answers "how many points
// has this account, and from what". It takes no request, so a later
// leaderboard or league can call it for any account it may show. The profile
// card asks through readProfilePoints, which lets the owner alone read it.
//
// Failed record reads contribute zero. A failed record, district or alias
// read marks the answer degraded, including the identity fallback for aliases.

import { callerUserId } from "@/lib/authServer";
import { getCity } from "@/lib/cities";
import { pintDropsStore } from "@/lib/pintDropsStore";
import {
  buildPointsBreakdown,
  finishedDistricts,
  finishedLetterAreas,
  londonDistricts,
  type PointsBreakdown,
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

/** The owner's points and level, from their own records. */
export async function readPointsBreakdown(
  owner: PointsOwner,
  deps: PointsDeps = defaultPointsDeps(),
): Promise<PointsBreakdown> {
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

  const venues = await foldBeenVenues(
    { diary: diary.value, drops: drops.value, plans: plans.value, beenHere: beenHere.value },
    canonical.value,
    deps,
  );
  const finished = finishedDistricts(districts.value, new Set(venues.map((venue) => venue.venueId)));
  const priced = drops.value.filter((drop) => drop.priced);
  const degraded = [diary, drops, plans, beenHere, added, fixed, reviews, districts, canonical].some((read) => read.failed);

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
    },
    finished,
    degraded ? "degraded" : "ready",
  );
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
    addedPubs: (ownerUserId) => venueSubmissionStore().countAcceptedForOwner(ownerUserId),
    fixedPubs: (ownerUserId) => venueCorrectionsStore().countResolvedForOwner(ownerUserId),
    drinkReviews: (ownerHandle) => ratingsStore().countDrinkReviews(ownerHandle),
    londonDistricts: readLondonDistricts,
  };
}
