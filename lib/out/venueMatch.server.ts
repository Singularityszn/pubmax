import "server-only";

import { venueIdMatchesCity } from "@/lib/cityVenueIds";
import type { CityId } from "@/lib/cities";
import { buildOutVenueMatchIndex, type OutVenueMatchIndex } from "@/lib/out/venueMatch";
import { getVenueIndexSnapshot, type VenueIndexSnapshot, type VenueRef } from "@/lib/venueIndex";

const built = new WeakMap<Map<string, VenueRef>, Map<CityId, OutVenueMatchIndex>>();
const building = new WeakMap<Map<string, VenueRef>, Map<CityId, Promise<OutVenueMatchIndex>>>();
let snapshotPromise: Promise<VenueIndexSnapshot> | null = null;

async function loadSnapshot() {
  if (!snapshotPromise) {
    snapshotPromise = getVenueIndexSnapshot().catch((error) => {
      snapshotPromise = null;
      throw error;
    });
  }
  const snapshot = await snapshotPromise;
  if (!snapshot.complete) snapshotPromise = null;
  return snapshot;
}

export async function loadOutVenueMatchIndex(
  city: CityId = "london",
): Promise<OutVenueMatchIndex | null> {
  const snapshot = await loadSnapshot();
  if (!snapshot.loadedCities.has(city)) return null;

  const indexes = built.get(snapshot.index) ?? new Map<CityId, OutVenueMatchIndex>();
  built.set(snapshot.index, indexes);
  const held = indexes.get(city);
  if (held) return held;

  const pending = building.get(snapshot.index) ?? new Map<CityId, Promise<OutVenueMatchIndex>>();
  building.set(snapshot.index, pending);
  const existing = pending.get(city);
  if (existing) return existing;

  const promise = Promise.resolve().then(() =>
    buildOutVenueMatchIndex(
      [...snapshot.index.values()].filter((venue) => venueIdMatchesCity(venue.id, city)),
    ),
  );
  pending.set(city, promise);
  try {
    const index = await promise;
    indexes.set(city, index);
    return index;
  } finally {
    pending.delete(city);
  }
}
