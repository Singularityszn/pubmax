import "server-only";

import type { PlanLiveLocationFix } from "@/lib/planLiveLocation";

export type StoredFix = PlanLiveLocationFix & { memberId: string; updatedAt: string; expiresAt: number };

export const memoryPlanLiveLocations = new Map<string, Map<string, StoredFix>>();
