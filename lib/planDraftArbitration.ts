import {
  NIGHT_PATCHES,
  type NightPatchId,
  type RememberedArea,
} from "@/lib/nightPatches";
import type { NightContext } from "@/lib/nightPlanning";
import type { ParsedPlanDraft, StoredPlanDraft } from "@/lib/planDraft";
import { planIntakeNightContextPatch, type ParsedPlanIntakeDraft, type PlanIntakeDraft } from "@/lib/planIntake";
import type { ParsedPlanRouteDraft } from "@/lib/planRouteDraft";
import { cleanPlanStopCountSource, type PlanStopCount, type PlanStopCountSource } from "@/lib/planStopCount";
import type { PlanningIntentArea, PlanningIntentV1 } from "@/lib/planningIntent";

function requestedIntentSource(plan: ParsedPlanDraft | null, legacyDraft: StoredPlanDraft | null, intake: ParsedPlanIntakeDraft | null): "plan" | "intake" | "unknown" {
  if (plan && !plan.legacy && legacyDraft
    && (legacyDraft.requestedStopCount !== plan.draft.requestedStopCount
      || legacyDraft.conciergeQuery !== plan.draft.conciergeQuery
      || legacyDraft.requestedStopCountSource !== plan.draft.requestedStopCountSource)) return "unknown";
  if (!plan) return "intake";
  if (!intake) return "plan";
  if (plan.legacy) return "unknown";
  const planTime = Date.parse(plan.savedAt ?? "");
  const intakeTime = Date.parse(intake.savedAt);
  if (!Number.isFinite(planTime) || !Number.isFinite(intakeTime)) return "unknown";
  return intakeTime > planTime ? "intake" : "plan";
}

export function resolveRequestedPlanIntent(
  plan: ParsedPlanDraft | null,
  legacyDraft: StoredPlanDraft | null,
  intake: ParsedPlanIntakeDraft | null,
): { stopCount: PlanStopCount | undefined; stopCountSource?: PlanStopCountSource; conciergeQuery: string; descriptionUnavailable: boolean; explicitNightContext?: Partial<NightContext> } {
  const planCount = plan?.draft.requestedStopCount;
  const intakeCount = intake?.draft.answers.stopCount;
  const planSource = cleanPlanStopCountSource(plan?.draft.requestedStopCountSource, planCount);
  const intakeSource = cleanPlanStopCountSource(intake?.draft.answers.stopCountSource, intakeCount);
  const local = { ...(intake?.explicitNightContext !== undefined ? { explicitNightContext: intake.explicitNightContext } : {}), stopCount: intakeCount, ...(intakeSource ? { stopCountSource: intakeSource } : {}) };
  const recovered = {
    ...(plan?.draft.explicitNightContext !== undefined && (!legacyDraft
      || JSON.stringify(legacyDraft.explicitNightContext) === JSON.stringify(plan.draft.explicitNightContext))
      ? { explicitNightContext: plan.draft.explicitNightContext } : {}),
    stopCount: planCount,
    ...(planSource ? { stopCountSource: planSource } : {}),
    conciergeQuery: plan?.draft.conciergeQuery ?? "",
    descriptionUnavailable: false,
  };
  const unavailable = { conciergeQuery: "", descriptionUnavailable: true };
  const source = requestedIntentSource(plan, legacyDraft, intake);
  if (source === "intake") return { ...local, ...(plan ? unavailable : { conciergeQuery: "", descriptionUnavailable: false }) };
  if (source === "plan") return recovered;
  const count = plan && legacyDraft && !plan.legacy
    ? legacyDraft.requestedStopCount === planCount ? planCount : undefined
    : planCount === intakeCount ? planCount : undefined;
  return { stopCount: count, ...unavailable };
}

function matchingSessionCopies(plan: ParsedPlanDraft | null, legacyDraft: StoredPlanDraft | null): boolean {
  if (!plan || !legacyDraft) return false;
  return JSON.stringify(plan.draft.stops) === JSON.stringify(legacyDraft.stops)
    && JSON.stringify(plan.draft.routeReference) === JSON.stringify(legacyDraft.routeReference)
    && JSON.stringify(plan.draft.acceptedAnchor) === JSON.stringify(legacyDraft.acceptedAnchor)
    && JSON.stringify(plan.draft.explicitNightContext) === JSON.stringify(legacyDraft.explicitNightContext)
    && JSON.stringify(plan.draft.requestIntake) === JSON.stringify(legacyDraft.requestIntake);
}

function matchingSessionRoute(
  plan: ParsedPlanDraft | null,
  route: Pick<ParsedPlanRouteDraft, "savedAt" | "value"> | null,
): boolean {
  if (!plan || !route) return false;
  const reference = plan.draft.routeReference;
  if (reference) {
    if (plan.draft.requestedStopCount !== undefined
      && plan.draft.requestedStopCount !== route.value.nightContext?.stopCount) return false;
    if (plan.legacy || route.value.routeStale || !route.value.groundingProof
      || reference.savedAt !== route.savedAt || reference.operationKey !== route.value.operationKey
      || Date.parse(reference.savedAt) > Date.parse(plan.savedAt ?? "")) return false;
  } else if (!route.value.routeStale || plan.savedAt !== route.savedAt) return false;
  const anchor = plan.draft.acceptedAnchor;
  const previewOnly = route.value.routeStale && route.value.nightContext === null
    && route.value.groundingProof === null && route.value.operationKey === null && route.value.routeRevision === null
    && route.value.anchorVenueId === null && route.value.anchorSource === null;
  if (anchor && (!plan.savedAt || (!previewOnly
    && (anchor.venueId !== route.value.anchorVenueId || anchor.source !== route.value.anchorSource)))) return false;
  return JSON.stringify(plan.draft.stops)
    === JSON.stringify(route.value.stops.map(({ key, venueId, venueName }) => ({ key, venueId, venueName })));
}

function matchingIntakeRoute(intake: ParsedPlanIntakeDraft, route: Pick<ParsedPlanRouteDraft, "savedAt" | "value"> | null): boolean {
  if (!route) return false;
  const patch = planIntakeNightContextPatch(intake.draft);
  const count = intake.draft.answers.stopCount;
  if (count !== undefined && count !== route.value.nightContext?.stopCount) return false;
  if (!(Object.keys(patch) as (keyof typeof patch)[])
    .every((key) => JSON.stringify(patch[key]) === JSON.stringify(route.value.nightContext?.[key]))) return false;
  if (route.value.routeStale && route.savedAt === intake.savedAt) return true;
  const reference = intake.routeReference;
  return Boolean(reference && !route.value.routeStale && route.value.groundingProof
    && reference.savedAt === route.savedAt && reference.operationKey === route.value.operationKey
    && Date.parse(reference.savedAt) <= Date.parse(intake.savedAt));
}

function sessionSupersedesRoute(plan: ParsedPlanDraft | null, route: (Pick<ParsedPlanRouteDraft, "savedAt" | "value"> & { conflicting?: boolean }) | null, matchingRoute: boolean, sessionCopiesAgree: boolean): boolean {
  return Boolean(plan
    && (!route || (!plan.legacy && sessionCopiesAgree && ((Date.parse(plan.savedAt ?? "") > Date.parse(route.savedAt ?? "") && !matchingRoute)
      || (!route.savedAt && route.conflicting === false)))));
}

function routeSupersedesRequest(plan: ParsedPlanDraft | null, route: Pick<ParsedPlanRouteDraft, "savedAt" | "value"> | null): boolean {
  const routeTime = Date.parse(route?.savedAt ?? "");
  if (!Number.isFinite(routeTime)) return false;
  if (!plan) return true;
  if (!plan.legacy) return routeTime > Date.parse(plan.savedAt ?? "");
  const reference = plan.draft.routeReference;
  return reference !== null && !(reference && reference.savedAt === route?.savedAt
    && reference.operationKey === route?.value.operationKey);
}

function recoverCurrentIntake(plan: ParsedPlanDraft | null, intake: ParsedPlanIntakeDraft | null, intakeWins: boolean, sessionWins: boolean, acceptanceUnavailable: boolean, sessionIntake: PlanIntakeDraft | null, legacyDraft: StoredPlanDraft | null): ParsedPlanIntakeDraft | null {
  if (sessionIntake && plan && !plan.legacy && plan.savedAt && plan.expiresAt) return {
    storageVersion: 1, savedAt: plan.savedAt, expiresAt: plan.expiresAt,
    draft: sessionIntake, legacy: false,
    routeReference: plan.draft.routeReference, explicitNightContext: plan.draft.explicitNightContext,
  };
  if (intakeWins) return intake;
  if (plan && legacyDraft && JSON.stringify(plan.draft.requestIntake) !== JSON.stringify(legacyDraft.requestIntake)) return null;
  if (plan?.draft.explicitNightContext !== undefined
    && JSON.stringify(plan.draft.explicitNightContext) !== JSON.stringify(intake?.explicitNightContext)) return null;
  if (plan && intake && (plan.savedAt === intake.savedAt
    || (!plan.draft.conciergeQuery && plan.draft.routeReference === null && intake.routeReference === null))
    && plan.draft.requestedStopCount === intake.draft.answers.stopCount
    && plan.draft.requestedStopCountSource === intake.draft.answers.stopCountSource
    && JSON.stringify(plan.draft.routeReference) === JSON.stringify(intake.routeReference)) return intake;
  return sessionWins || acceptanceUnavailable ? null : intake;
}

function recoverExplicitRequestInputs(
  intent: ReturnType<typeof resolveRequestedPlanIntent>,
  route: { explicitNightContext?: Partial<NightContext> } | null,
  routeWins: boolean,
  requestMatchesRoute: boolean,
  acceptanceUnavailable: boolean,
): ReturnType<typeof resolveRequestedPlanIntent> {
  if (intent.explicitNightContext !== undefined || acceptanceUnavailable) return intent;
  if (!routeWins && !requestMatchesRoute) return intent;
  const routeInputs = route?.explicitNightContext;
  return routeInputs === undefined ? intent : { ...intent, explicitNightContext: routeInputs };
}

function recoverSessionIntake(plan: ParsedPlanDraft | null, legacyDraft: StoredPlanDraft | null, requestSource: string, routeWins: boolean): PlanIntakeDraft | null {
  if (requestSource !== "plan" || routeWins) return null;
  return plan?.draft.requestIntake && (!legacyDraft
      || JSON.stringify(plan.draft.requestIntake) === JSON.stringify(legacyDraft.requestIntake))
    ? plan.draft.requestIntake
    : null;
}

function recoveredIntakeState(intake: ParsedPlanIntakeDraft | null, sessionIntake: PlanIntakeDraft | null, hasStoredIntake: boolean) {
  return {
    intakeDraft: intake,
    requestIntake: intake?.draft ?? sessionIntake,
    hasStoredIntake: hasStoredIntake || sessionIntake !== null,
  };
}

type DraftRecoveryInput = {
  plan: ParsedPlanDraft | null;
  legacyDraft: StoredPlanDraft | null;
  intake: ParsedPlanIntakeDraft | null;
  route: (Pick<ParsedPlanRouteDraft, "savedAt" | "value"> & {
    conflicting?: boolean;
    ambiguous?: boolean;
    otherSavedAt?: string | null;
    explicitNightContext?: Partial<NightContext>;
  }) | null;
  planningIntent?: PlanningIntentV1 | null;
};

function latestKnownTime(...dates: (string | null | undefined)[]): number {
  return Math.max(-Infinity, ...dates.map((date) => Date.parse(date ?? "")).filter(Number.isFinite));
}

function recoverRequestOnly(input: DraftRecoveryInput, request: StoredPlanDraft) {
  const { plan, legacyDraft, intake, route } = input;
  const requestPlan = plan?.draft === request ? plan : null;
  const other = requestPlan ? legacyDraft : plan?.draft;
  const copiesAgree = !other || other === request || JSON.stringify(other) === JSON.stringify(request);
  // A route-bound intake cannot supply the inputs of a different, stopless request.
  const local = intake?.routeReference ? null : intake;
  const source = requestedIntentSource(plan, legacyDraft, local);
  const intent = resolveRequestedPlanIntent(plan, legacyDraft, local);
  const requestIntake = copiesAgree && source !== "intake" ? request.requestIntake ?? null : null;
  const localIntake = local && (source === "intake"
    || (copiesAgree && local.savedAt === requestPlan?.savedAt)
    || (requestIntake && JSON.stringify(local.draft) === JSON.stringify(requestIntake))) ? local : null;
  const revoked = request.routeReference === null || (other?.stops.length === 0 && other.routeReference === null)
    || localIntake?.routeReference === null;
  const acceptedAt = Date.parse(input.planningIntent?.acceptedAt ?? "");
  const latestKnown = latestKnownTime(plan?.savedAt, intake?.savedAt, route?.savedAt, route?.otherSavedAt);
  const requestWins = Boolean(copiesAgree && !route?.ambiguous && (!route
    || (requestPlan?.savedAt && Date.parse(requestPlan.savedAt) > Date.parse(route.savedAt ?? ""))));
  return {
    routeWins: false,
    requestOnly: true,
    preserveStoredDrafts: true,
    requestAmbiguous: source === "unknown" || !copiesAgree,
    acceptanceUnavailable: Boolean(route && !requestWins),
    sessionWins: requestWins,
    planDraft: copiesAgree ? requestPlan : null,
    recoveredDraft: {
      ...request,
      ...(revoked ? { routeReference: null } : {}),
      entryMode: copiesAgree && source !== "intake" ? request.entryMode : undefined,
    },
    ...recoveredIntakeState(localIntake, requestIntake, Boolean(localIntake)),
    intent,
    // The legacy request has no date. Only a live explicit acceptance can
    // supply an anchor, and it must be newer than every known conflicting date.
    planningIntent: acceptedAt > latestKnown ? input.planningIntent ?? null : null,
  };
}

export function recoverPlanDrafts(input: DraftRecoveryInput) {
  const { plan, legacyDraft, intake, route } = input;
  const routeTime = Date.parse(route?.savedAt ?? "");
  const request = plan?.draft.stops.length === 0 ? plan.draft : legacyDraft?.stops.length === 0 ? legacyDraft : null;
  // A dated independent route can follow a dated request. A conflicting,
  // undated zero-stop copy cannot establish which side of generation it came from.
  // Intake that refers to the same generated route supports that route. A newer
  // intake with different answers or a different reference still competes with it.
  const routeWins = request ? Boolean(plan && request === plan.draft && plan.savedAt
    && (legacyDraft?.stops.length !== 0 || JSON.stringify(legacyDraft) === JSON.stringify(request))
    && route && !route.ambiguous && !route.value.routeStale
    && routeTime > Date.parse(plan.savedAt)
    && (!intake || routeTime > Date.parse(intake.savedAt) || matchingIntakeRoute(intake, route)))
    : routeSupersedesRequest(plan, route);
  if (request && !routeWins) return recoverRequestOnly(input, request);
  const sessionCopiesAgree = matchingSessionCopies(plan, legacyDraft);
  const intakeDraft = routeWins && !(Date.parse(intake?.savedAt ?? "") >= routeTime) ? null : intake;
  const requestSource = requestedIntentSource(plan, legacyDraft, intakeDraft);
  const intakeWins = Boolean(intakeDraft && requestSource === "intake");
  const matchingRoute = (requestSource !== "unknown" || plan?.legacy === true)
    && (intakeWins ? matchingIntakeRoute(intakeDraft!, route) : matchingSessionRoute(plan, route));
  const sessionWins = sessionSupersedesRoute(plan, route, matchingRoute, sessionCopiesAgree);
  const acceptanceUnavailable = !sessionWins && (route?.ambiguous === true
    || Boolean(route && intakeWins && !matchingRoute)
    || Boolean(route && plan && !routeWins && (!sessionCopiesAgree || !matchingRoute)));
  const planDraft = routeWins || acceptanceUnavailable ? null : plan;
  const draft = routeWins ? null : acceptanceUnavailable && legacyDraft
    ? { ...legacyDraft, acceptedAnchor: undefined } : legacyDraft ?? plan?.draft ?? null;
  const intent = resolveRequestedPlanIntent(routeWins ? null : plan, legacyDraft, intakeDraft);
  const recoveredIntent = recoverExplicitRequestInputs(intent, route,
    routeWins, matchingRoute && requestSource !== "unknown" && sessionCopiesAgree, acceptanceUnavailable);
  const sessionIntake = recoverSessionIntake(plan, legacyDraft, requestSource, routeWins);
  const currentIntake = recoverCurrentIntake(plan, intakeDraft, intakeWins, sessionWins, acceptanceUnavailable, sessionIntake, legacyDraft);
  return {
    routeWins,
    requestOnly: false,
    preserveStoredDrafts: request !== null,
    planningIntent: routeWins || acceptanceUnavailable ? null : input.planningIntent ?? null,
    requestAmbiguous: requestSource === "unknown",
    acceptanceUnavailable,
    sessionWins,
    planDraft,
    recoveredDraft: draft && plan && legacyDraft && plan.draft.entryMode !== legacyDraft.entryMode
      ? { ...draft, entryMode: undefined } : draft,
    ...recoveredIntakeState(currentIntake, sessionIntake, Boolean(intake)),
    intent: routeWins && intakeDraft ? { ...recoveredIntent, descriptionUnavailable: true } : recoveredIntent,
  };
}

type DraftSurface = "map" | "plan" | "route";

export type DraftArbitrationProvenance =
  | "explicit-url"
  | "plan-v2"
  | "plan-legacy"
  | "intake-v1"
  | "route-v2"
  | "route-legacy"
  | "planning-intent"
  | "remembered-area"
  | "default"
  | "none";

type DraftArbitrationConflictCode =
  | "draft-overlap"
  | "intent-preserved-existing"
  | "inspection-not-anchor"
  | "anchor-replaced"
  | "route-anchor-conflict"
  | "route-proof-stale"
  | "operation-replay";

type DraftArbitrationRecoveryAction =
  | "review-plan-details"
  | "review-existing-plan"
  | "make-it-stop-1"
  | "restore-accepted-stop"
  | "regenerate-route"
  | "none";

export type DraftArbitrationConflict = {
  code: DraftArbitrationConflictCode;
  message: string;
  recoveryAction: DraftArbitrationRecoveryAction;
};

type DraftField<T> = {
  value: T;
  source: DraftArbitrationProvenance;
};

type DraftArbitrationDefaults = {
  surface?: DraftSurface;
  area?: PlanningIntentArea;
  startsAt?: string | null;
  acceptedVenueId?: string | null;
  title?: string;
  creatorName?: string;
  conciergeQuery?: string;
};

export type DraftArbitrationUrl = {
  surface: DraftSurface | null;
  selectedVenueId: string | null;
  replaceAnchor: boolean;
};

export type PlanDraftArbitrationInput = {
  url?: Partial<DraftArbitrationUrl> | null;
  planDraft?: ParsedPlanDraft | null;
  routeDraft?: ParsedPlanRouteDraft | null;
  intakeDraft?: ParsedPlanIntakeDraft | null;
  planningIntent?: PlanningIntentV1 | null;
  rememberedArea?: RememberedArea | null;
  defaults?: DraftArbitrationDefaults;
  lastAppliedOperationKey?: string | null;
};

export type PlanDraftArbitrationResult = {
  surface: DraftField<DraftSurface>;
  inspectionVenueId: DraftField<string | null>;
  acceptedVenueId: DraftField<string | null>;
  area: DraftField<PlanningIntentArea>;
  startsAt: DraftField<string | null>;
  title: DraftField<string>;
  creatorName: DraftField<string>;
  conciergeQuery: DraftField<string>;
  routePreview: ParsedPlanRouteDraft | null;
  routeProofPresent: boolean;
  conflicts: DraftArbitrationConflict[];
  hydration: {
    status: "complete";
    defaultsMayWrite: true;
  };
};

function populated(value: string | null | undefined): value is string {
  return typeof value === "string" && Boolean(value.trim());
}

function sourceForPlan(plan: ParsedPlanDraft): DraftArbitrationProvenance {
  return plan.legacy ? "plan-legacy" : "plan-v2";
}

function sourceForRoute(route: ParsedPlanRouteDraft): DraftArbitrationProvenance {
  return route.legacy ? "route-legacy" : "route-v2";
}

function normalizeRememberedArea(value: RememberedArea | null | undefined): PlanningIntentArea {
  if (!value) return null;
  if (value.kind === "borough") return { kind: "borough", name: value.name };
  return NIGHT_PATCHES.some((patch) => patch.id === value.id)
    ? { kind: "night-patch", id: value.id as NightPatchId }
    : null;
}

function sameArea(left: PlanningIntentArea, right: PlanningIntentArea): boolean {
  if (left === null || right === null) return left === right;
  if (left.kind !== right.kind) return false;
  return left.kind === "night-patch" && right.kind === "night-patch"
    ? left.id === right.id
    : left.kind === "borough" && right.kind === "borough" && left.name === right.name;
}

function firstPlanVenue(plan: ParsedPlanDraft | null | undefined): string | null {
  const venueId = plan?.draft.stops.find((stop) => populated(stop.venueId))?.venueId;
  return populated(venueId) ? venueId.trim() : null;
}

function planText(
  plan: ParsedPlanDraft | null | undefined,
  key: keyof Pick<StoredPlanDraft, "title" | "creatorName" | "conciergeQuery">,
  fallback: string | undefined,
): DraftField<string> {
  const value = plan?.draft[key];
  if (plan && populated(value)) return { value, source: sourceForPlan(plan) };
  return fallback !== undefined
    ? { value: fallback, source: "default" }
    : { value: "", source: "none" };
}

function startsAtField(
  plan: ParsedPlanDraft | null | undefined,
  intake: ParsedPlanIntakeDraft | null | undefined,
  intent: PlanningIntentV1 | null,
  fallback: string | null | undefined,
  conflicts: DraftArbitrationConflict[],
): DraftField<string | null> {
  const planValue = populated(plan?.draft.startTime) ? plan.draft.startTime : null;
  const intakeValue = populated(intake?.draft.answers.exactStartIso)
    ? intake.draft.answers.exactStartIso
    : null;

  if (planValue && intakeValue) {
    if (plan?.legacy) {
      if (planValue !== intakeValue) conflicts.push({
        code: "draft-overlap",
        message: "Kept an existing Plan time because its legacy age is unknown.",
        recoveryAction: "review-plan-details",
      });
      return { value: planValue, source: "plan-legacy" };
    }
    const planSavedAt = Date.parse(plan?.savedAt ?? "");
    const intakeSavedAt = Date.parse(intake?.savedAt ?? "");
    const intakeWins = Number.isFinite(intakeSavedAt)
      && (!Number.isFinite(planSavedAt) || intakeSavedAt > planSavedAt);
    if (planValue !== intakeValue) conflicts.push({
      code: "draft-overlap",
      message: intakeWins
        ? "Used the newer intake time and preserved the older Plan draft."
        : "Used the newer Plan time and preserved the intake draft.",
      recoveryAction: "review-plan-details",
    });
    return intakeWins
      ? { value: intakeValue, source: "intake-v1" }
      : { value: planValue, source: "plan-v2" };
  }
  if (plan && planValue) return { value: planValue, source: sourceForPlan(plan) };
  if (intakeValue) return { value: intakeValue, source: "intake-v1" };
  if (intent?.startsAt) return { value: intent.startsAt, source: "planning-intent" };
  if (fallback !== undefined) return { value: fallback, source: "default" };
  return { value: null, source: "none" };
}

function areaField(
  intake: ParsedPlanIntakeDraft | null | undefined,
  intent: PlanningIntentV1 | null,
  rememberedArea: RememberedArea | null | undefined,
  fallback: PlanningIntentArea | undefined,
): DraftField<PlanningIntentArea> {
  if (intake?.draft.answers.area) {
    return {
      value: { kind: "night-patch", id: intake.draft.answers.area },
      source: "intake-v1",
    };
  }
  if (intent?.acceptedArea) return { value: intent.acceptedArea, source: "planning-intent" };
  const remembered = normalizeRememberedArea(rememberedArea);
  if (remembered) return { value: remembered, source: "remembered-area" };
  if (fallback !== undefined) return { value: fallback, source: "default" };
  return { value: null, source: "none" };
}

function acceptedVenueField(
  plan: ParsedPlanDraft | null,
  route: ParsedPlanRouteDraft | null,
  intent: PlanningIntentV1 | null,
  selectedVenueId: string | null,
  replaceAnchor: boolean,
  fallback: string | null | undefined,
  conflicts: DraftArbitrationConflict[],
): DraftField<string | null> {
  const planVenueId = firstPlanVenue(plan);
  let accepted: DraftField<string | null> = planVenueId
    ? { value: planVenueId, source: sourceForPlan(plan as ParsedPlanDraft) }
    : route?.value.anchorVenueId
      ? { value: route.value.anchorVenueId, source: sourceForRoute(route) }
      : intent
        ? { value: intent.acceptedVenueId, source: "planning-intent" }
        : fallback !== undefined
          ? { value: fallback, source: "default" }
          : { value: null, source: "none" };

  if (route?.value.anchorVenueId && planVenueId && route.value.anchorVenueId !== planVenueId) {
    conflicts.push({
      code: "route-anchor-conflict",
      message: "The saved Route starts somewhere different from the current Plan.",
      recoveryAction: "restore-accepted-stop",
    });
  }
  if (intent && accepted.source !== "planning-intent" && accepted.value
    && accepted.value !== intent.acceptedVenueId) {
    conflicts.push({
      code: "intent-preserved-existing",
      message: "Kept existing Plan work instead of replacing it with a newer Venue acceptance.",
      recoveryAction: "review-existing-plan",
    });
  }
  if (selectedVenueId && replaceAnchor) {
    if (accepted.value !== selectedVenueId) conflicts.push({
      code: "anchor-replaced",
      message: "Made the inspected Venue Stop 1 by explicit request.",
      recoveryAction: "restore-accepted-stop",
    });
    accepted = { value: selectedVenueId, source: "explicit-url" };
  } else if (selectedVenueId && accepted.value && selectedVenueId !== accepted.value) {
    conflicts.push({
      code: "inspection-not-anchor",
      message: "You're looking at another venue. Your accepted Stop 1 is unchanged.",
      recoveryAction: "make-it-stop-1",
    });
  }
  return accepted;
}

function addIntentPreservationConflicts(
  intent: PlanningIntentV1 | null,
  area: DraftField<PlanningIntentArea>,
  startsAt: DraftField<string | null>,
  conflicts: DraftArbitrationConflict[],
): void {
  if (intent?.acceptedArea && area.source !== "planning-intent" && !sameArea(area.value, intent.acceptedArea)) {
    conflicts.push({
      code: "intent-preserved-existing",
      message: "Kept the existing Plan area instead of replacing it from Venue acceptance.",
      recoveryAction: "review-existing-plan",
    });
  }
  if (intent?.startsAt && startsAt.source !== "planning-intent" && startsAt.value !== intent.startsAt) {
    conflicts.push({
      code: "intent-preserved-existing",
      message: "Kept the existing Plan time instead of replacing it from Venue acceptance.",
      recoveryAction: "review-existing-plan",
    });
  }
}

function routeWithReplayState(
  route: ParsedPlanRouteDraft | null | undefined,
  lastAppliedOperationKey: string | null | undefined,
  conflicts: DraftArbitrationConflict[],
): ParsedPlanRouteDraft | null {
  if (!route?.value.stops.length) return null;
  let routeStale = route.value.routeStale;
  if (routeStale) conflicts.push({
    code: "route-proof-stale",
    message: "This saved route has gone stale. Draft it again before you lock it in.",
    recoveryAction: "regenerate-route",
  });
  if (
    populated(lastAppliedOperationKey)
    && route.value.operationKey === lastAppliedOperationKey.trim()
  ) {
    routeStale = true;
    conflicts.push({
      code: "operation-replay",
      message: "You already saved this route in another tab.",
      recoveryAction: "regenerate-route",
    });
  }
  return routeStale === route.value.routeStale
    ? route
    : { ...route, value: { ...route.value, routeStale } };
}

/**
 * Resolve persisted state before any component writes product defaults. The
 * function is pure so duplicate tabs and StrictMode hydration receive the same
 * winner without mutating or clearing rollback data.
 */
export function arbitratePlanDrafts(input: PlanDraftArbitrationInput): PlanDraftArbitrationResult {
  const conflicts: DraftArbitrationConflict[] = [];
  const plan = input.planDraft ?? null;
  const route = routeWithReplayState(
    input.routeDraft,
    input.lastAppliedOperationKey,
    conflicts,
  );
  const intent = input.planningIntent ?? null;
  const selectedVenueId = populated(input.url?.selectedVenueId)
    ? input.url.selectedVenueId.trim()
    : null;

  const acceptedVenueId = acceptedVenueField(
    plan,
    route,
    intent,
    selectedVenueId,
    input.url?.replaceAnchor === true,
    input.defaults?.acceptedVenueId,
    conflicts,
  );
  const area = areaField(
    input.intakeDraft,
    intent,
    input.rememberedArea,
    input.defaults?.area,
  );
  const startsAt = startsAtField(
    plan,
    input.intakeDraft,
    intent,
    input.defaults?.startsAt,
    conflicts,
  );
  addIntentPreservationConflicts(intent, area, startsAt, conflicts);

  const surface = input.url?.surface
    ? { value: input.url.surface, source: "explicit-url" as const }
    : { value: input.defaults?.surface ?? "plan", source: "default" as const };

  return {
    surface,
    inspectionVenueId: selectedVenueId
      ? { value: selectedVenueId, source: "explicit-url" }
      : { value: null, source: "none" },
    acceptedVenueId,
    area,
    startsAt,
    title: planText(plan, "title", input.defaults?.title),
    creatorName: planText(plan, "creatorName", input.defaults?.creatorName),
    conciergeQuery: planText(plan, "conciergeQuery", input.defaults?.conciergeQuery),
    routePreview: route,
    routeProofPresent: Boolean(route?.value.groundingProof && !route.value.routeStale),
    conflicts,
    hydration: {
      status: "complete",
      defaultsMayWrite: true,
    },
  };
}
