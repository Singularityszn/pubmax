import "server-only";

// Mates' activity: the newest Pint Drops the reader's MUTUAL friends logged,
// read live for the reader alone.
//
// Who counts is the follow graph's mutuals, less anyone the reader muted, and
// each mate passes the one live-mate check (lib/socialMutual.server.ts) before
// their name is shown, so a block either way removes them at once. What counts
// is a visible, organic drop in the public or friends lane, read through the
// drop store's own viewer rules: an anonymous drop never names its drinker, and
// a withdrawn or retired author never shows.

import { cleanDrinkMeasure } from "@/lib/drinkMeasure";
import { accountIsPrivate } from "@/lib/accountVisibility";
import { challengeProgress } from "@/lib/challenges";
import { followStore } from "@/lib/followStore";
import { MATES_ACTIVITY_LIMIT, type MatesActivityPint, type MatesActivityChallenge, type MatesActivityItem } from "@/lib/matesActivity";
import { normalizeViewerHandle, visibilityOf, type ViewerContext } from "@/lib/pintDrops";
import { pintDropsStore, type PintDropDTO } from "@/lib/pintDropsStore";
import { profileStore } from "@/lib/profileStore";
import { firstLoggedDates, readChallengeSet } from "@/lib/points.server";
import { socialMemoryMutes } from "@/lib/socialBlockMemory";
import { isLiveMutual, type MutualViewer } from "@/lib/socialMutual.server";
import { admin, selectStore } from "@/lib/storeBackend";
import { storedVenueName } from "@/lib/storedVenueRef";
import { loadVenueAliasResolver } from "@/lib/venueAliases";
import { resolveStoredVenue, venueMapUrl } from "@/lib/venueIndex";

const VENUE_FALLBACK_LABEL = "A London pub";

export type MatesActivityDependencies = {
  listMutuals(handle: string): Promise<string[]>;
  isMuted(profileId: string, mateHandle: string): Promise<boolean>;
  /** One mate's drops as this reader may read them, newest first. */
  listMateDrops(mateHandle: string, viewer: ViewerContext): Promise<PintDropDTO[]>;
  listMateChallenges(mateHandle: string, drops: readonly PintDropDTO[]): Promise<MatesActivityChallenge[]>;
  /** True only when the pair is still mutual and neither side blocks the other. */
  stillMutual(viewer: MutualViewer, mateHandle: string): Promise<boolean>;
  /** The pub's canonical id and the name the map prints for it. */
  venue(venueId: string): Promise<{ venueId: string; name: string }>;
};

const defaultDependencies = (): MatesActivityDependencies => ({
  listMutuals: (handle) => followStore().listMutuals(handle),
  isMuted: async (profileId, mateHandle) => {
    const mate = await profileStore().getByHandle(mateHandle);
    if (!mate) return true;
    return selectStore(
      async () => socialMemoryMutes(profileId, mate.id),
      async () => {
        const { data, error } = await admin()
          .from("social_mutes")
          .select("muted_profile_id")
          .eq("muter_profile_id", profileId)
          .eq("muted_profile_id", mate.id)
          .limit(1)
          .maybeSingle();
        if (error) throw new Error(error.message);
        return data !== null;
      },
    )();
  },
  listMateDrops: (mateHandle, viewer) => pintDropsStore().listVisible(undefined, viewer, mateHandle, null),
  listMateChallenges: async (mateHandle, drops) => {
    const mate = await profileStore().getByHandle(mateHandle);
    if (!mate?.userId || mate.tombstonedAt || accountIsPrivate(mate.visibility)) return [];
    const history = await Promise.all([readChallengeSet(), loadVenueAliasResolver()]).catch(() => null);
    if (!history || history[1].status !== "ready") return [];
    const [set, aliases] = history;
    const logged = firstLoggedDates(drops.map((drop) => ({
      venueId: drop.venueId,
      date: Date.parse(drop.createdAt) > 0 ? new Date(drop.createdAt).toISOString() : null,
    })), aliases.canonical);
    const challenges = challengeProgress(set, new Set(drops.map((drop) => aliases.canonical(drop.venueId))), logged);
    const current = await profileStore().getByHandle(mateHandle);
    if (!current || current.id !== mate.id || current.tombstonedAt || accountIsPrivate(current.visibility)) return [];
    return challenges.flatMap((challenge) => challenge.finished && challenge.finishedAt ? [{
      kind: "challenge_finished" as const,
      id: `challenge:${mate.id}:${challenge.id}`,
      handle: mateHandle,
      challengeId: challenge.id,
      loggedAt: challenge.finishedAt,
    }] : []);
  },
  stillMutual: isLiveMutual,
  venue: async (venueId) => {
    const [aliases, venue] = await Promise.all([loadVenueAliasResolver(), resolveStoredVenue(venueId)]);
    return { venueId: aliases.canonical(venueId), name: venue ? storedVenueName(venue) : VENUE_FALLBACK_LABEL };
  },
});

/** A drop a mate may be named beside on their mates' lane. */
function shareableDrop(drop: PintDropDTO): boolean {
  const visibility = visibilityOf(drop);
  return (
    drop.status === "visible" &&
    (visibility === "public" || visibility === "friends") &&
    drop.provenance !== "demo"
  );
}

function cleanPrice(value: number | null): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

/**
 * Up to MATES_ACTIVITY_LIMIT drops from the reader's live mates, newest first.
 * Empty when the reader has no mates or none has logged a pint.
 */
export async function readMatesActivity(
  viewer: MutualViewer,
  dependencies: Partial<MatesActivityDependencies> = {},
): Promise<MatesActivityItem[]> {
  const deps = { ...defaultDependencies(), ...dependencies };
  const self = normalizeViewerHandle(viewer.handle);
  const mutuals = await deps.listMutuals(viewer.handle);
  const candidates = [...new Set(mutuals.map(normalizeViewerHandle).filter((handle) => handle && handle !== self))];
  const muted = await Promise.all(candidates.map((mate) => deps.isMuted(viewer.profileId, mate)));
  const mates = new Set(candidates.filter((_, index) => !muted[index]));
  if (mates.size === 0) return [];

  const readerContext: ViewerContext = { handle: self, mutualHandles: mates };
  const drops = (await Promise.all([...mates].map((mate) => deps.listMateDrops(mate, readerContext))))
    .flat()
    .filter(shareableDrop)
    .filter((drop) => mates.has(normalizeViewerHandle(drop.handle)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const finishes = (await Promise.all([...mates].map((mate) => deps.listMateChallenges(
    mate, drops.filter((drop) => normalizeViewerHandle(drop.handle) === mate),
  )))).flat().filter((finish) => mates.has(normalizeViewerHandle(finish.handle)));

  const live = new Map<string, Promise<boolean>>();
  const picked: PintDropDTO[] = [];
  const seen = new Set<string>();
  for (const drop of drops) {
    if (picked.length >= MATES_ACTIVITY_LIMIT) break;
    if (seen.has(drop.id)) continue;
    seen.add(drop.id);
    const handle = normalizeViewerHandle(drop.handle);
    if (!live.has(handle)) live.set(handle, deps.stillMutual(viewer, handle));
    if (!(await live.get(handle))) continue;
    picked.push(drop);
  }

  const venueIds = [...new Set(picked.map((drop) => drop.venueId))];
  const venues = new Map(
    await Promise.all(venueIds.map(async (venueId) => [venueId, await deps.venue(venueId)] as const)),
  );
  const pints: MatesActivityPint[] = picked.map((drop) => {
    const venue = venues.get(drop.venueId) ?? { venueId: drop.venueId, name: VENUE_FALLBACK_LABEL };
    const priceGbp = cleanPrice(drop.priceGbp);
    return {
      id: drop.id,
      handle: normalizeViewerHandle(drop.handle),
      venueId: venue.venueId,
      venueName: venue.name,
      venueMapUrl: venueMapUrl(venue.venueId),
      drink: drop.drink,
      measure: cleanDrinkMeasure(drop.measure),
      ...(drop.measureLabel ? { measureLabel: drop.measureLabel } : {}),
      priceGbp,
      ...(priceGbp !== null && drop.priceEvidence ? { priceEvidence: drop.priceEvidence } : {}),
      loggedAt: drop.createdAt,
    };
  });
  const visibleFinishes: MatesActivityChallenge[] = [];
  for (const finish of finishes) {
    const handle = normalizeViewerHandle(finish.handle);
    if (!live.has(handle)) live.set(handle, deps.stillMutual(viewer, handle));
    if (await live.get(handle)) visibleFinishes.push(finish);
  }
  return [...pints, ...visibleFinishes]
    .sort((a, b) => b.loggedAt.localeCompare(a.loggedAt) || b.id.localeCompare(a.id))
    .slice(0, MATES_ACTIVITY_LIMIT);
}
