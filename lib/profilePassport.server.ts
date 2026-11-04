import "server-only";

// The three passport reads behind /api/profiles/[handle]/been, /overlap and
// /taste. The rules live in lib/profilePassport.ts; this module only answers
// "who is asking" and "what is stored", and every store sits behind a
// dependency so the visibility matrix is proved without a database.
//
// WHO IS ASKING comes from the bearer, never from a query parameter, by the
// rule lib/profileVisibilityBoundary.server.ts already keeps: the owner is the
// stored `profiles.user_id`, a mate is a mutual follow read from both edges,
// and every failure answers "stranger". A stranger reads less, never more.

import { accountIsPrivate } from "@/lib/accountVisibility";
import { callerUserId } from "@/lib/authServer";
import { BEEN_HERE_LIST } from "@/lib/beenHere";
import { diaryStore } from "@/lib/diaryStore";
import { isMutual, resolveFollowRelation } from "@/lib/followRelation";
import { followStore, type FollowStore } from "@/lib/followStore";
import { loadHistoricPubs } from "@/lib/historic";
import { getNightAreasForCity } from "@/lib/nightAreas";
import { nightProfileStore } from "@/lib/nightProfileStore";
import type { ViewerContext } from "@/lib/pintDropShared";
import { resolveViewerContextFromRequest } from "@/lib/pintDropViewer";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { handleWithdrawnFromCaller } from "@/lib/profileOwnership";
import {
  aggregateBeen,
  beenSourcesFor,
  buildTasteFacts,
  passportAccess,
  passportDay,
  sharedTopFive,
  sharedWantToTry,
  type BeenSighting,
  type BeenVenue,
  type PassportRelation,
  type PassportVenue,
  type RankedVenue,
  type TasteFact,
} from "@/lib/profilePassport";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore, type ProfileRecord, type ProfileStore } from "@/lib/profileStore";
import { socialPubRankingStore } from "@/lib/socialPubRankingStore";
import { socialPubRankingEntries } from "@/lib/socialPubRankings";
import { selectStore } from "@/lib/storeBackend";
import { storedVenueName } from "@/lib/storedVenueRef";
import { savedPubsStore } from "@/lib/savedPubsStore";
import { requireSupabaseAdmin } from "@/lib/supabase";
import { loadVenueAliasResolver } from "@/lib/venueAliases";
import { resolveStoredVenue } from "@/lib/venueIndex";
import { wantedStore } from "@/lib/wantedStore";

export type PassportRankedRow = RankedVenue & { updatedAt: string };
type PassportNightProfile = { patch: string | null };
type PassportVenueFacts = { name: string; borough: string | null };

export type PassportDeps = {
  verifyCaller(request: Request): Promise<string | null>;
  profiles: Pick<ProfileStore, "getByHandle" | "getByUserId">;
  follows: Pick<FollowStore, "isFollowing">;
  /** A withdrawn handle reads as an unknown one, except to its owner. */
  withdrawn(request: Request, handle: string): Promise<boolean>;
  /** The drop store's own reader context for this request. */
  dropViewer(request: Request): Promise<ViewerContext | undefined>;
  diary(ownerUserId: string): Promise<BeenSighting[]>;
  drops(authorHandle: string, viewer: ViewerContext | undefined): Promise<Array<{ venueId: string; drink: string; createdAt: string }>>;
  plans(ownerUserId: string): Promise<BeenSighting[]>;
  /** Open Want-to-try rows; a pending paste has an empty venue id. */
  wanted(profileId: string): Promise<PassportVenue[]>;
  /**
   * The owner's own "Been here" saved list (lib/beenHere.ts). Undated, so it
   * is asked for the owner's full read alone and never for anybody else.
   */
  beenHere(ownerHandle: string): Promise<PassportVenue[]>;
  rankings(profileId: string): Promise<PassportRankedRow[]>;
  nightProfile(ownerUserId: string): Promise<PassportNightProfile | null>;
  venue(venueId: string): Promise<PassportVenueFacts | null>;
  heritageDateLabel(venueId: string): Promise<string | null>;
  /**
   * The alias map as one function: a stored venue id to the id it names now.
   * A merged or superseded id and its successor are one pub, so every count,
   * ranking and intersection runs on the current id. The stores keep the id
   * each row was written under.
   */
  venueAliases(): Promise<(venueId: string) => string>;
};

type PassportFailure = { ok: false; status: 403 | 404 | 503; code: string; error: string };
export type PassportResult<T> = { ok: true; body: T } | PassportFailure;

export type BeenBody = {
  access: "full" | "shared";
  status: "ready" | "degraded";
  count: number;
  venues: BeenVenue[];
  /** Open Want-to-try rows, or null when that read failed. */
  wantToTryCount: number | null;
  /** The owner's own Night Profile line. Never sent to anybody else. */
  cover: { patch: string | null } | null;
};

export type OverlapBody = { topFive: PassportVenue[]; wantToTry: PassportVenue[] };
export type TasteBody = { facts: TasteFact[] };
export type RankedBody = { ranked: RankedVenue[] };

const NOT_FOUND: PassportFailure = { ok: false, status: 404, code: "NOT_FOUND", error: "No profile with that handle." };
const PRIVATE: PassportFailure = { ok: false, status: 403, code: "PRIVATE_ACCOUNT", error: "This account is private." };
const MATES_ONLY: PassportFailure = { ok: false, status: 403, code: "MATES_ONLY", error: "Only mates see this." };
const OWNER_ONLY: PassportFailure = { ok: false, status: 403, code: "OWNER_ONLY", error: "Only the owner sees this." };
const UNAVAILABLE: PassportFailure = { ok: false, status: 503, code: "STORE_UNAVAILABLE", error: "This is unavailable right now." };

type Viewer = { relation: PassportRelation; viewerProfile: ProfileRecord | null };

async function resolveViewer(request: Request, profile: ProfileRecord, deps: PassportDeps): Promise<Viewer> {
  const stranger: Viewer = { relation: "stranger", viewerProfile: null };
  let viewerUserId: string | null;
  try {
    viewerUserId = (await deps.verifyCaller(request))?.trim() || null;
  } catch {
    return stranger;
  }
  if (!viewerUserId) return stranger;
  const owner = profile.userId?.trim() || null;
  if (owner && owner === viewerUserId) return { relation: "owner", viewerProfile: profile };
  let viewerProfile: ProfileRecord | null;
  try {
    viewerProfile = await deps.profiles.getByUserId(viewerUserId);
  } catch {
    return stranger;
  }
  const viewerHandle = normalizeHandle(viewerProfile?.handle ?? "");
  if (!viewerProfile || !viewerHandle || viewerProfile.tombstonedAt) return stranger;
  try {
    const [viewerFollowing, followsViewer] = await Promise.all([
      deps.follows.isFollowing(viewerHandle, profile.handle),
      deps.follows.isFollowing(profile.handle, viewerHandle),
    ]);
    return isMutual(resolveFollowRelation({ viewerFollowing, followsViewer }))
      ? { relation: "mate", viewerProfile }
      : { relation: "stranger", viewerProfile };
  } catch {
    return stranger;
  }
}

async function loadProfile(
  request: Request,
  rawHandle: string,
  deps: PassportDeps,
): Promise<{ ok: true; profile: ProfileRecord } | PassportFailure> {
  const handle = normalizeHandle(rawHandle);
  if (!handle) return NOT_FOUND;
  try {
    if (await deps.withdrawn(request, handle)) return NOT_FOUND;
    const profile = await deps.profiles.getByHandle(handle);
    if (!profile || profile.tombstonedAt) return NOT_FOUND;
    return { ok: true, profile };
  } catch {
    return UNAVAILABLE;
  }
}

async function settle<T>(read: () => Promise<T>, fallback: T): Promise<{ value: T; failed: boolean }> {
  try {
    return { value: await read(), failed: false };
  } catch {
    return { value: fallback, failed: true };
  }
}

async function dropSightings(
  request: Request,
  profile: ProfileRecord,
  relation: PassportRelation,
  deps: PassportDeps,
): Promise<Array<{ venueId: string; drink: string; createdAt: string }>> {
  // The owner reads their own drops as themselves; anybody else reads them as
  // the drop store would let them on any public surface.
  const viewer = relation === "owner" ? { handle: profile.handle } : await deps.dropViewer(request);
  return deps.drops(profile.handle, viewer);
}

const identity = (venueId: string) => venueId;

/** The alias map, or the identity when it cannot be read. */
async function canonicalizer(deps: PassportDeps): Promise<(venueId: string) => string> {
  try {
    return await deps.venueAliases();
  } catch {
    return identity;
  }
}

function onCurrentIds<T extends { venueId: string }>(rows: readonly T[], canonical: (venueId: string) => string): T[] {
  return rows.map((row) => (row.venueId ? { ...row, venueId: canonical(row.venueId) } : row));
}

/**
 * A ranked list on current ids, one row per pub at its best place. A pub
 * ranked under an old id and under its current id is one pub, so only the
 * better-placed row stays (review P3b, PR 2402).
 */
function rankedOnCurrentIds(rows: readonly PassportRankedRow[], canonical: (venueId: string) => string): PassportRankedRow[] {
  const seen = new Set<string>();
  return onCurrentIds(rows, canonical)
    .sort((a, b) => a.place - b.place)
    .filter((row) => {
      if (seen.has(row.venueId)) return false;
      seen.add(row.venueId);
      return true;
    });
}

async function named(sightings: BeenSighting[], deps: PassportDeps): Promise<BeenSighting[]> {
  return Promise.all(
    sightings.map(async (sighting) => {
      if (sighting.venueName) return sighting;
      const venue = await deps.venue(sighting.venueId).catch(() => null);
      return { ...sighting, venueName: venue?.name ?? "" };
    }),
  );
}

/** GET /api/profiles/[handle]/been */
export async function readPassportBeen(
  request: Request,
  rawHandle: string,
  deps: PassportDeps = defaultPassportDeps(),
): Promise<PassportResult<BeenBody>> {
  const loaded = await loadProfile(request, rawHandle, deps);
  if (!loaded.ok) return loaded;
  const { profile } = loaded;
  const { relation } = await resolveViewer(request, profile, deps);
  const access = passportAccess("been", relation, accountIsPrivate(profile.visibility));
  if (access === "none") return PRIVATE;
  const sources = beenSourcesFor(access);
  const userId = profile.userId?.trim() || "";

  const [diary, drops, plans, beenHere, wanted, night, canonical] = await Promise.all([
    sources.includes("diary") && userId ? settle(() => deps.diary(userId), []) : settle(async () => [], []),
    settle(() => dropSightings(request, profile, relation, deps), []),
    sources.includes("plan") && userId ? settle(() => deps.plans(userId), []) : settle(async () => [], []),
    sources.includes("been_here")
      ? settle(() => deps.beenHere(profile.handle), [] as PassportVenue[])
      : settle(async () => [] as PassportVenue[], []),
    settle(() => deps.wanted(profile.id), [] as PassportVenue[]),
    access === "full" && userId ? settle(() => deps.nightProfile(userId), null) : settle(async () => null, null),
    canonicalizer(deps),
  ]);

  const dropRows: BeenSighting[] = drops.value.map((drop) => ({
    venueId: drop.venueId,
    venueName: "",
    date: drop.createdAt,
    source: "pint_drop",
  }));
  // A Been here row carries no day, and is never given one.
  const beenHereRows: BeenSighting[] = beenHere.value.map((venue) => ({
    venueId: venue.venueId,
    venueName: venue.venueName,
    date: "",
    source: "been_here",
  }));
  const venues = aggregateBeen(
    await named(onCurrentIds([...diary.value, ...dropRows, ...plans.value, ...beenHereRows], canonical), deps),
  );
  return {
    ok: true,
    body: {
      access,
      status: diary.failed || drops.failed || plans.failed || beenHere.failed ? "degraded" : "ready",
      count: venues.length,
      venues,
      wantToTryCount: wanted.failed ? null : wanted.value.length,
      cover:
        access === "full"
          ? { patch: night.value?.patch ?? null }
          : null,
    },
  };
}

async function rankedWithNames(profileId: string, deps: PassportDeps): Promise<PassportRankedRow[]> {
  return deps.rankings(profileId);
}

/** GET /api/profiles/[handle]/overlap */
export async function readPassportOverlap(
  request: Request,
  rawHandle: string,
  deps: PassportDeps = defaultPassportDeps(),
): Promise<PassportResult<OverlapBody>> {
  const loaded = await loadProfile(request, rawHandle, deps);
  if (!loaded.ok) return loaded;
  const { profile } = loaded;
  const { relation, viewerProfile } = await resolveViewer(request, profile, deps);
  if (passportAccess("overlap", relation, accountIsPrivate(profile.visibility)) === "none" || !viewerProfile) {
    return MATES_ONLY;
  }
  try {
    const [mineRanked, theirsRanked, mineWanted, theirsWanted, canonical] = await Promise.all([
      rankedWithNames(viewerProfile.id, deps),
      rankedWithNames(profile.id, deps),
      deps.wanted(viewerProfile.id),
      deps.wanted(profile.id),
      canonicalizer(deps),
    ]);
    return {
      ok: true,
      body: {
        topFive: sharedTopFive(rankedOnCurrentIds(mineRanked, canonical), rankedOnCurrentIds(theirsRanked, canonical)),
        wantToTry: sharedWantToTry(onCurrentIds(mineWanted, canonical), onCurrentIds(theirsWanted, canonical)),
      },
    };
  } catch {
    return UNAVAILABLE;
  }
}

/** GET /api/profiles/[handle]/taste */
export async function readPassportTaste(
  request: Request,
  rawHandle: string,
  deps: PassportDeps = defaultPassportDeps(),
): Promise<PassportResult<TasteBody>> {
  const loaded = await loadProfile(request, rawHandle, deps);
  if (!loaded.ok) return loaded;
  const { profile } = loaded;
  const { relation } = await resolveViewer(request, profile, deps);
  if (passportAccess("taste", relation, accountIsPrivate(profile.visibility)) === "none") return OWNER_ONLY;

  const [drops, ranked, canonical] = await Promise.all([
    settle(() => dropSightings(request, profile, relation, deps), []),
    settle(() => rankedWithNames(profile.id, deps), [] as PassportRankedRow[]),
    canonicalizer(deps),
  ]);
  const topFive = rankedOnCurrentIds(ranked.value, canonical).slice(0, 5);
  const enriched = await Promise.all(
    topFive.map(async (row) => {
      const [venue, dateLabel] = await Promise.all([
        deps.venue(row.venueId).catch(() => null),
        deps.heritageDateLabel(row.venueId).catch(() => null),
      ]);
      return { ...row, borough: venue?.borough ?? null, dateLabel };
    }),
  );
  const facts = buildTasteFacts({
    drinks: drops.value.map((drop) => ({ drink: drop.drink, date: drop.createdAt })),
    ranked: enriched,
  });
  return { ok: true, body: { facts } };
}

/** The owner's own list, for the top-ten share. Owner only. */
export async function readPassportRanked(
  request: Request,
  rawHandle: string,
  deps: PassportDeps = defaultPassportDeps(),
): Promise<PassportResult<RankedBody>> {
  const loaded = await loadProfile(request, rawHandle, deps);
  if (!loaded.ok) return loaded;
  const { relation } = await resolveViewer(request, loaded.profile, deps);
  if (relation !== "owner") return OWNER_ONLY;
  try {
    const rows = await rankedWithNames(loaded.profile.id, deps);
    return {
      ok: true,
      body: { ranked: rows.map(({ venueId, venueName, place }) => ({ venueId, venueName, place })) },
    };
  } catch {
    return UNAVAILABLE;
  }
}

// ── The real stores ─────────────────────────────────────────────────────────

const PLAN_READ_CAP = 200;

type PlanSightingsReader = (ownerUserId: string) => Promise<BeenSighting[]>;

// The memory plan store keeps no account index, so a keyless demo has no
// completed plans to fold in. That is the honest answer for a process that
// forgets its plans on restart.
const memoryPlanSightings: PlanSightingsReader = async () => [];

const supabasePlanSightings: PlanSightingsReader = async (ownerUserId) => {
  const db = requireSupabaseAdmin();
  const [seats, owned] = await Promise.all([
    db.from("plan_crew_members").select("plan_id").eq("user_id", ownerUserId).limit(PLAN_READ_CAP),
    db.from("plans").select("id").eq("owner_user_id", ownerUserId).limit(PLAN_READ_CAP),
  ]);
  if (seats.error) throw new Error(seats.error.message);
  if (owned.error) throw new Error(owned.error.message);
  const planIds = [
    ...new Set([
      ...(seats.data ?? []).map((row) => String(row.plan_id)),
      ...(owned.data ?? []).map((row) => String(row.id)),
    ]),
  ].slice(0, PLAN_READ_CAP);
  if (!planIds.length) return [];
  const done = await db.from("plan_completions").select("plan_id, completed_at").in("plan_id", planIds);
  if (done.error) throw new Error(done.error.message);
  const completedAt = new Map((done.data ?? []).map((row) => [String(row.plan_id), String(row.completed_at)]));
  if (!completedAt.size) return [];
  const stops = await db
    .from("plan_stops")
    .select("plan_id, venue_id, venue_name")
    .in("plan_id", [...completedAt.keys()]);
  if (stops.error) throw new Error(stops.error.message);
  return (stops.data ?? []).map((row) => ({
    venueId: String(row.venue_id),
    venueName: String(row.venue_name ?? ""),
    date: passportDay(completedAt.get(String(row.plan_id)) ?? ""),
    source: "plan" as const,
  }));
};

async function venueFacts(venueId: string): Promise<PassportVenueFacts | null> {
  const venue = await resolveStoredVenue(venueId);
  return venue ? { name: storedVenueName(venue), borough: venue.borough || null } : null;
}

export function defaultPassportDeps(): PassportDeps {
  return {
    verifyCaller: callerUserId,
    profiles: profileStore(),
    follows: followStore(),
    withdrawn: handleWithdrawnFromCaller,
    dropViewer: (request) => resolveViewerContextFromRequest(request),
    async diary(ownerUserId) {
      const result = await diaryStore().listForOwner(ownerUserId);
      if (result.status === "degraded") throw new Error("diary degraded");
      return result.entries.map((entry) => ({
        venueId: entry.venueId,
        venueName: entry.venueName,
        date: entry.visitedOn,
        source: "diary" as const,
      }));
    },
    async drops(authorHandle, viewer) {
      const drops = await pintDropsStore().listVisible(undefined, viewer, authorHandle);
      const key = normalizeHandle(authorHandle);
      return drops
        .filter((drop) => normalizeHandle(drop.handle ?? "") === key && drop.venueId)
        .map((drop) => ({ venueId: drop.venueId, drink: drop.drink ?? "", createdAt: drop.createdAt }));
    },
    plans: (ownerUserId) => selectStore(memoryPlanSightings, supabasePlanSightings)(ownerUserId),
    async wanted(profileId) {
      const result = await wantedStore().listOpenForOwner(`profile:${profileId}`);
      if (result.status === "degraded") throw new Error("wanted degraded");
      return result.wanteds.map((row) => ({ venueId: row.venueId, venueName: row.venueName }));
    },
    async beenHere(ownerHandle) {
      // The owner reads their own list, so a withdrawn handle is still theirs.
      const read = await savedPubsStore(ownerHandle).readSaved({ handle: ownerHandle });
      if (read.status !== "ready") throw new Error("saved lists unavailable");
      return read.rows
        .filter((row) => row.listType === BEEN_HERE_LIST)
        .map((row) => ({ venueId: row.venueId, venueName: row.venueName }));
    },
    async rankings(profileId) {
      const rows = await socialPubRankingStore().read({ profileId });
      const names = new Map<string, string>();
      await Promise.all(
        rows.map(async (row) => {
          const venue = await venueFacts(row.venueId).catch(() => null);
          if (venue) names.set(row.venueId, venue.name);
        }),
      );
      const updated = new Map(rows.map((row) => [row.venueId, row.updatedAt]));
      return socialPubRankingEntries(rows, names).map((entry) => ({
        venueId: entry.venueId,
        venueName: entry.venueName ?? "",
        place: entry.place,
        updatedAt: updated.get(entry.venueId) ?? "",
      }));
    },
    async nightProfile(ownerUserId) {
      const profile = await nightProfileStore().get(ownerUserId);
      if (!profile) return null;
      const area = profile.context.nightArea;
      const patch = area
        ? getNightAreasForCity(profile.cityId).find((entry) => entry.slug === area)?.name ?? null
        : null;
      // Only the patch. `budgetLimitPence` is the per-person budget for a
      // whole route, never a price for one pint, so the passport prints no
      // pint figure from it (captain decision, PR 2402).
      return { patch };
    },
    venue: venueFacts,
    venueAliases: async () => (await loadVenueAliasResolver()).canonical,
    async heritageDateLabel(venueId) {
      const pubs = await loadHistoricPubs();
      const pub = pubs.find((entry) => entry.venueId === venueId);
      return pub?.dateLabel?.trim() || null;
    },
  };
}
