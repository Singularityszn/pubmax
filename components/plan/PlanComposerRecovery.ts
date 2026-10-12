import { parsePlanDraft, parsePlanDraftEnvelope } from "@/lib/planDraft";
import { parsePlanRouteDraftEnvelope } from "@/lib/planRouteDraft";
import { parsePlanningIntent } from "@/lib/planningIntent";
import { resolveComposerHydration, type ComposerHydration } from "@/lib/planComposerHandoff";
import { parseRememberedArea } from "@/lib/nightPatches";
import { createPlanIntakeDraft, defaultLondonStartInput, parsePlanIntakeDraftWithMetadata } from "@/lib/planIntake";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";
import { PLAN_INTAKE_STORAGE_KEY, PLANNING_INTENT_STORAGE_KEY } from "@/lib/planStorageKeys";
import { capturePlanEntryArrival, type PlanEntryArrival } from "@/components/plan/PlanEntryArrival";

function removeRejectedArrival(storage: Storage | null, key: string, raw: string | null) {
  if (raw === null) return;
  try {
    // A write during the import belongs to a later arrival, never this cleanup.
    if (storage?.getItem(key) === raw) storage.removeItem(key);
  } catch { /* blocked storage */ }
}

/** Parse the captured arrival before the full composer writes any defaults. */
export function readPlanComposerRecovery(arrival = capturePlanEntryArrival()) {
  const now = arrival.capturedAt;
  const planDraft = parsePlanDraftEnvelope(arrival.planDraftV2, arrival.planDraftV1, now);
  const routeDraft = parsePlanRouteDraftEnvelope(arrival.routeDraftV2, arrival.routeDraftV1, now);
  const intakeDraft = parsePlanIntakeDraftWithMetadata(arrival.intakeDraft, now);
  const planningIntent = arrival.planningIntent === null ? null : parsePlanningIntent(arrival.planningIntent, now);
  if (!intakeDraft) removeRejectedArrival(safeLocalStorage(), PLAN_INTAKE_STORAGE_KEY, arrival.intakeDraft);
  if (!planningIntent) removeRejectedArrival(safeSessionStorage(), PLANNING_INTENT_STORAGE_KEY, arrival.planningIntent);
  const rememberedArea = parseRememberedArea(arrival.rememberedArea);
  const resolved = resolveComposerHydration({ planDraft, routeDraft, intakeDraft, planningIntent, rememberedArea });
  return {
    capturedAt: now,
    handoff: resolved.active ? resolved : null,
    recoveredDraft: parsePlanDraft(arrival.planDraftV1, now),
    routeRaw: arrival.routeDraftV1,
    intake: intakeDraft?.draft ?? createPlanIntakeDraft(),
    hasDurableIntakeDraft: Boolean(intakeDraft),
  };
}

export type PlanComposerRecovery = ReturnType<typeof readPlanComposerRecovery>;
export type { PlanEntryArrival };

export function initialComposerDraftFields(
  handoff: ComposerHydration | null,
  recoveredDraft: ReturnType<typeof parsePlanDraft>,
  capturedAt?: number,
) {
  return {
    title: handoff?.title ?? recoveredDraft?.title ?? "Tonight, sorted",
    creatorName: handoff?.creatorName ?? recoveredDraft?.creatorName ?? "",
    startTime: handoff?.startsAt ?? recoveredDraft?.startTime
      ?? (() => defaultLondonStartInput(capturedAt === undefined ? undefined : new Date(capturedAt))),
    conciergeQuery: recoveredDraft?.conciergeQuery ?? "",
  };
}
