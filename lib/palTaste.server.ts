import "server-only";

import { diaryStore } from "@/lib/diaryStore";
import { measureIsPint } from "@/lib/drinkMeasure";
import { getNightAreasForCity, type NightArea } from "@/lib/nightAreas";
import { buildPalTaste, type PalTaste, type PalTastePlace } from "@/lib/palTaste";
import { londonDayKey } from "@/lib/pintContributions";
import { pintDropsStore } from "@/lib/pintDropsStore";
import { profileStore } from "@/lib/profileStore";
import { palTasteAllowed } from "@/lib/pubPal";
import { getPubPalResult } from "@/lib/pubPalStore";
import { savedPubsStore } from "@/lib/savedPubsStore";
import { getVenueIndex, type VenueRef } from "@/lib/venueIndex";
import { DEFAULT_CITY_ID } from "@/lib/cities";

/**
 * The read runs beside the signed-URL request, so a turn only waits on it when
 * it is slower than that. Past this it answers null and the agent asks instead.
 */
const PAL_TASTE_READ_BUDGET_MS = 900;
const CACHE_TTL_MS = 120_000;
const CACHE_MAX = 500;

type CachedTaste = { at: number; taste: PalTaste | null };

const cache = new Map<string, CachedTaste>();

/**
 * Deleted on a timer as well as checked on read, so a read is never held past
 * the two minutes /privacy promises, even when the person never writes again.
 */
function remember(ownerId: string, entry: CachedTaste): void {
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value as string);
  cache.set(ownerId, entry);
  const expiry = setTimeout(() => {
    if (cache.get(ownerId) === entry) cache.delete(ownerId);
  }, CACHE_TTL_MS);
  expiry.unref?.();
}

function patchOf(venue: VenueRef, areas: readonly NightArea[]): string | null {
  let best: { area: NightArea; km: number } | null = null;
  for (const area of areas) {
    const km = Math.hypot((area.centre.lat - venue.lat) * 111, (area.centre.lng - venue.lng) * 70);
    if (km <= area.radiusKm && (!best || km < best.km)) best = { area, km };
  }
  return best?.area.name ?? (venue.borough || null);
}

async function readTaste(ownerId: string): Promise<PalTaste | null> {
  const [handle, diary, index] = await Promise.all([
    profileStore().getHandleByUserId(ownerId),
    diaryStore().listForOwner(ownerId),
    getVenueIndex(),
  ]);
  const [drops, saved] = handle
    ? await Promise.all([
        pintDropsStore().listVisible(undefined, { handle }, handle, null),
        savedPubsStore(handle).listSaved({ handle }),
      ])
    : [[], []];

  const areas = getNightAreasForCity(DEFAULT_CITY_ID);
  const places = new Map<string, PalTastePlace | null>();
  const placeOf = (venueId: string): PalTastePlace | null => {
    if (!places.has(venueId)) {
      const venue = index.get(venueId);
      places.set(venueId, venue ? { name: venue.name, patch: patchOf(venue, areas) } : null);
    }
    return places.get(venueId) ?? null;
  };

  return buildPalTaste({
    diary: diary.entries.map((entry) => ({
      venueId: entry.venueId,
      venueName: entry.venueName,
      visitedOn: entry.visitedOn,
      rating: entry.rating,
    })),
    drops: drops.map((drop) => ({
      venueId: drop.venueId,
      drink: drop.drink,
      pintPriceGbp: measureIsPint(drop.measure) ? drop.priceGbp : null,
      vibeTags: drop.vibeTags ?? [],
      day: londonDayKey(drop.createdAt),
    })),
    saved: saved.map((save) => ({ venueId: save.venueId, venueName: save.venueName })),
    placeOf,
  });
}

/**
 * The owner's taste opt-out, read fresh on every turn so turning it off takes
 * effect at once, past any cached read. An account with no Pal has the
 * default, which is on. A Pal that cannot be read fails closed.
 */
async function tasteAllowedFor(ownerId: string): Promise<boolean> {
  try {
    const result = await getPubPalResult(ownerId);
    return result.ok && palTasteAllowed(result.value?.proposalPreferences);
  } catch {
    return false;
  }
}

/**
 * The signed-in owner's taste read, from their own diary, drops and saves.
 * Never rejects: a slow or failed read, or an owner who turned it off, is
 * null, so a turn always answers.
 */
export async function readPalTaste(ownerId: string, now = Date.now()): Promise<PalTaste | null> {
  // Checked first, so an owner who turned it off never has their logs read.
  if (!(await tasteAllowedFor(ownerId))) {
    cache.delete(ownerId);
    return null;
  }
  return readTasteWithinBudget(ownerId, now);
}

async function readTasteWithinBudget(ownerId: string, now: number): Promise<PalTaste | null> {
  const hit = cache.get(ownerId);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.taste;
  // A read that misses this turn's budget still lands in the cache, so the
  // person's next line carries it.
  const read = readTaste(ownerId).then(
    (taste) => {
      remember(ownerId, { at: now, taste });
      return taste;
    },
    (error: unknown) => {
      console.warn("pub-pal-taste.read_failed", error instanceof Error ? error.message : String(error));
      return null;
    },
  );
  let timer: ReturnType<typeof setTimeout> | undefined;
  const budget = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), PAL_TASTE_READ_BUDGET_MS);
  });
  try {
    return await Promise.race([read, budget]);
  } finally {
    clearTimeout(timer);
  }
}

/** Test and eval only: forget every cached read. */
export function __resetPalTasteCache(): void {
  cache.clear();
}
