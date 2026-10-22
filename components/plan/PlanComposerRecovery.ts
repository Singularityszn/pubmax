import { parsePlanDraft, PLAN_DRAFT_KEY, readPlanDraftEnvelope } from "@/lib/planDraft";
import { PLAN_ROUTE_DRAFT_KEY, readPlanRouteDraftEnvelope } from "@/lib/planRouteDraft";
import { readPlanningIntent } from "@/lib/planningIntent";
import { resolveComposerHydration, type ComposerHydration } from "@/lib/planComposerHandoff";
import { readRememberedArea } from "@/lib/nightPatches";
import { createPlanIntakeDraft, defaultLondonStartInput, readPlanIntakeDraftWithMetadata } from "@/lib/planIntake";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";
import { ASK_PLAN_DRAFT_STORAGE_KEY } from "@/lib/ask/types";
import { parsePlanDescribeFromSearch } from "@/lib/planOccasion";

/** Read once, before either entry can write a default or accept typed input. */
export function readPlanComposerRecovery() {
  const session = safeSessionStorage();
  const local = safeLocalStorage();
  const planDraft = readPlanDraftEnvelope(session);
  const routeDraft = readPlanRouteDraftEnvelope(local);
  const intakeDraft = readPlanIntakeDraftWithMetadata();
  const planningIntent = readPlanningIntent();
  const rememberedArea = readRememberedArea();
  const resolved = resolveComposerHydration({ planDraft, routeDraft, intakeDraft, planningIntent, rememberedArea });
  let routeRaw: string | null = null;
  let askDraftPresent = false;
  let urlAsk: string | null = null;
  let recoveredDraft: ReturnType<typeof parsePlanDraft> = null;
  try { routeRaw = local?.getItem(PLAN_ROUTE_DRAFT_KEY) ?? null; } catch { /* blocked storage */ }
  try { recoveredDraft = parsePlanDraft(session?.getItem(PLAN_DRAFT_KEY) ?? null); } catch { /* blocked storage */ }
  try { askDraftPresent = Boolean(session?.getItem(ASK_PLAN_DRAFT_STORAGE_KEY)); } catch { /* blocked storage */ }
  try { urlAsk = parsePlanDescribeFromSearch(window.location.search); } catch { /* no browser address */ }
  return {
    handoff: resolved.active ? resolved : null,
    recoveredDraft,
    routeRaw,
    intake: intakeDraft?.draft ?? createPlanIntakeDraft(),
    hasDurableIntakeDraft: Boolean(intakeDraft),
    requiresFullComposer: Boolean(planDraft || routeDraft || routeRaw || intakeDraft || resolved.active || rememberedArea || urlAsk || askDraftPresent),
  };
}

export type PlanComposerRecovery = ReturnType<typeof readPlanComposerRecovery>;

export function initialComposerDraftFields(
  handoff: ComposerHydration | null,
  recoveredDraft: ReturnType<typeof parsePlanDraft>,
) {
  return {
    title: handoff?.title ?? recoveredDraft?.title ?? "Tonight, sorted",
    creatorName: handoff?.creatorName ?? recoveredDraft?.creatorName ?? "",
    startTime: handoff?.startsAt ?? recoveredDraft?.startTime ?? defaultLondonStartInput,
    conciergeQuery: recoveredDraft?.conciergeQuery ?? "",
  };
}
