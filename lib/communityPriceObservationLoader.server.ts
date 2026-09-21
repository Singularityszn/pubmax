import "server-only";

import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { CommunityPrice } from "@/lib/communityPrice";
import {
  isValidCommunityPriceObservationRow,
  observationToCommunityPrice,
  type CommunityPriceObservationPack,
  type CommunityPriceObservationRow,
} from "@/lib/communityPriceObservation";
import type { DrinkCategory } from "@/lib/drinks";

const PACK_PATH = join(process.cwd(), "public/data/community_price_observations/london_reddit.json");

let cached: CommunityPriceObservationRow[] | null = null;

function loadRows(): CommunityPriceObservationRow[] {
  if (cached) return cached;
  try {
    const raw = JSON.parse(readFileSync(PACK_PATH, "utf8")) as CommunityPriceObservationPack;
    const now = Date.now();
    cached = (raw.observations ?? []).filter((row) => isValidCommunityPriceObservationRow(row, now));
  } catch {
    cached = [];
  }
  return cached;
}

export function resetCommunityPriceObservationCacheForTests() {
  cached = null;
}

function communityPriceObservationsForVenue(venueId: string, now: number = Date.now()): CommunityPrice[] {
  const rows = loadRows().filter((row) => row.venueId === venueId);
  const byCategory = new Map<DrinkCategory, CommunityPrice>();
  for (const row of rows) {
    const price = observationToCommunityPrice(row);
    const existing = byCategory.get(row.drinkCategory);
    if (!existing || price.submittedAt > existing.submittedAt) {
      byCategory.set(row.drinkCategory, price);
    }
  }
  return [...byCategory.values()].filter((p) => p.submittedAt <= now);
}

function mergeCommunityPricesWithObservations(live: readonly CommunityPrice[], seeded: readonly CommunityPrice[]): CommunityPrice[] {
  const merged = [...live];
  for (const row of seeded) {
    const idx = merged.findIndex((p) => p.drinkCategory === row.drinkCategory);
    if (idx === -1) merged.push(row);
    else if (row.submittedAt > merged[idx].submittedAt) merged[idx] = row;
  }
  return merged.sort((a, b) => b.submittedAt - a.submittedAt);
}

export function mergedCommunityPricesForVenue(live: readonly CommunityPrice[], venueId: string, now: number = Date.now()): CommunityPrice[] {
  const seeded = communityPriceObservationsForVenue(venueId, now);
  return mergeCommunityPricesWithObservations(live, seeded);
}
