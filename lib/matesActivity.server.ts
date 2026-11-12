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
import { followStore } from "@/lib/followStore";
import { MATES_ACTIVITY_LIMIT, type MatesActivityPint } from "@/lib/matesActivity";
import { normalizeViewerHandle, visibilityOf, type ViewerContext } from "@/lib/pintDrops";
import { pintDropsStore, type PintDropDTO } from "@/lib/pintDropsStore";
import { listOwnSocialRelationships } from "@/lib/socialRelationshipList.server";
import { isLiveMutual, type MutualViewer } from "@/lib/socialMutual.server";
import { storedVenueName } from "@/lib/storedVenueRef";
import { loadVenueAliasResolver } from "@/lib/venueAliases";
import { resolveStoredVenue, venueMapUrl } from "@/lib/venueIndex";

const VENUE_FALLBACK_LABEL = "A London pub";

export type MatesActivityDependencies = {
  listMutuals(handle: string): Promise<string[]>;
  /** The handles the reader muted. Throws when the list cannot be read. */
  listMuted(profileId: string): Promise<string[]>;
  /** One mate's drops as this reader may read them, newest first. */
  listMateDrops(mateHandle: string, viewer: ViewerContext): Promise<PintDropDTO[]>;
  /** True only when the pair is still mutual and neither side blocks the other. */
  stillMutual(viewer: MutualViewer, mateHandle: string): Promise<boolean>;
  /** The pub's canonical id and the name the map prints for it. */
  venue(venueId: string): Promise<{ venueId: string; name: string }>;
};

const defaultDependencies = (): MatesActivityDependencies => ({
  listMutuals: (handle) => followStore().listMutuals(handle),
  listMuted: async (profileId) => (await listOwnSocialRelationships(profileId)).muted.map((entry) => entry.handle),
  listMateDrops: (mateHandle, viewer) => pintDropsStore().listVisible(undefined, viewer, mateHandle, null),
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
): Promise<MatesActivityPint[]> {
  const deps = { ...defaultDependencies(), ...dependencies };
  const self = normalizeViewerHandle(viewer.handle);
  const [mutuals, muted] = await Promise.all([
    deps.listMutuals(viewer.handle),
    deps.listMuted(viewer.profileId),
  ]);
  const mutedHandles = new Set(muted.map(normalizeViewerHandle));
  const mates = new Set(
    mutuals
      .map(normalizeViewerHandle)
      .filter((handle) => handle && handle !== self && !mutedHandles.has(handle)),
  );
  if (mates.size === 0) return [];

  const readerContext: ViewerContext = { handle: self, mutualHandles: mates };
  const drops = (await Promise.all([...mates].map((mate) => deps.listMateDrops(mate, readerContext))))
    .flat()
    .filter(shareableDrop)
    .filter((drop) => mates.has(normalizeViewerHandle(drop.handle)))
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));

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
  return picked.map((drop) => {
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
}
