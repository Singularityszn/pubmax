import { safeLocalStorage } from "@/lib/safeStorage";

export const PLAN_DRAFT_KEY = "pubmaxx:plan-draft:v1";
export const PLAN_DRAFT_V2_KEY = "pubmax:plan-draft:v2";
export const PLAN_ROUTE_DRAFT_KEY = "pubmaxx:plan-route-draft:v1";
export const PLAN_ROUTE_DRAFT_V2_KEY = "pubmax:plan-route-draft:v2";
export const PLAN_INTAKE_STORAGE_KEY = "pubmax:plan-intake:v1";

/** Remove both versions so a surviving draft cannot restore the previous Plan. */
export function clearPersistedPlanDrafts(
  storages: {
    planDraft?: Pick<Storage, "removeItem"> | null;
    routeDraft?: Pick<Storage, "removeItem"> | null;
  } = {},
): void {
  for (const [storage, key] of [
    [storages.planDraft, PLAN_DRAFT_KEY],
    [storages.planDraft, PLAN_DRAFT_V2_KEY],
    [storages.routeDraft, PLAN_ROUTE_DRAFT_KEY],
    [storages.routeDraft, PLAN_ROUTE_DRAFT_V2_KEY],
  ] as const) {
    try { storage?.removeItem(key); } catch {}
  }
}

export function clearPlanIntakeDraft(storage?: Storage | null): void {
  const store = storage ?? safeLocalStorage();
  if (!store) return;
  try {
    store.removeItem(PLAN_INTAKE_STORAGE_KEY);
  } catch {
    // Storage failures must not interrupt account departure or Plan cleanup.
  }
}
