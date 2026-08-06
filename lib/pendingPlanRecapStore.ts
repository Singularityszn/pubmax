import type { PendingPlanRecap } from "@/lib/planRecap";
import { validatePendingPlanRecap } from "@/lib/planRecap";
import { selectStore } from "@/lib/storeBackend";

/**
 * Owner-scoped pending Plan recap drafts. Private only: route captions and
 * completion references, never member tokens, coordinates, or voice.
 *
 * Process-memory is the keyless / test backend. A future durable table can sit
 * behind the same seam without changing callers. Claim merge promotes a draft
 * into a private Night Memory via createNightMemoryFromPlanRecap.
 */
export type PendingPlanRecapStore = {
  list(ownerId: string): Promise<PendingPlanRecap[]>;
  getByCompletion(ownerId: string, completionId: string): Promise<PendingPlanRecap | null>;
  upsert(ownerId: string, recap: PendingPlanRecap): Promise<PendingPlanRecap | null>;
  remove(ownerId: string, completionId: string): Promise<boolean>;
  clearOwner(ownerId: string): Promise<void>;
};

/** ownerId → completionId → draft */
const byOwner = new Map<string, Map<string, PendingPlanRecap>>();

export function __resetPendingPlanRecapStore(): void {
  byOwner.clear();
}

function ownerBucket(ownerId: string): Map<string, PendingPlanRecap> {
  let bucket = byOwner.get(ownerId);
  if (!bucket) {
    bucket = new Map();
    byOwner.set(ownerId, bucket);
  }
  return bucket;
}

export const memoryPendingPlanRecapStore: PendingPlanRecapStore = {
  async list(ownerId) {
    if (!ownerId) return [];
    return [...ownerBucket(ownerId).values()].sort((left, right) =>
      right.savedAt.localeCompare(left.savedAt),
    );
  },
  async getByCompletion(ownerId, completionId) {
    if (!ownerId || !completionId) return null;
    return ownerBucket(ownerId).get(completionId) ?? null;
  },
  async upsert(ownerId, recap) {
    if (!ownerId) return null;
    const safe = validatePendingPlanRecap({
      ...recap,
      savedAt: new Date().toISOString(),
    });
    if (!safe) return null;
    ownerBucket(ownerId).set(safe.completionId, safe);
    return safe;
  },
  async remove(ownerId, completionId) {
    if (!ownerId || !completionId) return false;
    return ownerBucket(ownerId).delete(completionId);
  },
  async clearOwner(ownerId) {
    if (!ownerId) return;
    byOwner.delete(ownerId);
  },
};

/**
 * No Supabase table yet (Lane C ships memory + claim→Memory durability). The
 * selectStore seam keeps the door open for a later migration without callers
 * changing shape.
 */
export function pendingPlanRecapStore(): PendingPlanRecapStore {
  return selectStore(memoryPendingPlanRecapStore, memoryPendingPlanRecapStore);
}
