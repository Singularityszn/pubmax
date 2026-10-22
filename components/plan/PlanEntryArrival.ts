import {
  ASK_PLAN_DRAFT_STORAGE_KEY,
  PLAN_DRAFT_KEY,
  PLAN_DRAFT_V2_KEY,
  PLAN_INTAKE_STORAGE_KEY,
  PLAN_ROUTE_DRAFT_KEY,
  PLAN_ROUTE_DRAFT_V2_KEY,
  PLANNING_INTENT_STORAGE_KEY,
  REMEMBERED_AREA_STORAGE_KEY,
} from "@/lib/planStorageKeys";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";

function readArrivalValue(storage: Storage | null, key: string): string | null {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

/** Capture browser arrival before input. The full composer owns all parsing. */
export function capturePlanEntryArrival() {
  const local = safeLocalStorage();
  const session = safeSessionStorage();
  let search = "";
  try { search = window.location.search; } catch { /* no browser address */ }
  return {
    capturedAt: Date.now(),
    planDraftV1: readArrivalValue(session, PLAN_DRAFT_KEY),
    planDraftV2: readArrivalValue(session, PLAN_DRAFT_V2_KEY),
    routeDraftV1: readArrivalValue(local, PLAN_ROUTE_DRAFT_KEY),
    routeDraftV2: readArrivalValue(local, PLAN_ROUTE_DRAFT_V2_KEY),
    intakeDraft: readArrivalValue(local, PLAN_INTAKE_STORAGE_KEY),
    planningIntent: readArrivalValue(session, PLANNING_INTENT_STORAGE_KEY),
    rememberedArea: readArrivalValue(local, REMEMBERED_AREA_STORAGE_KEY),
    askDraft: readArrivalValue(session, ASK_PLAN_DRAFT_STORAGE_KEY),
    search,
  };
}

export type PlanEntryArrival = ReturnType<typeof capturePlanEntryArrival>;

export function planArrivalHasStoredContext(arrival: PlanEntryArrival): boolean {
  return arrival.planDraftV1 !== null || arrival.planDraftV2 !== null
    || arrival.routeDraftV1 !== null || arrival.routeDraftV2 !== null
    || arrival.intakeDraft !== null || arrival.planningIntent !== null
    || arrival.rememberedArea !== null || arrival.askDraft !== null;
}
