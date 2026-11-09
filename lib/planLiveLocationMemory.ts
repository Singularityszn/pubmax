import "server-only";

import type { PlanLiveLocationFix } from "@/lib/planLiveLocation";

export type StoredFix = PlanLiveLocationFix & { memberId: string; updatedAt: string; expiresAt: number };
export type StoredStop = { stoppedAt: number; expiresAt: number };

export const memoryPlanLiveLocations = new Map<string, Map<string, StoredFix>>();
export const memoryPlanLiveLocationStops = new Map<string, Map<string, StoredStop>>();

export function clearMemoryPlanLiveLocation(id: string): void {
  memoryPlanLiveLocations.delete(id);
  memoryPlanLiveLocationStops.delete(id);
}

export function purgeExpiredMemoryPlanLiveLocations(now: number): void {
  // The memory backend is not production, so expiry is lazy.
  for (const records of [memoryPlanLiveLocations, memoryPlanLiveLocationStops]) {
    for (const [id, rows] of records) {
      for (const [memberId, row] of rows) {
        if (row.expiresAt <= now) rows.delete(memberId);
      }
      if (!rows.size) records.delete(id);
    }
  }
}
