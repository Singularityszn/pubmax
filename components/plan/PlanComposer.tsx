"use client";

import { isProoflessReleasedRoute, recoverPlanDrafts, resolveRequestedPlanIntent } from "@/lib/planDraftArbitration";

import {
  FormEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";

import { useAuth } from "@/components/auth/AuthProvider";
import { useLiveAccountGeneration } from "@/components/auth/useLiveAccountGeneration";
import { useViewerHandle } from "@/components/auth/useViewerHandle";
import PlanIntake from "@/components/plan/PlanIntake";
import PlanDescribeFirst from "@/components/plan/PlanDescribeFirst";
import PourLine from "@/components/plan/PourLine";
import PlanCultureOpener from "@/components/plan/PlanCultureOpener";
import dynamic from "next/dynamic";
import { SlidersHorizontal } from "lucide-react";
import { buildCrawlMapHref } from "@/lib/crawlUrl";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import { compositeActionSignal } from "@/lib/authedFetch";
import { haptic } from "@/lib/nativeHaptics";
import { PLAN_FIELD_LABEL, PLAN_RESUBMIT_LABEL } from "@/lib/planCopy";
import { moveItem } from "@/lib/planStopReorder";
import {
  measuredLegMinutes, routeHasKnownPintServings, routeHeading, routeStartLabel, routeSummaryLine, type MeasuredLegMinutes,
} from "@/lib/planRouteView";
import { ROUTED_WALK_TRANSPORT_BASIS } from "@/lib/routeLegs";
import type { WalkLegDistance } from "@/lib/walkRoute";
import { discardBody } from "@/lib/responseBody";
import { laneSourceFromSearch, trackEvent, trackMeaningfulCoreAction } from "@/lib/analytics";
import { errorShownKindFromStatus, trackErrorShown } from "@/lib/analyticsErrorShown";
import { ASK_PLAN_DRAFT_STORAGE_KEY, type AskPlanDraft } from "@/lib/ask/types";
import {
  palDraftAnswers,
  palDraftAttemptKept,
  palDraftAttempts,
  palDraftAttemptsStopAt,
  palDraftCheckingLine,
  palDraftRouteLines,
  palPlanDraftFor,
  type PalDraftAttempt,
  type PalPlanDraft,
} from "@/lib/palPlanHandoff";
import {
  PLAN_DESCRIBE_PARAM,
  PLAN_OCCASION_PARAM,
  PLAN_QUERY_PARAM,
  parsePlanDescribeFromSearch,
  parsePlanHandoffQueryFromSearch,
  shouldAutoGeneratePalHandoffPlan,
} from "@/lib/planOccasion";
import { recordPlanNudgeTrigger } from "@/lib/identityNudge";
import { CREW_NAME_MAX, creatorNameFromAccount } from "@/lib/crew";
import { readRememberedPlanHostName, rememberPlanHostName } from "@/lib/planHostName";
import { cleanCultureOpener, type CultureOpenerDTO } from "@/lib/cultureCrawl";
import { readLastCrew, subscribeLastCrew } from "@/lib/lastCrew";
import { getNightArea, isNightAreaRouteReady, NIGHT_AREAS, type NightArea } from "@/lib/nightAreas";
import { nightAreaCoverageMeta } from "@/lib/nightPresentation";
export { nightAreaCoverageMeta } from "@/lib/nightPresentation";
import { nearestNightPatch } from "@/lib/nearestNightPatch";
import { venueAreaClaim } from "@/lib/venueTruth";
import {
  readRememberedArea,
  resolveNightPatch,
  type NightPatch,
} from "@/lib/nightPatches";
import PlanTemplateRow from "@/components/plan/PlanTemplateRow";
import { cleanDryRoundPrices, type DryRoundStopPrices } from "@/lib/dryRound";
import {
  planVenueOptions,
  type PlanVenueOption,
} from "@/lib/planVenueOptions";
import { cleanNightContext, cleanNightContextPatch, inferNightContext, type NightContext } from "@/lib/nightPlanning";
import { planUsesPintPrices } from "@/lib/planGenerationDto";
import { categoryLabel, DRINK_CATEGORIES, type DrinkCategory } from "@/lib/drinks";
import { cleanSelectedDrinkPriceEvidence, type SelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";
import {
  cleanPlanPintPrice, type PlanPintPriceFields, type PlanPintPriceOrigin, type RawPlanPintPriceFields,
} from "@/lib/planPintPrice";
export { selectedDrinkPriceDescription } from "@/lib/planSelectedDrinkPriceEvidence";
import { CITIES, DEFAULT_CITY_ID, type CityId } from "@/lib/cities";
import {
  isPlanStopCount,
  cleanPlanStopCountSource,
  matchPlanStopCount,
  MAX_PLAN_STOP_COUNT,
  normalizePlanStopCount,
  resolvePlanStopCountIntent,
  planOutingNoun,
  planStopCountPhrase,
  PLAN_STOP_COUNTS,
  type PlanStopCount,
  type PlanStopCountSource,
} from "@/lib/planStopCount";
import { planHasRoute, type PlanState } from "@/lib/plan";
import { canonicalPlanDraftForWrite, parsePlanDraft, parsePlanDraftEnvelope, PLAN_DRAFT_KEY, PLAN_DRAFT_V2_KEY, readPlanDraftEnvelope, writePlanDraftEnvelope, type PlanDraftWriteResult, type StoredPlanDraft } from "@/lib/planDraft";
import { parsePlanRouteDraftV2, reconcilePlanRouteDrafts, PLAN_ROUTE_DRAFT_V2_KEY, type ParsedPlanRouteDraft } from "@/lib/planRouteDraft";
import {
  PLANNING_INTENT_SOURCES,
  PLANNING_INTENT_STORAGE_KEY,
  parsePlanningIntent,
  readPlanningIntent,
  settlePlanningIntent,
  type PlanningIntentArea,
  type PlanningIntentSource,
} from "@/lib/planningIntent";
import {
  clearPersistedPlanDrafts,
  composerLockErrorFromResponse,
  londonServiceDateLabel,
  releaseAcceptedPlanContext,
  resolveComposerHydration,
  seedProvisionalStop1,
  UNRESOLVED_ACCEPTED_STOP_LABEL,
  UNRESOLVED_ACCEPTED_VENUE_LABEL,
  UNRESOLVED_ACCEPTED_VENUE_NAME,
  type ComposerHydration,
} from "@/lib/planComposerHandoff";
import {
  composerGeolocationMaySeedIntake,
  mergeSubmittedNightContext,
  mergePlanTemplateFields,
  nightAreaFromPlanQuery,
  reconcileGeneratedNightContext,
  syncPlanIntakeAreaFromQuery,
} from "@/lib/planComposerChipFill";
import { writePlanCapability } from "@/lib/planSessionCapability";
import { planReportLine, rememberPlanReportLine } from "@/lib/planReportLine";
import { markPalRouteActivation } from "@/lib/pubPal";
import { recordPlanHighIntentAction } from "@/lib/nativePushPrompt";
import { clearPersistentPlanMutationKey, preparePlanMutationKey, rememberPlanMutationKey, type StoredMutationKey } from "@/lib/planMutationKey";
import { writeDeviceNightContext } from "@/lib/nightProfileClient";
import { errorMessageFrom, readApiJson } from "@/lib/apiErrorMessage";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";
import {
  buildPlanGenerationIntakeBody,
  clearPlanIntakeDraft,
  canSeedPlanIntakeArea,
  createPlanIntakeDraft,
  defaultLondonStartInput,
  londonDateTimeInputFromIso,
  londonDateTimeInputToIso,
  londonNightsAhead,
  nextLondonOccurrenceIso,
  nightAreaForPlanIntakePatch,
  parsePlanIntakeDraftWithMetadata,
  planIntakeHandoff,
  planIntakeNightContextPatch,
  planIntakeStepHasAnswer,
  PLAN_INTAKE_STORAGE_KEY,
  PLAN_TIME_WINDOWS,
  readPlanIntakeDraftWithMetadata,
  reopenPlanIntakeStep,
  resolveFutureLondonStartIso,
  resolvePlanIntakeAreaSeed,
  settlePlanIntakeStep,
  skipRemainingPlanIntake,
  tonightLondonStartInput,
  writePlanIntakeDraft,
  type PlanIntakeDraft,
  type PlanIntakeStep,
} from "@/lib/planIntake";

// These parts load when the composer renders them. The describe-first arrival
// does not need them and must meet the JS ceiling in perf/route-budgets.json.
// The stop-list and provenance styles live in app/plan/plan.css, so their
// layout is ready before their chunks arrive. Tune details loads its own CSS.
const PlanStopList = dynamic(() => import("@/components/plan/PlanStopList"), {
  ssr: false,
  loading: () => <div className="planStops__placeholder" aria-hidden="true" />,
});
const PlanResultProvenance = dynamic(() => import("@/components/plan/PlanResultProvenance"), {
  ssr: false,
  // It sits inside the fine-print line, held in place so the strip under it does not move.
  loading: () => <span aria-hidden="true">&nbsp;</span>,
});
const PlanTuneSheet = dynamic(() => import("@/components/plan/PlanTuneSheet"), { ssr: false });
const PlanBudgetLedger = dynamic(() => import("@/components/plan/PlanBudgetLedger"), { ssr: false });
const PlanDryRoundLedger = dynamic(() => import("@/components/plan/PlanDryRoundLedger"), { ssr: false });
const PlanRouteMiniMap = dynamic(() => import("@/components/plan/PlanRouteMiniMap"), { ssr: false });

type RouteRevision = string | number;
type RouteAlternative = PlanPintPriceFields & {
  venueId: string;
  venueName: string;
  selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence;
};
export type DraftStop = PlanPintPriceFields & {
  key: number;
  venueId: string;
  venueName: string;
  reason?: string;
  selectedDrinkPriceEvidence?: SelectedDrinkPriceEvidence;
  /** The routed leg into this stop and the venue it was walked from. */
  walkingMinutesFromPrevious?: number | null;
  walkFromVenueId?: string;
  alternatives: RouteAlternative[];
};

export type ComposerRouteMutation = {
  accepted: boolean;
  stops: DraftStop[];
  groundingProof: string | null;
  createOperationKey: string | null;
  planAnchor: GeneratedPlanAnchor | null;
  routeStale: boolean;
};

export function composerRouteMutation(input: {
  currentStops: DraftStop[];
  nextStops: DraftStop[];
  heldVenueId?: string | null;
  groundingProof: string | null;
  createOperationKey: string | null;
  planAnchor: GeneratedPlanAnchor | null;
  routeStale: boolean;
  /** The same venues in a new order. See the proof rule below. */
  reorder?: boolean;
  /** One stop swapped to an alternative the generator offered for it. See the proof rule below. */
  swapToAlternative?: boolean;
}): ComposerRouteMutation {
  const heldVenueId = input.heldVenueId ?? null;
  if (heldVenueId && input.nextStops[0]?.venueId !== heldVenueId) {
    return {
      accepted: false,
      stops: input.currentStops,
      groundingProof: input.groundingProof,
      createOperationKey: input.createOperationKey,
      planAnchor: input.planAnchor,
      routeStale: input.routeStale,
    };
  }
  // A legacy (V1) grounding proof commits to the SET of venues the route may
  // use, so the same venues in a new order are still covered by it. An anchored
  // route carries a V2 proof that binds the exact order (lib/planGrounding.server.ts),
  // so for that route a reorder is an identity change like any other.
  const sameVenueSet = input.currentStops.length === input.nextStops.length
    && new Set(input.currentStops.map((stop) => stop.venueId)).size === input.currentStops.length
    && input.currentStops.every((stop) => input.nextStops.some((next) => next.venueId === stop.venueId));
  if (input.reorder && sameVenueSet && !input.planAnchor) {
    return {
      accepted: true,
      stops: input.nextStops,
      groundingProof: input.groundingProof,
      createOperationKey: input.createOperationKey,
      planAnchor: input.planAnchor,
      routeStale: input.routeStale,
    };
  }
  // The same V1 proof covers every alternative the generator attached to a stop
  // (app/api/plans/generate/route.ts grounds it over the stops plus those
  // alternatives), so swapping to one is still a route the server proved and
  // the night stays lockable without a refresh. The server re-checks the proof
  // at Lock and marks the plan ungrounded if it does not cover a stop, so this
  // can never claim a check that did not happen. An anchored V2 proof binds the
  // exact route, so for that route a swap is an identity change like any other.
  if (input.swapToAlternative && input.groundingProof && !input.planAnchor
    && input.currentStops.length === input.nextStops.length) {
    return {
      accepted: true,
      stops: input.nextStops,
      groundingProof: input.groundingProof,
      createOperationKey: input.createOperationKey,
      planAnchor: input.planAnchor,
      routeStale: input.routeStale,
    };
  }
  const identityChanged = input.currentStops.length !== input.nextStops.length
    || input.currentStops.some((stop, index) => stop.venueId !== input.nextStops[index]?.venueId);
  return {
    accepted: true,
    stops: input.nextStops,
    groundingProof: identityChanged ? null : input.groundingProof,
    createOperationKey: identityChanged ? null : input.createOperationKey,
    planAnchor: input.planAnchor,
    routeStale: identityChanged || input.routeStale,
  };
}

/** A venue that changed no longer owns the walk and the price the old one was given. */
const NO_TIMING_OR_PRICE = {
  walkingMinutesFromPrevious: undefined,
  walkFromVenueId: undefined,
  estimatedPintPricePence: undefined,
  priceKind: undefined,
  pintPriceEvidence: undefined,
} satisfies Partial<DraftStop>;

function venueNightArea(venue: PlanVenueOption | undefined, cityId: CityId): NightContext["nightArea"] {
  if (venue?.lat === undefined || venue.lng === undefined) return null;
  const areas = NIGHT_AREAS.filter((area) => area.cityId === cityId);
  const claim = venueAreaClaim({ latitude: venue.lat, longitude: venue.lng }, areas);
  return areas.find((area) => area.slug === claim.area?.slug)?.slug ?? null;
}

/** The stop a chosen pub makes: a venue record, with nothing of the last one left on it. */
export function pickedPlanStop(stop: DraftStop, venue: PlanVenueOption): DraftStop {
  return {
    key: stop.key,
    venueId: venue.id,
    venueName: venue.name,
    ...NO_TIMING_OR_PRICE,
    alternatives: [],
  };
}

const PLAN_ROUTE_DRAFT_KEY = "pubmaxx:plan-route-draft:v1";

/** The area and daypart a route was sorted for, which a later edit to the night does not move. */
type RouteNight = Pick<Partial<NightContext>, "nightArea" | "daypart">;

export type StoredRouteDraft = {
  savedAt?: string;
  stops: DraftStop[];
  nightContext: NightContext | null;
  explicitNightContext?: Partial<NightContext>;
  routeNight: RouteNight | null;
  routeRevision: RouteRevision | null;
  routeStale: boolean;
  groundingProof: string | null;
  createOperationKey: string | null;
  planAnchor: GeneratedPlanAnchor | null;
};

export type ServerPlanCreationAttribution = {
  created: boolean;
  grounded: boolean;
};

export type GeneratedPlanAnchor = {
  venueId: string;
  source: PlanningIntentSource;
  outcome: "route" | "anchor-only";
};

function cleanGeneratedPlanAnchor(value: unknown): GeneratedPlanAnchor | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { venueId?: unknown; source?: unknown; outcome?: unknown };
  const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
  if (!venueId || venueId.length > 128) return null;
  if (
    typeof row.source !== "string"
    || !(PLANNING_INTENT_SOURCES as readonly string[]).includes(row.source)
  ) return null;
  if (row.outcome !== "route" && row.outcome !== "anchor-only") return null;
  return {
    venueId,
    source: row.source as PlanningIntentSource,
    outcome: row.outcome,
  };
}

/** Read only explicit server-returned anchor metadata. */
export function generatedPlanAnchorFromResponse(value: unknown): GeneratedPlanAnchor | null {
  if (!value || typeof value !== "object") return null;
  const row = value as {
    anchored?: unknown;
    anchorVenueId?: unknown;
    anchorSource?: unknown;
    outcome?: unknown;
  };
  if (row.anchored !== true) return null;
  return cleanGeneratedPlanAnchor({
    venueId: row.anchorVenueId,
    source: row.anchorSource,
    outcome: row.outcome,
  });
}

function generatedRouteFeedback(input: {
  inferredContext: NightContext | undefined;
  submittedContext: Partial<NightContext>;
  generatedAnchor: GeneratedPlanAnchor | null;
  suggested: DraftStop[];
  refreshed: boolean;
}): { reconciled: NightContext | null; conciergeNote: string; routeStatus: string } {
  const { inferredContext, submittedContext, generatedAnchor, suggested, refreshed } = input;
  const anchorOnly = generatedAnchor?.outcome === "anchor-only";
  const reconciled = inferredContext
    ? reconcileGeneratedNightContext(
        inferredContext,
        submittedContext,
        anchorOnly ? normalizePlanStopCount(inferredContext.stopCount) : suggested.length,
      )
    : null;
  const routeStatus = anchorOnly
    ? `We kept ${suggested[0]!.venueName}. We could not build the ${normalizePlanStopCount(reconciled?.stopCount)}-stop route you asked for. Change the details or add pubs.`
    : `${refreshed ? "Route refreshed" : "Route ready"}. Review the preview, then lock it in when it feels right.`;
  const conciergeNote = anchorOnly
    ? routeStatus
    : `${planStopCountPhrase(suggested.length)} we can stand behind, shaped by the outing you set.`;
  return { reconciled, conciergeNote, routeStatus };
}

function routeCheckNotice(confidence: unknown): string {
  if (!confidence || typeof confidence !== "object" || !Array.isArray((confidence as { missingEvidence?: unknown }).missingEvidence)) {
    return "Opening and travel checks are unavailable for this draft.";
  }
  const missing = (confidence as { missingEvidence: unknown[] }).missingEvidence;
  if (missing.some((item) => typeof item !== "string")) return "Opening and travel checks are unavailable for this draft.";
  const opening = missing.includes("opening_hours") || missing.includes("current_opening_hours");
  const travel = missing.includes("transport_anchor") || missing.includes("terminal_get_home");
  return [opening ? "Opening times are not checked." : "", travel ? "Check travel before you go." : ""].filter(Boolean).join(" ");
}

/** Validate attribution returned by POST /api/plans; never source it from draft storage. */
export function serverPlanCreationAttribution(value: unknown): ServerPlanCreationAttribution | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { created?: unknown; grounded?: unknown };
  if (typeof row.created !== "boolean" || typeof row.grounded !== "boolean") return null;
  return { created: row.created, grounded: row.grounded };
}

/** Rebuild the exact server-attributed event on originals and idempotent replays. */
export function planAcceptanceTelemetry(value: unknown, stops: number): { stops: number; grounded: boolean } | null {
  const attribution = serverPlanCreationAttribution(value);
  if (!attribution || !Number.isInteger(stops) || stops < 1 || stops > 50) return null;
  return { stops, grounded: attribution.grounded };
}

/**
 * The unsigned lock count. It needs the server's attribution and nothing else,
 * and stays inside the one-to-ten band the sanitizer accepts.
 */
export function crawlLockedTelemetry(value: unknown, stops: number): { stops: number } | null {
  if (!serverPlanCreationAttribution(value) || !Number.isInteger(stops) || stops < 1 || stops > 10) return null;
  return { stops };
}

/** Rebuild the signed one-Stop save event from server attribution and the submitted anchor. */
export function planDraftSavedTelemetry(
  value: unknown,
  anchor: GeneratedPlanAnchor | null,
  stops: ReadonlyArray<{ venueId: string }>,
): {
  stops: 1;
  grounded: true;
  anchored: true;
  routeReady: false;
  source: PlanningIntentSource;
} | null {
  const attribution = serverPlanCreationAttribution(value);
  if (
    !attribution?.grounded
    || anchor?.outcome !== "anchor-only"
    || stops.length !== 1
    || stops[0]?.venueId !== anchor.venueId
  ) return null;
  return {
    stops: 1,
    grounded: true,
    anchored: true,
    routeReady: false,
    source: anchor.source,
  };
}

/** A created Plan consumes acceptance only when the accepted Venue remains Stop 1. */
export function planCreationConsumesPlanningIntent(
  intent: { acceptedVenueId: string } | null,
  stops: ReadonlyArray<{ venueId: string }>,
): boolean {
  return Boolean(intent && stops[0]?.venueId === intent.acceptedVenueId);
}

/**
 * A created Plan leaves draft the moment it really holds a route. The
 * describe-first journey carries no anchor at all, so its Stops are the only
 * evidence there is; a one-Stop anchor-only draft stays a draft.
 */
export function createdPlanNeedsReadyTransition(state: PlanState): boolean {
  return (state.plan.status ?? "draft") === "draft" && planHasRoute(state.plan, state.stops.length);
}

/**
 * What a just-created Plan still owes its own record, or null when it owes
 * nothing. Creation can come back without the Night Context it was given (the
 * store's context-free fallback while migration 0106 is unapplied), and this
 * is the only place that ever writes one, so a Plan that came back without it
 * gets it here rather than losing it for good.
 */
export function createdPlanMetadataPatch(
  state: PlanState,
  nightContext: NightContext | null,
): { status?: "ready"; context?: NightContext } | null {
  const needsReady = createdPlanNeedsReadyTransition(state);
  const needsContext = Boolean(nightContext) && !state.context;
  if (!needsReady && !needsContext) return null;
  return {
    ...(needsReady ? { status: "ready" as const } : {}),
    ...(nightContext ? { context: nightContext } : {}),
  };
}

function settleConsumedPlanningIntent(stops: ReadonlyArray<{ venueId: string }>, owner: ComposerRequestOwner | null): void {
  if (!ownsAcceptance(owner)) return;
  const storage = composerAcceptanceStorage(safeSessionStorage(), owner, "session");
  if (planCreationConsumesPlanningIntent(readPlanningIntent({ storage, cleanupInvalid: false }), stops)) {
    settlePlanningIntent("plan-created", { storage });
  }
}

function responseEventToken(
  value: unknown,
  key: "planDraftSaved" | "planAccepted" | "meaningfulCoreAction",
): string | null {
  if (!value || typeof value !== "object") return null;
  const tokens = (value as { eventTokens?: unknown }).eventTokens;
  if (!tokens || typeof tokens !== "object") return null;
  const token = (tokens as Record<string, unknown>)[key];
  return typeof token === "string" && token.length <= 2_000 ? token : null;
}

/** Trust only the generator's explicit server-owned grounding assertion. */
export function isGroundedGeneratedRoute(value: unknown, stops: readonly DraftStop[]): boolean {
  if (
    !value
    || typeof value !== "object"
    || (value as { grounded?: unknown }).grounded !== true
    || typeof (value as { groundingProof?: unknown }).groundingProof !== "string"
    || !(value as { groundingProof: string }).groundingProof
  ) return false;
  if (isPlanStopCount(stops.length)) return true;
  const anchor = generatedPlanAnchorFromResponse(value);
  return Boolean(
    anchor?.outcome === "anchor-only"
    && stops.length === 1
    && stops[0]?.venueId === anchor.venueId,
  );
}

function cleanRouteRevision(value: unknown): RouteRevision | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  return null;
}

/** Read the revision wherever the canonical PlanState places it. */
function routeRevisionFromState(value: unknown): RouteRevision | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { routeRevision?: unknown; revision?: unknown; plan?: unknown };
  const direct = cleanRouteRevision(row.routeRevision ?? row.revision);
  if (direct !== null) return direct;
  if (row.plan && typeof row.plan === "object") {
    const plan = row.plan as { routeRevision?: unknown; revision?: unknown };
    return cleanRouteRevision(plan.routeRevision ?? plan.revision);
  }
  return null;
}

function cleanRouteAlternative(value: unknown, priceOrigin: PlanPintPriceOrigin): RouteAlternative | null {
  if (!value || typeof value !== "object") return null;
  const row = value as RawPlanPintPriceFields & {
    venueId?: unknown;
    venueName?: unknown;
    name?: unknown;
    selectedDrinkPriceEvidence?: unknown;
  };
  const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
  const venueName = typeof row.venueName === "string"
    ? row.venueName.trim()
    : typeof row.name === "string" ? row.name.trim() : "";
  if (!venueId || !venueName) return null;
  const selectedDrinkPriceEvidence = cleanSelectedDrinkPriceEvidence(row.selectedDrinkPriceEvidence);
  return {
    venueId,
    venueName,
    ...(selectedDrinkPriceEvidence ? { selectedDrinkPriceEvidence } : {}),
    ...cleanPlanPintPrice(venueId, row, priceOrigin),
  };
}

function routeAlternatives(value: unknown, priceOrigin: PlanPintPriceOrigin): RouteAlternative[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate) => {
    const cleaned = cleanRouteAlternative(candidate, priceOrigin);
    return cleaned ? [cleaned] : [];
  });
}

/**
 * What the generator timed for one stop, read defensively off the
 * wire or a stored draft. A walk is kept only when it was routed on foot: the
 * wire says so in its transport basis, and a stored draft only ever saved one
 * (with the stop it was walked from). A straight-line estimate is not a walk.
 */
function generatedStopTiming(
  row: {
    walkingMinutesFromPrevious?: unknown;
    walkFromVenueId?: unknown;
    operationalEvidence?: unknown;
  },
  previousCandidate: unknown,
  index: number,
): Pick<DraftStop, "walkingMinutesFromPrevious" | "walkFromVenueId"> {
  const previous = previousCandidate as { venueId?: unknown } | undefined;
  const stored = typeof row.walkFromVenueId === "string" && row.walkFromVenueId.trim()
    ? row.walkFromVenueId.trim() : undefined;
  const routed = Boolean(stored) || (
    Boolean(row.operationalEvidence) && typeof row.operationalEvidence === "object"
    && (row.operationalEvidence as { transportBasis?: unknown }).transportBasis === ROUTED_WALK_TRANSPORT_BASIS
  );
  const walkFromVenueId = stored
    ?? (typeof previous?.venueId === "string" && previous.venueId.trim() ? previous.venueId.trim() : undefined);
  const minutes = row.walkingMinutesFromPrevious;
  const walkMinutes = routed && typeof minutes === "number" && Number.isFinite(minutes) && minutes >= 0 && minutes <= 600
    ? Math.round(minutes) : null;
  return {
    ...(index > 0 && walkMinutes !== null && walkFromVenueId
      ? { walkingMinutesFromPrevious: walkMinutes, walkFromVenueId } : {}),
  };
}

/** Keep the generator's alternatives attached to their stop for preview swaps. */
export function routeStopsFromGenerated(value: unknown, alternativePool?: unknown): DraftStop[] {
  return routeStopsFromValue(value, "generated", alternativePool, false);
}

function routeStopsFromValue(
  value: unknown, priceOrigin: PlanPintPriceOrigin, alternativePool: unknown, unfinished: boolean,
): DraftStop[] {
  if (!Array.isArray(value)) return [];
  const candidates = value.slice(0, 6);
  const currentVenueIds = new Set(candidates.flatMap((candidate) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as { venueId?: unknown };
    return typeof row.venueId === "string" && row.venueId.trim() ? [row.venueId.trim()] : [];
  }));
  const pool = routeAlternatives(alternativePool, priceOrigin).filter((alternative, index, all) => (
    !currentVenueIds.has(alternative.venueId)
    && all.findIndex((candidate) => candidate.venueId === alternative.venueId) === index
  ));
  return candidates.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as RawPlanPintPriceFields & {
      venueId?: unknown;
      venueName?: unknown;
      name?: unknown;
      reason?: unknown;
      selectedDrinkPriceEvidence?: unknown;
      walkingMinutesFromPrevious?: unknown;
      walkFromVenueId?: unknown;
      operationalEvidence?: unknown;
      alternatives?: unknown;
      options?: unknown;
    };
    const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
    const venueName = typeof row.venueName === "string"
      ? row.venueName.trim()
      : typeof row.name === "string" ? row.name.trim() : "";
    if (!venueId || !venueName) return unfinished && row.venueId === "" && row.venueName === ""
      ? [{ key: index + 1, venueId: "", venueName: "", alternatives: [] }] : [];
    const nested = routeAlternatives(row.alternatives ?? row.options, priceOrigin);
    const alternatives = [...nested, ...pool].filter((alternative, alternativeIndex, all) => (
      !currentVenueIds.has(alternative.venueId)
      && all.findIndex((candidate) => candidate.venueId === alternative.venueId) === alternativeIndex
    ));
    const selectedDrinkPriceEvidence = cleanSelectedDrinkPriceEvidence(row.selectedDrinkPriceEvidence);
    const timing = generatedStopTiming(row, candidates[index - 1], index);
    return [{
      key: index + 1,
      venueId,
      venueName,
      ...(typeof row.reason === "string" && row.reason.trim() ? { reason: row.reason.trim() } : {}),
      ...(selectedDrinkPriceEvidence ? { selectedDrinkPriceEvidence } : {}),
      ...timing,
      ...cleanPlanPintPrice(venueId, row, priceOrigin),
      alternatives,
    }];
  });
}

/** Cycle to the next grounded alternative and keep the old venue swappable. */
export function swapDraftStop(stop: DraftStop, excludedVenueIds: ReadonlySet<string> = new Set()): DraftStop {
  const nextIndex = stop.alternatives.findIndex((alternative) => !excludedVenueIds.has(alternative.venueId));
  if (nextIndex < 0) return stop;
  const next = stop.alternatives[nextIndex];
  const remaining = stop.alternatives.filter((_, index) => index !== nextIndex);
  if (!next) return stop;
  return {
    ...stop,
    venueId: next.venueId,
    venueName: next.venueName,
    reason: undefined,
    selectedDrinkPriceEvidence: next.selectedDrinkPriceEvidence,
    // The walk to and from this stop was measured for the old pub, so it goes;
    // the price was the generator's for this pub, so it comes with it.
    ...NO_TIMING_OR_PRICE,
    ...cleanPlanPintPrice(next.venueId, next, "stored"),
    alternatives: [
      ...remaining,
      {
        venueId: stop.venueId,
        venueName: stop.venueName,
        ...(stop.selectedDrinkPriceEvidence ? { selectedDrinkPriceEvidence: stop.selectedDrinkPriceEvidence } : {}),
        ...cleanPlanPintPrice(stop.venueId, stop, "stored"),
      },
    ],
  };
}

function sameList(left: string[], right: string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

export function nightContextChanged(before: NightContext | null, after: NightContext | null): boolean {
  if (!before || !after) return before !== after;
  return before.nightArea !== after.nightArea
    || before.daypart !== after.daypart
    || before.partyType !== after.partyType
    || before.groupSize !== after.groupSize
    || before.budget !== after.budget
    || before.budgetLimitPence !== after.budgetLimitPence
    || before.zeroProof !== after.zeroProof
    || before.drinkCategory !== after.drinkCategory
    || before.wetherspoonsPreferred !== after.wetherspoonsPreferred
    || normalizePlanStopCount(before.stopCount) !== normalizePlanStopCount(after.stopCount)
    || !sameList(before.atmosphere, after.atmosphere)
    || !sameList(before.foodNeeds, after.foodNeeds)
    || !sameList(before.accessibility, after.accessibility)
    || !sameList(before.transportConstraints, after.transportConstraints);
}

export function applyPlanStopCount(
  draft: PlanIntakeDraft,
  context: NightContext | null,
  stopCount: PlanStopCount | undefined,
  stopCountSource?: PlanStopCountSource,
): { draft: PlanIntakeDraft; context: NightContext | null } {
  stopCountSource = cleanPlanStopCountSource(stopCountSource, stopCount);
  return {
    draft: draft.answers.stopCount === stopCount && draft.answers.stopCountSource === stopCountSource
      ? draft
      : { ...draft, answers: { ...draft.answers, stopCount, stopCountSource } },
    context: !context || stopCount === undefined || context.stopCount === stopCount
      ? context
      : { ...context, stopCount },
  };
}

function routeNightOf(context: Partial<NightContext> | null): RouteNight | null {
  if (!context?.nightArea && !context?.daypart) return null;
  return {
    ...(context.nightArea ? { nightArea: context.nightArea } : {}),
    ...(context.daypart ? { daypart: context.daypart } : {}),
  };
}

export function parsePlanRouteDraft(raw: string | null): StoredRouteDraft | null {
  if (!raw || raw.length > 30_000) return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredRouteDraft>;
    const stops = routeStopsFromValue(value.stops, "stored", undefined, true);
    if (!stops.length) return null;
    const nightContext = cleanNightContext(value.nightContext) ?? null;
    const explicitNightContext = cleanNightContextPatch(value.explicitNightContext);
    const routeStale = value.routeStale === true;
    const savedAtTime = typeof value.savedAt === "string" ? Date.parse(value.savedAt) : NaN;
    const savedAt = Number.isFinite(savedAtTime)
      && new Date(savedAtTime).toISOString() === value.savedAt
      && savedAtTime <= Date.now() + 5 * 60 * 1000
      ? value.savedAt : undefined;
    return {
      ...(savedAt ? { savedAt } : {}),
      stops,
      nightContext,
      ...(explicitNightContext && Object.keys(explicitNightContext).length ? { explicitNightContext } : {}),
      routeNight: value.routeNight === undefined && !routeStale
        ? routeNightOf(nightContext)
        : routeNightOf(cleanNightContextPatch(value.routeNight)),
      routeRevision: cleanRouteRevision(value.routeRevision),
      routeStale,
      groundingProof: typeof value.groundingProof === "string" && value.groundingProof.length <= 8_000
        ? value.groundingProof
        : null,
      createOperationKey: typeof value.createOperationKey === "string" && value.createOperationKey.length <= 120
        ? value.createOperationKey
        : null,
      planAnchor: cleanGeneratedPlanAnchor(value.planAnchor),
    };
  } catch {
    return null;
  }
}

const COMPOSER_OWNERSHIP_CHANGED = "The saved planning request changed. Reload the plan before continuing.";

function assertComposerOwnership(owned: boolean): void {
  if (!owned) throw new Error(COMPOSER_OWNERSHIP_CHANGED);
}

type ComposerDraftPair = { v1: string | null; v2: string | null };
type ComposerRequestOwner = {
  identity: ComposerHydration["acceptedAnchor"];
  session: Record<string, string | null | undefined> | null;
  local: Record<string, string | null | undefined> | null;
};

function readComposerAcceptanceRecords(): Omit<ComposerRequestOwner, "identity"> {
  function read(storage: Storage | null, keys: string[]): Record<string, string | null | undefined> | null {
    if (!storage) return null;
    return Object.fromEntries(keys.map((key) => {
      try { return [key, storage.getItem(key)]; } catch { return [key, undefined]; }
    }));
  }
  return {
    session: read(safeSessionStorage(), [PLAN_DRAFT_KEY, PLAN_DRAFT_V2_KEY, PLANNING_INTENT_STORAGE_KEY]),
    local: read(safeLocalStorage(), [PLAN_INTAKE_STORAGE_KEY, PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY]),
  };
}

function ownsAcceptance(owner: ComposerRequestOwner | null): boolean {
  if (!owner) return true;
  const current = readComposerAcceptanceRecords();
  const rawIntent = current.session?.[PLANNING_INTENT_STORAGE_KEY];
  const intent = rawIntent ? parsePlanningIntent(rawIntent) : null;
  if (intent && owner.identity) {
    const anchor = owner.identity;
    if (anchor.venueId !== intent.acceptedVenueId || anchor.source !== intent.source
      || anchor.cityId !== intent.cityId || anchor.startsAt !== intent.startsAt
      || anchor.expiresAt !== intent.expiresAt
      || JSON.stringify(anchor.acceptedArea) !== JSON.stringify(intent.acceptedArea)) return false;
  }
  return (["session", "local"] as const).every((scope) => {
    const expected = owner[scope];
    const stored = current[scope];
    return expected === null || stored !== null
      && Object.entries(expected).every(([key, value]) => stored[key] === value);
  });
}

function composerAcceptanceStorage(
  storage: Storage | null,
  owner: ComposerRequestOwner | null,
  scope: "session" | "local",
): Storage | null {
  if (!storage || !owner) return storage;
  function write(key: string, value: string | null) {
    if (!ownsAcceptance(owner)) throw new Error(COMPOSER_OWNERSHIP_CHANGED);
    if (value === null) storage!.removeItem(key);
    else storage!.setItem(key, value);
    const expected = owner![scope];
    if (expected && Object.hasOwn(expected, key) && storage!.getItem(key) === value) expected[key] = value;
  }
  return {
    getItem: (key) => storage.getItem(key),
    setItem: (key, value) => write(key, value),
    removeItem: (key) => write(key, null),
    key: (index) => storage.key(index),
    get length() { return storage.length; },
    clear: () => { throw new Error("Clear individual planning records instead."); },
  };
}
type ComposerGeneratedRelease = {
  operationKey: string;
  provisionalSavedAt: string;
};

function readComposerDraftBytes(storage: Storage | null, v1Key: string, v2Key: string) {
  let v1: string | null | undefined;
  let v2: string | null | undefined;
  try { v1 = storage?.getItem(v1Key); } catch {}
  try { v2 = storage?.getItem(v2Key); } catch {}
  const pair = v1 !== undefined && v2 !== undefined ? { v1, v2 } : null;
  return { v1: v1 ?? null, v2: v2 ?? null, pair };
}

function readComposerSessionDraft() {
  const session = readComposerDraftBytes(safeSessionStorage(), PLAN_DRAFT_KEY, PLAN_DRAFT_V2_KEY);
  const now = Date.now();
  return {
    plan: session.pair ? parsePlanDraftEnvelope(session.v2, session.v1, now) : null,
    legacyDraft: parsePlanDraft(session.v1, now),
    legacyDraftMissing: session.pair?.v1 === null,
  };
}

function composerRoutePreview(
  stops: StoredPlanDraft["stops"],
  savedAt: string | undefined,
  explicitNightContext: StoredRouteDraft["explicitNightContext"],
): StoredRouteDraft {
  return {
    savedAt,
    explicitNightContext,
    stops: stops.map(({ key, venueId, venueName }) => ({ key, venueId, venueName, alternatives: [] })),
    nightContext: null,
    routeNight: null,
    routeRevision: null,
    routeStale: true,
    groundingProof: null,
    createOperationKey: null,
    planAnchor: null,
  };
}

function composerRouteValidationFailed(
  route: StoredRouteDraft | null,
  value: ParsedPlanRouteDraft["value"],
): boolean {
  return value.routeStale && (!route?.routeStale || Boolean(route.groundingProof && !value.groundingProof));
}

function recoverLegacyComposerRoute(
  route: StoredRouteDraft,
  value: ParsedPlanRouteDraft["value"] | undefined,
  planAnchor: GeneratedPlanAnchor | null,
): StoredRouteDraft {
  // Raw V1 supplies rollback stops. The route reader supplies approval.
  if (!value || composerRouteValidationFailed(route, value)) {
    return composerRoutePreview(route.stops, route.savedAt, route.explicitNightContext);
  }
  return {
    ...route,
    routeStale: value.routeStale,
    groundingProof: value.groundingProof,
    createOperationKey: value.operationKey,
    planAnchor,
  };
}

function readComposerRouteDraft(bytes = readComposerDraftBytes(safeLocalStorage(), PLAN_ROUTE_DRAFT_KEY, PLAN_ROUTE_DRAFT_V2_KEY)): {
  route: StoredRouteDraft | null;
  envelope: ParsedPlanRouteDraft | null;
  conflicting: boolean;
  ambiguous: boolean;
  otherSavedAt: string | null;
  pair: ComposerDraftPair | null;
} {
  const { v1, v2, pair } = bytes;
  const route = parsePlanRouteDraft(v1);
  const { envelope, conflicting, ambiguous } = reconcilePlanRouteDrafts(v2, v1);
  const otherSavedAt = ambiguous ? parsePlanRouteDraftV2(v2)?.savedAt ?? null : null;
  const value = envelope?.value;
  const planAnchor: GeneratedPlanAnchor | null = value?.anchorVenueId && value.anchorSource && value.outcome !== "unanchored"
    ? { venueId: value.anchorVenueId, source: value.anchorSource, outcome: value.outcome }
    : null;
  if (value?.stops.some((stop) => !stop.venueId || !stop.venueName)) return {
    conflicting,
    ambiguous,
    otherSavedAt,
    pair,
    envelope,
    route: {
      savedAt: envelope?.savedAt ?? undefined,
      stops: value.stops,
      nightContext: null,
      routeNight: null,
      routeRevision: null,
      routeStale: true,
      groundingProof: null,
      createOperationKey: null,
      planAnchor: null,
    },
  };
  if (!envelope || envelope.legacy) return {
    conflicting,
    ambiguous,
    otherSavedAt,
    pair,
    route: route && recoverLegacyComposerRoute(route, value, planAnchor),
    envelope,
  };
  const canonical = parsePlanRouteDraft(JSON.stringify({
    ...envelope.value,
    savedAt: envelope.savedAt,
    createOperationKey: envelope.value.operationKey,
    planAnchor,
  }));
  const recovered = canonical && (!conflicting && route
    ? { ...canonical, stops: route.stops, routeNight: route.routeNight, explicitNightContext: route.explicitNightContext }
    : canonical);
  return {
    conflicting,
    ambiguous,
    otherSavedAt,
    pair,
    route: recovered && (ambiguous || composerRouteValidationFailed(parsePlanRouteDraft(v2), envelope.value)
      ? composerRoutePreview(recovered.stops, recovered.savedAt, recovered.explicitNightContext)
      : recovered),
    envelope,
  };
}

function composerRouteForHandoff(envelope: ParsedPlanRouteDraft | null) {
  // Keep the stale record available for ordering without recovering its anchor.
  return envelope?.value.routeStale ? null : envelope;
}

function recoveredComposerAnchor(
  records: Omit<Parameters<typeof recoverPlanDrafts>[0], "route">,
  envelope: ParsedPlanRouteDraft | null,
  resolved: ReturnType<typeof recoverPlanDrafts>,
  acceptedAnchor: ComposerHydration["acceptedAnchor"],
): ComposerHydration["acceptedAnchor"] {
  const acceptedIntent = records.planningIntent
    && Date.parse(records.planningIntent.acceptedAt) < Date.parse(envelope?.savedAt ?? "")
    ? records.planningIntent : null;
  const provisionalAnchor = records.plan?.draft.acceptedAnchor ?? (acceptedIntent ? {
    venueId: acceptedIntent.acceptedVenueId,
    source: acceptedIntent.source,
    cityId: acceptedIntent.cityId,
    acceptedArea: acceptedIntent.acceptedArea,
    startsAt: acceptedIntent.startsAt,
    expiresAt: acceptedIntent.expiresAt,
  } : null);
  return (resolved.datedProvisionalSuccessor || resolved.routeWins) && !resolved.acceptanceUnavailable && provisionalAnchor && acceptedAnchor
    && provisionalAnchor.venueId === acceptedAnchor.venueId
    && provisionalAnchor.source === acceptedAnchor.source
    ? provisionalAnchor : acceptedAnchor;
}

function projectComposerRecovery(
  records: Omit<Parameters<typeof recoverPlanDrafts>[0], "route">,
  routeRecovery: ReturnType<typeof readComposerRouteDraft>,
) {
  const resolved = recoverPlanDrafts({
    ...records,
    route: routeRecovery.envelope ? {
      ...routeRecovery.envelope,
      conflicting: routeRecovery.conflicting,
      ambiguous: routeRecovery.ambiguous,
      otherSavedAt: routeRecovery.otherSavedAt,
      explicitNightContext: routeRecovery.route?.explicitNightContext,
    } : null,
  });
  const previewStops = resolved.sessionWins && resolved.planDraft
    ? resolved.planDraft.draft.stops : routeRecovery.route?.stops;
  const sessionCandidatesChanged = resolved.sessionWins
    && JSON.stringify(resolved.planDraft?.draft.stops) !== JSON.stringify(routeRecovery.route?.stops
      .map(({ key, venueId, venueName }) => ({ key, venueId, venueName })));
  const useSessionCandidateDate = sessionCandidatesChanged || (resolved.sessionWins && routeRecovery.ambiguous);
  const needsPreview = (resolved.sessionWins || resolved.acceptanceUnavailable)
    && routeRecovery.route;
  const route = resolved.requestOnly ? { ...routeRecovery, route: null, envelope: null }
    : needsPreview && previewStops?.length ? {
      ...routeRecovery,
      envelope: null,
      route: composerRoutePreview(previewStops,
        useSessionCandidateDate ? resolved.planDraft?.savedAt ?? undefined : routeRecovery.route?.savedAt,
        resolved.intent.explicitNightContext),
    } : routeRecovery;
  let handoff: ComposerHydration | null = null;
  try {
    const candidate = resolveComposerHydration({
      planDraft: resolved.acceptanceUnavailable ? null : resolved.planDraft,
      routeDraft: composerRouteForHandoff(route.envelope),
      intakeDraft: resolved.intakeDraft,
      planningIntent: resolved.planningIntent,
      rememberedArea: resolved.routeWins ? null : readRememberedArea(),
    });
    candidate.acceptedAnchor = recoveredComposerAnchor(records, routeRecovery.envelope, resolved, candidate.acceptedAnchor);
    handoff = candidate.active ? candidate : null;
  } catch {}
  const provisionalRequest = resolved.provisionalRequest || Boolean(seedProvisionalStop1({
    acceptedVenueId: handoff?.heldVenueId,
    recoveredRouteStops: route.route?.stops,
    recoveredPlanStops: resolved.recoveredDraft?.stops,
  }));
  return { ...resolved, provisionalRequest, route, handoff };
}

type ComposerPreviewCopy = {
  route: StoredRouteDraft;
  corroboratedSessionDate: string | null;
  originalPair: ComposerDraftPair;
};

function sameComposerDraftPair(left: ComposerDraftPair | null, right: ComposerDraftPair | null): boolean {
  return Boolean(left && right && left.v1 === right.v1 && left.v2 === right.v2);
}

function canCopyRecoveredRoute(
  corroboratedSessionDate: string | null,
  stored: ReturnType<typeof readComposerRouteDraft>,
  originalPair?: ComposerDraftPair,
): boolean {
  if (!stored.pair || !stored.envelope || !stored.route) return false;
  if (originalPair && !sameComposerDraftPair(originalPair, stored.pair)) return false;
  if (!stored.ambiguous) return true;
  const sessionTime = Date.parse(corroboratedSessionDate ?? "");
  return sessionTime > Date.parse(stored.route.savedAt ?? "")
    && sessionTime > Date.parse(stored.otherSavedAt ?? "");
}

function recoveredPreviewForStorage(
  recovery: ReturnType<typeof projectComposerRecovery>,
  stored: ReturnType<typeof readComposerRouteDraft>,
): ComposerPreviewCopy | null {
  const preview = recovery.route.route;
  if (recovery.recoveredDraft?.provisionalStop || recovery.route === stored || !preview?.routeStale || !stored.route || !stored.pair) return null;
  const corroboratedSessionDate = recovery.sessionWins ? recovery.planDraft?.savedAt ?? null : null;
  if (!canCopyRecoveredRoute(corroboratedSessionDate, stored)) return null;
  // A stale record without proof keeps its rollback bytes when its stops already match.
  const storedPreview = stored.route.routeStale && !stored.route.groundingProof && !stored.route.createOperationKey
    ? composerRoutePreview(stored.route.stops, stored.route.savedAt, stored.route.explicitNightContext) : stored.route;
  return preview.savedAt !== stored.route.savedAt || composerRouteContent(preview) !== composerRouteContent(storedPreview)
    ? { route: preview, corroboratedSessionDate, originalPair: stored.pair } : null;
}

function selectRecoveredComposerIntake(recovery: ReturnType<typeof projectComposerRecovery> | null) {
  const base = recovery?.route.route ? skipRemainingPlanIntake(createPlanIntakeDraft()) : createPlanIntakeDraft();
  return {
    draft: recovery?.requestIntake ?? base,
    hasDurableDraft: recovery?.hasStoredIntake ?? false,
    intent: recovery?.intent ?? resolveRequestedPlanIntent(null, null, null),
  };
}

function acceptedAnchorForPlanDraft(anchor: ComposerHydration["acceptedAnchor"] | undefined, firstVenueId: string | undefined): StoredPlanDraft["acceptedAnchor"] {
  return anchor?.expiresAt && firstVenueId === anchor.venueId
    ? { ...anchor, expiresAt: anchor.expiresAt } : undefined;
}

function keepsProvisionalComposerIntake(input: {
  provisionalRequest: boolean;
  routeSorted: boolean;
  hasRequestWork: boolean;
  conciergeQuery: string;
  recoveredQuery: string;
  startTime: string;
  recoveredRequestStart: string;
  wizardChosen: boolean;
  recoveredDraft: StoredPlanDraft | null;
}): boolean {
  const { provisionalRequest, routeSorted, hasRequestWork, conciergeQuery, recoveredQuery,
    startTime, recoveredRequestStart, wizardChosen, recoveredDraft } = input;
  return provisionalRequest && !routeSorted
    && !hasRequestWork && conciergeQuery === recoveredQuery && startTime === recoveredRequestStart
    && wizardChosen === (recoveredDraft?.entryMode === "wizard");
}

function composerSessionDraftForSave(
  fields: Pick<StoredPlanDraft, "title" | "creatorName" | "startTime" | "conciergeQuery" | "stops" | "requestIntake" | "explicitNightContext" | "requestedStopCountSource">,
  input: {
    provisionalStop: boolean;
    wizardChosen: boolean;
    retainedPreview: ReturnType<typeof retainedComposerPreviewForSave>;
    routeStale: boolean;
    routeSaveRevoked: boolean;
    keepRevocation: boolean;
    routeReference: StoredPlanDraft["routeReference"];
    requestedStopCount: StoredPlanDraft["requestedStopCount"];
    persistedAcceptedAnchor: StoredPlanDraft["acceptedAnchor"];
  },
): StoredPlanDraft {
  const { provisionalStop, wizardChosen, retainedPreview, routeStale, routeSaveRevoked,
    keepRevocation, routeReference, requestedStopCount, persistedAcceptedAnchor } = input;
  return {
    ...fields,
    ...(provisionalStop ? { provisionalStop: true } : {}),
    ...(wizardChosen ? { entryMode: "wizard" } : {}),
    routeReference: retainedPreview?.routeReference ?? (routeStale || routeSaveRevoked || keepRevocation ? null : routeReference),
    ...(requestedStopCount !== undefined ? { requestedStopCount } : {}),
    ...(persistedAcceptedAnchor ? { acceptedAnchor: persistedAcceptedAnchor } : {}),
  };
}

function pendingComposerAcceptanceTime(
  handoff: ComposerHydration | null,
  anchor: StoredPlanDraft["acceptedAnchor"],
  previousSession: ReturnType<typeof readPlanDraftEnvelope>,
): number | null {
  if (!anchor || !handoff?.acceptedIntentAt) return null;
  const savedAnchor = previousSession?.draft.acceptedAnchor;
  if (savedAnchor?.venueId === anchor.venueId && savedAnchor.source === anchor.source
    && savedAnchor.expiresAt === anchor.expiresAt) return null;
  return Date.parse(handoff.acceptedIntentAt);
}

function samePlanRequest(left: StoredPlanDraft, right: StoredPlanDraft | null | undefined): boolean {
  return Boolean(right && JSON.stringify(cleanNightContextPatch(left.explicitNightContext)) === JSON.stringify(cleanNightContextPatch(right.explicitNightContext))
    && (["title", "creatorName", "startTime", "conciergeQuery", "requestedStopCount", "requestedStopCountSource", "acceptedAnchor", "entryMode", "provisionalStop"] as const)
    .every((field) => JSON.stringify(left[field]) === JSON.stringify(right[field])));
}

function savedSessionRequestChanged(draft: StoredPlanDraft, session: ReturnType<typeof readPlanDraftEnvelope>, intake: ReturnType<typeof readPlanIntakeDraftWithMetadata>): boolean {
  if (!session || samePlanRequest(draft, session.draft)) return false;
  return !intake || Date.parse(session.savedAt ?? "") >= Date.parse(intake.savedAt);
}

function samePlanIntake(left: PlanIntakeDraft, right: PlanIntakeDraft): boolean {
  return left.completed === right.completed && (left.completed || left.currentStep === right.currentStep)
    && JSON.stringify(left.settledSteps) === JSON.stringify(right.settledSteps)
    && JSON.stringify(left.skippedSteps) === JSON.stringify(right.skippedSteps)
    && left.answers.stopCount === right.answers.stopCount
    && left.answers.stopCountSource === right.answers.stopCountSource
    && JSON.stringify(planIntakeHandoff(left)) === JSON.stringify(planIntakeHandoff(right));
}

function savedIntakeRequestChanged(intake: ReturnType<typeof readPlanIntakeDraftWithMetadata>, session: ReturnType<typeof readPlanDraftEnvelope>, recovered: PlanIntakeDraft): boolean {
  if (!intake || samePlanIntake(intake.draft, recovered)) return false;
  return !session || Date.parse(intake.savedAt) >= Date.parse(session.savedAt ?? "");
}

function composerRequestMutated(input: {
  actualMutation: boolean;
  routeChanged: boolean;
  hasRequestWork: boolean;
  recoveredDraft: StoredPlanDraft | null;
  sessionDraft: StoredPlanDraft;
  recoveredRequest: StoredPlanDraft;
  previousIntake: ReturnType<typeof readPlanIntakeDraftWithMetadata>;
  previousSession: ReturnType<typeof readPlanDraftEnvelope>;
  recoveredIntake: PlanIntakeDraft;
  sameIntake: boolean | null;
}): boolean {
  return input.actualMutation && (input.routeChanged || input.hasRequestWork || Boolean(input.recoveredDraft
    && savedIntakeRequestChanged(input.previousIntake, input.previousSession, input.recoveredIntake) && !input.sameIntake)
    || Boolean(input.recoveredDraft && savedSessionRequestChanged(input.sessionDraft, input.previousSession, input.previousIntake))
    || !samePlanRequest(input.sessionDraft, input.recoveredRequest));
}

function normalizedComposerRoute(routeDraft: StoredRouteDraft | null): StoredRouteDraft | null {
  return parsePlanRouteDraft(JSON.stringify({ ...routeDraft, savedAt: undefined }));
}

function composerRouteContent(routeDraft: StoredRouteDraft | null): string {
  return JSON.stringify(normalizedComposerRoute(routeDraft));
}

function planRequestSaveTime(editTime: number | null, now: number, input: {
  routeSavedAt: string | undefined;
  sameRequest: boolean;
  previousSession: ReturnType<typeof readPlanDraftEnvelope>;
  sameIntake: boolean | null;
  previousIntake: ReturnType<typeof readPlanIntakeDraftWithMetadata>;
  acceptedIntentTime: number | null;
}): number {
  const { routeSavedAt, sameRequest, previousSession, sameIntake, previousIntake, acceptedIntentTime } = input;
  const savedTimes = [
    Date.parse(routeSavedAt ?? ""),
    sameRequest && previousSession ? Date.parse(previousSession.savedAt ?? "") : NaN,
    sameIntake ? Date.parse(previousIntake?.savedAt ?? "") : NaN,
    acceptedIntentTime ?? NaN,
  ];
  if (editTime !== null) return editTime;
  const dated = savedTimes.filter(Number.isFinite);
  return !dated.length ? now : Math.max(...dated);
}

function persistComposerRouteDraft(
  routeDraft: StoredRouteDraft,
  mayWrite: boolean,
  passivePreview: ComposerPreviewCopy | null,
  owner: ComposerRequestOwner | null,
) {
  const hasRouteDetails = Boolean(routeDraft.nightContext || routeDraft.routeNight || routeDraft.routeRevision !== null
    || routeDraft.groundingProof || routeDraft.createOperationKey || routeDraft.planAnchor
    || routeDraft.stops.some((stop) => stop.alternatives.length > 0));
  const routeStorage = composerAcceptanceStorage(safeLocalStorage(), owner, "local");
  let routeSaved = false;
  let previewSaved = false;
  if (hasRouteDetails || routeDraft.routeStale) {
    const storedRecovery = readComposerRouteDraft();
    const stored = storedRecovery.route;
    const storedTime = Date.parse(stored?.savedAt ?? "");
    const copyTime = Date.parse(routeDraft.savedAt ?? "");
    const newerStoredRoute = Number.isFinite(storedTime) && (!Number.isFinite(copyTime) || storedTime > copyTime);
    const mayReplaceStoredRoute = !passivePreview || canCopyRecoveredRoute(
      passivePreview.corroboratedSessionDate, storedRecovery, passivePreview.originalPair,
    );
    previewSaved = !hasRouteDetails && !storedRecovery.ambiguous && Boolean(stored && stored.stops.length === routeDraft.stops.length
      && stored.stops.every((stop, index) => stop.venueId === routeDraft.stops[index]?.venueId
        && stop.venueName === routeDraft.stops[index]?.venueName));
    try {
      if (routeStorage && mayWrite && mayReplaceStoredRoute && !newerStoredRoute && (hasRouteDetails || !previewSaved || stored?.savedAt)) {
        routeStorage.setItem(PLAN_ROUTE_DRAFT_KEY, JSON.stringify({
          savedAt: routeDraft.savedAt,
          ...routeDraft,
          explicitNightContext: Object.values(routeDraft.explicitNightContext ?? {}).some((value) => value !== undefined)
            ? routeDraft.explicitNightContext : undefined,
        }));
      }
    } catch {
    }
    const remaining = readComposerRouteDraft().route;
    previewSaved = previewSaved && JSON.stringify(remaining) === JSON.stringify(stored);
    routeSaved = Boolean(remaining && remaining.savedAt === routeDraft.savedAt
      && composerRouteContent(remaining) === composerRouteContent(routeDraft));
  }
  return { hasRouteDetails, routeSaved, previewSaved, routeReference: composerRouteReference(routeDraft, routeSaved) };
}

function composerRouteReference(routeDraft: StoredRouteDraft, saved: boolean): StoredPlanDraft["routeReference"] {
  const stored = saved ? readComposerRouteDraft().envelope : null;
  return stored && stored.savedAt && !stored.value.routeStale && !routeDraft.routeStale
    && stored.savedAt === routeDraft.savedAt && stored.value.operationKey === routeDraft.createOperationKey
    && stored.value.operationKey && stored.value.groundingProof
    ? { savedAt: stored.savedAt, operationKey: stored.value.operationKey } : undefined;
}

function releasedComposerRouteReference(
  release: ComposerGeneratedRelease | null,
  previousSession: ReturnType<typeof readPlanDraftEnvelope>,
  writtenSession: PlanDraftWriteResult,
  saved: { routeChanged: boolean; routeSaved: boolean; savedAt: string | undefined },
): StoredPlanDraft["routeReference"] {
  if (!release || !saved.routeChanged || !saved.routeSaved || writtenSession.v1 || writtenSession.v2
    || previousSession?.draft.provisionalSavedAt !== release.provisionalSavedAt) return undefined;
  const { pair, envelope, ambiguous } = readComposerRouteDraft();
  return pair && envelope?.savedAt && !ambiguous && envelope.savedAt === saved.savedAt
    && envelope.value.operationKey === release.operationKey && isProoflessReleasedRoute(envelope.value)
    ? { savedAt: envelope.savedAt, operationKey: release.operationKey } : undefined;
}

type ComposerRouteCopy = {
  identity: string;
  content: string;
  savedAt: string | undefined;
  generation: number;
  pending: boolean;
};

function saveComposerRouteCopy(
  routeDraft: StoredRouteDraft,
  routeCopy: { current: ComposerRouteCopy },
  input: {
    savedAt: number;
    successfulGeneration: number;
    actualMutation: boolean;
    preserveStoredDrafts: boolean;
    recoveredRouteDraft: StoredRouteDraft | null;
    recoveredPreviewToCopy: ComposerPreviewCopy | null;
    owner: ComposerRequestOwner | null;
  },
) {
  const { savedAt, successfulGeneration, actualMutation, preserveStoredDrafts, recoveredRouteDraft, recoveredPreviewToCopy } = input;
  const passivePreview = !actualMutation && routeCopy.current.pending ? recoveredPreviewToCopy : null;
  const { stops, planAnchor, nightContext } = routeDraft;
  const identity = JSON.stringify({ stops, planAnchor, nightContext });
  const content = composerRouteContent(routeDraft);
  const generationChanged = successfulGeneration !== routeCopy.current.generation;
  const routeChanged = stops.length > 0 && (identity !== routeCopy.current.identity || generationChanged);
  let mayWrite = content !== routeCopy.current.content || routeCopy.current.pending;
  if (routeChanged) {
    const routeSavedAt = actualMutation || generationChanged
      ? new Date(savedAt).toISOString() : routeCopy.current.savedAt;
    routeCopy.current = { identity, content, savedAt: routeSavedAt, generation: successfulGeneration, pending: false };
    mayWrite = true;
  }
  routeCopy.current.content = content;
  routeCopy.current.pending = false;
  const mayPersistRoute = stops.length > 0 && (!preserveStoredDrafts || recoveredRouteDraft || successfulGeneration > 0);
  const routeToRead = passivePreview?.route ?? { ...routeDraft, savedAt: routeCopy.current.savedAt };
  const mayWriteRoute = actualMutation ? mayWrite : passivePreview !== null;
  const saved = mayPersistRoute
    ? persistComposerRouteDraft(routeToRead, mayWriteRoute, passivePreview, input.owner)
    : { hasRouteDetails: false, routeSaved: false, previewSaved: false, routeReference: undefined };
  return { routeChanged, ...saved };
}

function readRetainedComposerPreview(
  routeDraft: StoredRouteDraft,
  reference: NonNullable<StoredPlanDraft["routeReference"]>,
  intake: ReturnType<typeof readPlanIntakeDraftWithMetadata>,
) {
  const stored = readComposerRouteDraft();
  const envelope = stored.envelope;
  const previewSaved = Boolean(stored.pair && !stored.ambiguous && envelope
    && (envelope.value.routeStale || isProoflessReleasedRoute(envelope.value))
    && envelope.value.groundingProof === null && envelope.savedAt === reference.savedAt
    && envelope.value.operationKey === reference.operationKey
    && composerStopIdentity(envelope.value.stops) === composerStopIdentity(routeDraft.stops));
  // Older writers kept explicit inputs in V1 alone. Use the current validated
  // route for that fallback, so a replaced record cannot certify this edit.
  const context = intake?.explicitNightContext
    ?? (previewSaved && envelope?.legacy ? stored.route?.explicitNightContext : undefined);
  const matchesIntake = intake?.routeReference?.savedAt === reference.savedAt
    && intake.routeReference.operationKey === reference.operationKey
    && JSON.stringify(context) === JSON.stringify(cleanNightContextPatch(routeDraft.explicitNightContext) ?? undefined);
  return {
    routeChanged: false, hasRouteDetails: false, routeSaved: false, previewSaved,
    routeReference: previewSaved && matchesIntake ? reference : undefined,
  };
}

function retainedComposerPreviewForSave(
  routeDraft: StoredRouteDraft,
  input: {
    reference: NonNullable<StoredPlanDraft["routeReference"]> | null;
    routeSorted: boolean;
    routeSaveRevoked: boolean;
    successfulGeneration: number;
    hasRequestWork: boolean;
    conciergeQuery: string;
    recoveredQuery: string;
    startTime: string;
    recoveredStartTime: string;
    wizardChosen: boolean;
    recoveredDraft: StoredPlanDraft | null;
    recoveredRouteDraft: StoredRouteDraft | null;
    sameIntake: boolean | null;
    previousIntake: ReturnType<typeof readPlanIntakeDraftWithMetadata>;
  },
) {
  return input.reference && input.routeSorted && routeDraft.routeStale && !input.routeSaveRevoked
    && !input.successfulGeneration && !input.hasRequestWork && input.conciergeQuery === input.recoveredQuery
    && input.startTime === input.recoveredStartTime && input.wizardChosen === (input.recoveredDraft?.entryMode === "wizard")
    && composerRouteContent(routeDraft) === composerRouteContent(input.recoveredRouteDraft)
    ? readRetainedComposerPreview(routeDraft, input.reference, input.sameIntake ? input.previousIntake : null)
    : null;
}

function canSaveRecoveredComposerDraft(
  stops: DraftStop[],
  preserveStoredDrafts: boolean,
  recoveredRouteDraft: StoredRouteDraft | null,
  acceptedIntentTime: number | null,
  recoveredPreviewReference: StoredPlanDraft["routeReference"],
): boolean {
  return !recoveredPreviewReference && stops.length > 0 && !preserveStoredDrafts && Boolean(recoveredRouteDraft || acceptedIntentTime !== null);
}

function canSaveRecoveredComposerRequest(
  requestAmbiguous: boolean,
  routeSavedAt: string | undefined,
  acceptedIntentTime: number | null,
): boolean {
  return !requestAmbiguous && (routeSavedAt !== undefined || acceptedIntentTime !== null);
}

function persistComposerIntake(
  draft: PlanIntakeDraft,
  savedAt: number,
  request: StoredPlanDraft,
  actualMutation: boolean,
  input: {
    retainedPreview: ReturnType<typeof retainedComposerPreviewForSave>;
    hasDurableIntakeDraft: boolean;
    hasRequestWork: boolean;
    previousIntake: ReturnType<typeof readPlanIntakeDraftWithMetadata>;
    requestedStopCount: PlanStopCount | undefined;
    owner: ComposerRequestOwner | null;
  },
): boolean {
  if (!ownsAcceptance(input.owner)) return false;
  return !input.retainedPreview && (input.hasDurableIntakeDraft || input.hasRequestWork || (!input.previousIntake && input.requestedStopCount !== undefined))
    ? actualMutation && writePlanIntakeDraft(draft, composerAcceptanceStorage(safeLocalStorage(), input.owner, "local"), savedAt, request.routeReference, request.explicitNightContext)
    : false;
}

function preserveComposerRouteRevocation(
  routeSorted: boolean,
  recoveredDraft: StoredPlanDraft | null,
  previousIntake: ReturnType<typeof readPlanIntakeDraftWithMetadata>,
): boolean {
  return !routeSorted && (recoveredDraft?.routeReference === null || previousIntake?.routeReference === null);
}

type ComposerDraftSaveFailure = "all" | "route" | "route-details" | "description" | "request" | null;

function composerStopIdentity(stops: StoredPlanDraft["stops"]): string {
  return JSON.stringify(stops.map(({ venueId, venueName }) => venueId ? { venueId } : { venueName }));
}

function composerRouteRecoveryContent(routeDraft: StoredRouteDraft): string {
  const route = normalizedComposerRoute(routeDraft);
  return JSON.stringify(route && {
    ...route,
    stops: route.stops.map((stop) => ({ ...stop, venueName: stop.venueId ? "" : stop.venueName })),
  });
}

function composerRouteDetailsRecovered(
  expected: StoredRouteDraft,
  routeSorted: boolean,
  recovery: ReturnType<typeof projectComposerRecovery>,
): boolean {
  if (!routeSorted) return true;
  const selected = recovery.route.route;
  if (expected.routeStale) return selected?.routeStale ?? Boolean(recovery.recoveredDraft?.stops.length);
  return Boolean(selected && selected.savedAt === expected.savedAt
    && composerRouteRecoveryContent(selected) === composerRouteRecoveryContent(expected));
}

function certifyComposerRecovery(input: {
  draft: StoredPlanDraft;
  intakeDraft: PlanIntakeDraft;
  routeDraft: StoredRouteDraft;
  routeSorted: boolean;
  records: Omit<Parameters<typeof recoverPlanDrafts>[0], "route">;
}) {
  const { draft, intakeDraft, routeDraft, routeSorted, records } = input;
  const recovery = projectComposerRecovery({
    ...records,
    planningIntent: readPlanningIntent({ cleanupInvalid: false }),
  }, readComposerRouteDraft());
  const { recoveredDraft, handoff, intent } = recovery;
  const fields = initialComposerDraftFields(handoff, recoveredDraft);
  const startTime = typeof fields.startTime === "function" ? fields.startTime() : fields.startTime;
  const stops = initialComposerStops(recovery.route.route, recoveredDraft, handoff);
  const recoveredRequest: StoredPlanDraft = {
    ...fields,
    startTime,
    stops,
    conciergeQuery: intent.conciergeQuery,
    requestedStopCount: intent.stopCount,
    requestedStopCountSource: intent.stopCountSource,
    explicitNightContext: intent.explicitNightContext,
    entryMode: recoveredDraft?.entryMode,
    provisionalStop: recoveredDraft?.provisionalStop,
    acceptedAnchor: acceptedAnchorForPlanDraft(handoff?.acceptedAnchor, stops[0]?.venueId),
  };
  const recoveredIntake = initialComposerIntake(selectRecoveredComposerIntake(recovery).draft,
    intent.stopCount, intent.stopCountSource, startTime);
  const requestSaved = samePlanRequest(draft, recoveredRequest) && samePlanIntake(intakeDraft, recoveredIntake);
  const descriptionLost = Boolean(draft.conciergeQuery.trim()) && draft.conciergeQuery !== recoveredRequest.conciergeQuery;
  const requestLoss = requestSaved ? null : descriptionLost ? "description" as const : "request" as const;
  const stopsLost = composerStopIdentity(routeDraft.stops) !== composerStopIdentity(stops);
  const routeDetailsLost = !stopsLost && !composerRouteDetailsRecovered(routeDraft, routeSorted, recovery);
  return { requestLoss, stopsLost, routeDetailsLost };
}

function readComposerIntakeForSave(): ReturnType<typeof readPlanIntakeDraftWithMetadata> {
  try {
    return parsePlanIntakeDraftWithMetadata(safeLocalStorage()?.getItem(PLAN_INTAKE_STORAGE_KEY) ?? null);
  } catch {
    return null;
  }
}

function composerRequestSaveStatus(input: {
  draft: StoredPlanDraft;
  intakeDraft: PlanIntakeDraft;
  writtenSession: { v1: boolean; v2: boolean };
  writtenIntake: boolean;
  savedAt: number;
  routeDraft: StoredRouteDraft;
  routeSorted: boolean;
  actualMutation: boolean;
  requestChanged: boolean;
  retainsPreview: boolean;
}) {
  const { draft, intakeDraft, writtenSession, writtenIntake, savedAt, routeDraft, routeSorted } = input;
  const { routeStale } = routeDraft;
  const canonicalRequest = (value: StoredPlanDraft) => {
    const canonical = canonicalPlanDraftForWrite(value, Date.now());
    return JSON.stringify(canonical && { ...canonical, provisionalSavedAt: undefined });
  };
  const canonical = canonicalRequest(draft);
  const { plan: envelope, legacyDraft, legacyDraftMissing } = readComposerSessionDraft();
  let v2Draft = envelope?.draft;
  if (!input.actualMutation && v2Draft && !v2Draft.requestIntake) v2Draft = { ...v2Draft, requestIntake: draft.requestIntake };
  if (routeStale && draft.routeReference === null && v2Draft && v2Draft.routeReference === undefined
    && envelope?.savedAt === new Date(savedAt).toISOString()) v2Draft = { ...v2Draft, routeReference: null };
  let legacy = legacyDraft;
  if (!input.actualMutation && legacy && !legacy.requestIntake) legacy = { ...legacy, requestIntake: draft.requestIntake };
  const v1 = Boolean(legacy && canonicalRequest(legacy) === canonical);
  const intake = readComposerIntakeForSave();
  const sessionWrite = {
    v1: writtenSession.v1 || v1,
    v2: writtenSession.v2 || Boolean(envelope && !envelope.legacy && v2Draft && canonicalRequest(v2Draft) === canonical),
  };
  const matchingIntake = intake && samePlanIntake(intakeDraft, intake.draft) && (input.retainsPreview && draft.routeReference
    ? Boolean(readRetainedComposerPreview(routeDraft, draft.routeReference, intake).routeReference)
    : JSON.stringify(intake.routeReference) === JSON.stringify(draft.routeReference)
      && JSON.stringify(intake.explicitNightContext) === JSON.stringify(cleanNightContextPatch(draft.explicitNightContext) ?? undefined));
  const certificate = input.requestChanged
    ? certifyComposerRecovery({ draft, intakeDraft, routeDraft, routeSorted, records: { plan: envelope, legacyDraft, legacyDraftMissing, intake } })
    : null;
  return { sessionWrite, intakeSaved: writtenIntake || Boolean(matchingIntake), certificate };
}

function composerDraftSaveFailure(input: {
  hasRequestWork: boolean;
  sessionWrite: { v1: boolean; v2: boolean };
  intakeSaved: boolean;
  hasStops: boolean;
  routeSaved: boolean;
  previewSaved: boolean;
  hasRouteDetails: boolean;
  certificate: ReturnType<typeof certifyComposerRecovery> | null;
}): ComposerDraftSaveFailure {
  const { v1, v2 } = input.sessionWrite;
  if ((input.hasRequestWork || input.hasStops) && !v1 && !v2 && !input.intakeSaved) return "all";
  if (input.certificate?.stopsLost) return "route";
  if (input.certificate?.routeDetailsLost) return "route-details";
  if (input.hasStops && !input.routeSaved && !input.previewSaved && (input.hasRouteDetails || (!v1 && !v2))) {
    return v1 && v2 ? "route-details" : "route";
  }
  return input.certificate?.requestLoss ?? null;
}

export type NightAreaSelectorGroup = {
  label: "Crawl-ready" | "Not crawl-ready yet";
  disabled: boolean;
  areas: NightArea[];
};

export function nightAreaSelectorGroups(now = new Date()): NightAreaSelectorGroup[] {
  return [
    {
      label: "Crawl-ready",
      disabled: false,
      areas: NIGHT_AREAS.filter((area) => isNightAreaRouteReady(area, now)),
    },
    {
      label: "Not crawl-ready yet",
      disabled: false,
      areas: NIGHT_AREAS.filter((area) => !isNightAreaRouteReady(area, now)),
    },
  ];
}

export function nightAreaOptionLabel(area: NightArea, disabled: boolean): string {
  return disabled || !isNightAreaRouteReady(area) ? `${area.name}, not crawl-ready yet` : area.name;
}

export function nightAreaMapHref(area: NightArea): import("next").Route {
  return `/map?q=${encodeURIComponent(area.name)}`;
}

export const PLAN_INTAKE_CONFLICT_SERVER =
  "Plan intake skipped steps conflict with supplied answers.";
export const PLAN_INTAKE_CONFLICT_READER =
  "The earlier route is still here. Start again or keep it.";
export const PLAN_INTAKE_CONFLICT_NO_ROUTE =
  "That answer clashed with an earlier step. Start again from the first question.";
export function releasedAcceptanceStatus(input: {
  venueName: string | null;
}): string {
  const pub = input.venueName?.trim() || "this pub";
  return `Released ${pub}. Stop 1 is yours to change.`;
}

export function errorMessageFromBody(body: unknown, fallback: string): string {
  // Concierge / plan generate scarcity must stay the server's sentence. Never
  // replace a grounded 422 with a softer invented route or a generic shrug.
  if (!body || typeof body !== "object") return errorMessageFrom(body, fallback);
  const error = (body as { error?: unknown }).error;
  if (error && typeof error === "object") {
    const structuredError = error as { code?: unknown; message?: unknown };
    if (
      structuredError.code === "NIGHT_AREA_ROUTE_NOT_READY" ||
      structuredError.code === "DISTRICT_ROUTE_NOT_READY"
    ) {
      const payload = body as {
        nightArea?: { id?: unknown };
        district?: { id?: unknown };
      };
      const areaId = payload.nightArea?.id ?? payload.district?.id;
      const area = NIGHT_AREAS.find((candidate) => candidate.slug === areaId);
      const areaName = area?.name ?? "This area";
      return `${areaName} is not ready for route planning yet. We're still checking this area before planning a crawl. Choose another area to continue.`;
    }
    if (
      structuredError.code === "PLAN_INTAKE_MALFORMED"
      && structuredError.message === PLAN_INTAKE_CONFLICT_SERVER
    ) {
      return PLAN_INTAKE_CONFLICT_READER;
    }
  }
  const raw = errorMessageFrom(body, fallback);
  return raw === PLAN_INTAKE_CONFLICT_SERVER ? PLAN_INTAKE_CONFLICT_READER : raw;
}

const NO_VENUES_MATCHED = "No venues matched that ask. Try a nearby area or a broader mood.";

/**
 * An anchor conflict answers HTTP 200 with no Stops, so the empty-route branch
 * would otherwise print "No venues matched that ask" over the server's own
 * sentence about the accepted pub. The server sentence is the only one that
 * names what is actually in the way, so it wins whenever the outcome says so.
 */
export function anchorConflictMessage(body: unknown): string | null {
  if (!body || typeof body !== "object") return null;
  const payload = body as { outcome?: unknown; message?: unknown };
  if (payload.outcome !== "anchor-conflict") return null;
  const message = typeof payload.message === "string" ? payload.message.trim() : "";
  return message || "We could not build a route from that pub right now. Try a different pub.";
}

export function planGenerationFailureStatus(
  message: string,
  hasPreviousRoute: boolean,
): string {
  if (
    message === PLAN_INTAKE_CONFLICT_SERVER
    || message === PLAN_INTAKE_CONFLICT_READER
    || message === PLAN_INTAKE_CONFLICT_NO_ROUTE
  ) {
    return hasPreviousRoute ? PLAN_INTAKE_CONFLICT_READER : PLAN_INTAKE_CONFLICT_NO_ROUTE;
  }
  return hasPreviousRoute ? `The previous route is still here. ${message}` : message;
}

export function acceptedPlanAreaLabel(area: Exclude<PlanningIntentArea, null>): string {
  if (area.kind === "borough") return area.name;
  const slug = nightAreaForPlanIntakePatch(area.id);
  if (slug) return getNightArea(slug).name;
  return resolveNightPatch(area.id)?.label ?? area.id;
}

export function acceptedStop1SwapLabel(venueName: string): string {
  return `${venueName} is the accepted Stop 1. Swap is not available.`;
}

export function acceptedStop1RemoveLabel(venueName: string): string {
  return `${venueName} is the accepted Stop 1. Remove is not available.`;
}

export function planComposerShowsDescribeFirst(input: {
  heldVenueId: string | null;
  completed: boolean;
  entryMode: "describe" | "wizard";
}): boolean {
  return !input.heldVenueId && !input.completed && input.entryMode === "describe";
}

export function planComposerShowsIntake(input: {
  heldVenueId: string | null;
  completed: boolean;
  entryMode: "describe" | "wizard";
}): boolean {
  if (input.heldVenueId && !input.completed) return false;
  return input.completed || input.entryMode === "wizard";
}

function focusPlanRouteStatus(root: ParentNode | Document = document): void {
  const status = root.querySelector("#plan-route-status");
  if (!(status instanceof HTMLElement)) return;
  status.tabIndex = -1;
  status.focus();
}

/** Reduced motion means no glide, never no move: the viewport still lands on
 *  the route, it just jumps there. */
export function planRouteRevealBehavior(reducedMotion: boolean): ScrollBehavior {
  return reducedMotion ? "auto" : "smooth";
}

/**
 * Feedback can land below the fold after generation or Tune dismissal.
 * Reveal and focus the error first so a failed request cannot appear silent.
 * Errors move immediately, even when ordinary route feedback uses smooth scrolling.
 */
export function revealPlanRouteStatus(
  root: ParentNode | Document = document,
  reducedMotion?: boolean,
): void {
  const status = root.querySelector("#plan-composer-error") ?? root.querySelector("#plan-route-status");
  if (!(status instanceof HTMLElement) || !status.textContent?.trim()) return;
  const reduce =
    reducedMotion ??
    (typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  status.scrollIntoView?.({
    behavior: status.id === "plan-composer-error" ? "instant" : planRouteRevealBehavior(reduce),
    block: "start",
  });
  status.tabIndex = -1;
  status.focus({ preventScroll: true });
}

export type PlanLockValidationInput = {
  title: string;
  creatorName: string;
  startTime: string;
  completeStopCount: number;
  visibleStopCount: number;
  groundingProof?: string | null;
  singleStopVenueId?: string | null;
  planAnchor?: GeneratedPlanAnchor | null;
};

export function isMatchingAnchorOnlyPlan(input: {
  groundingProof?: string | null;
  completeStopCount: number;
  singleStopVenueId?: string | null;
  planAnchor?: GeneratedPlanAnchor | null;
}): boolean {
  return Boolean(
    input.groundingProof
    && input.completeStopCount === 1
    && input.singleStopVenueId
    && input.planAnchor?.outcome === "anchor-only"
    && input.planAnchor.venueId === input.singleStopVenueId,
  );
}

/**
 * The crawl an ask drafted for THIS ask, spent once (lib/palPlanHandoff.ts).
 * The one-shot read of the session draft holds it in `held`; the session copy
 * is the fallback for a draft that read has not reached yet.
 */
function takePalDraft(held: { current: PalPlanDraft | null }, query: string): PalPlanDraft | null {
  let draft = held.current && palDraftAnswers(held.current, query) ? held.current : null;
  if (!draft && !held.current) {
    try {
      const store = safeSessionStorage();
      draft = palPlanDraftFor(store?.getItem(ASK_PLAN_DRAFT_STORAGE_KEY) ?? null, query);
      // The draft is one-shot: the generation that reads it spends it.
      if (draft) store?.removeItem(ASK_PLAN_DRAFT_STORAGE_KEY);
    } catch {
      draft = null;
    }
  }
  if (draft) held.current = null;
  return draft;
}

/**
 * POST /api/plans/generate once per attempt until one is taken. The attempts
 * always end with the plain ask, which is always taken, so its own success or
 * error reads as it always did.
 */
async function requestPlanGeneration(
  draft: PalPlanDraft | null,
  attempts: readonly PalDraftAttempt[],
  bodyFor: (attempt: PalDraftAttempt) => unknown,
  signal: AbortSignal,
): Promise<{ response: Response; body: unknown; attempt: PalDraftAttempt }> {
  let last: { response: Response; body: unknown; attempt: PalDraftAttempt } | null = null;
  for (const attempt of attempts) {
    signal.throwIfAborted();
    const response = await fetch("/api/plans/generate", {
      signal,
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(bodyFor(attempt)),
    });
    const body = await readApiJson(response);
    signal.throwIfAborted();
    last = { response, body, attempt };
    // A refused keeping attempt hands over to the next; the plain ask's own
    // refusal is the answer, and the caller reads its error as it always did.
    // A timeout, rate limit or server fault ends the attempts as that error.
    if (palDraftAttemptsStopAt(response.status)) break;
    if (!response.ok && attempt.keeps !== "none") continue;
    if (palDraftAttemptKept(attempt, draft, response.ok, body as { outcome?: unknown; stops?: unknown } | null)) break;
  }
  if (!last) throw new Error("PUBMAXX could not sort this one.");
  return last;
}

export function composerCreatePayload(input: {
  title: string;
  creatorName: string;
  startTime: string;
  cityId?: CityId | null;
  stops: ReadonlyArray<{ venueId: string; venueName: string; selectedDrinkPriceEvidence?: unknown }>;
  groundingProof?: string | null;
  planAnchor?: GeneratedPlanAnchor | null;
  context?: NightContext | null;
}): Record<string, unknown> {
  return {
    title: input.title,
    creatorName: input.creatorName,
    startTime: input.startTime,
    ...(input.cityId ? { cityId: input.cityId } : {}),
    stops: input.stops.map(({ venueId, venueName, selectedDrinkPriceEvidence }) => {
      const evidence = cleanSelectedDrinkPriceEvidence(selectedDrinkPriceEvidence);
      return {
        venueId,
        venueName,
        ...(evidence && input.context && !input.context.zeroProof
          && evidence.category === input.context.drinkCategory
          ? { selectedDrinkPriceEvidence: evidence } : {}),
      };
    }),
    ...(input.groundingProof ? { groundingProof: input.groundingProof } : {}),
    ...(input.planAnchor ? { anchor: input.planAnchor } : {}),
    ...(input.context ? { context: input.context } : {}),
  };
}

export function planComposerVenueIndexPath(cityId?: CityId | null): string {
  return CITIES[cityId ?? DEFAULT_CITY_ID].slimVenuesPath;
}

export const PLAN_START_TIME_HINT = "Choose a valid future start time.";

/**
 * The line under "Lock it in" while the button cannot be used yet. The button
 * stays tappable (aria-disabled) so the tap itself explains and moves focus;
 * this line says the same thing before the tap. Null once nothing is missing,
 * and while a request is in flight the button's own label carries the state.
 */
export function planLockHint({
  validation,
  busy,
  distinctStops,
  stopCountError,
  routeStale,
  startTimeIsValid,
}: {
  validation: { message: string; focus: "name" | null } | null;
  busy: boolean;
  distinctStops: boolean;
  stopCountError: string | null;
  routeStale: boolean;
  startTimeIsValid: boolean;
}): string | null {
  if (busy) return null;
  if (validation) return validation.message;
  if (!distinctStops) return PLAN_DISTINCT_STOPS_ERROR;
  if (stopCountError) return stopCountError;
  if (routeStale) return "Refresh the route before locking it in.";
  if (!startTimeIsValid) return PLAN_START_TIME_HINT;
  return null;
}

export const PLAN_DISTINCT_STOPS_ERROR = "Choose distinct venues for every stop.";

/** A generated plan locks only with the stop count it was generated for. */
export function planStopCountLockError(
  requiredStopCount: unknown,
  completeStopCount: number,
): string | null {
  if (completeStopCount === normalizePlanStopCount(requiredStopCount)) return null;
  return `A generated ${planOutingNoun(requiredStopCount)} needs exactly ${planStopCountPhrase(requiredStopCount)} we can stand behind before you lock it in.`;
}

export function planLockValidationError({
  title,
  creatorName,
  startTime,
  completeStopCount,
  visibleStopCount,
  groundingProof = null,
  singleStopVenueId = null,
  planAnchor = null,
}: PlanLockValidationInput): { message: string; focus: "name" | null } | null {
  if (!title.trim()) {
    return { message: "Give this plan a title before locking it in.", focus: null };
  }
  if (completeStopCount !== visibleStopCount) {
    return { message: "Choose a venue for every visible stop.", focus: null };
  }
  const missingName = !creatorName.trim();
  const missingTime = !startTime;
  const missingStops = completeStopCount === 0;
  if (!missingName && !missingTime && !missingStops) {
    // The guard is about the ANCHOR-ONLY DRAFT, never about the count. One Stop
    // is an ordinary requested size now (lib/planStopCount.ts), so refusing
    // every proof-carrying one-Stop composer would refuse the meetup the
    // drinker deliberately asked for. What may not be locked is an anchor-only
    // draft standing over some pub other than the one it was minted for.
    const anchorOnlyDraft = Boolean(groundingProof) && planAnchor?.outcome === "anchor-only";
    if (
      anchorOnlyDraft
      && !isMatchingAnchorOnlyPlan({
        groundingProof,
        completeStopCount,
        singleStopVenueId,
        planAnchor,
      })
    ) {
      return {
        message: "Sort this pub again before locking it in.",
        focus: null,
      };
    }
    return null;
  }
  if (missingName && !missingTime && !missingStops) {
    return { message: "Add your name.", focus: "name" };
  }
  return {
    message: "Add your name, a start time, and choose at least one venue from the list.",
    focus: missingName ? "name" : null,
  };
}

type NightAreaCoverageTone = "ready" | "review" | "capture" | "discovery" | "paused";

export type NightAreaCoverageSummary = {
  label: string;
  detail: string;
  tone: NightAreaCoverageTone;
};

const GATE_LABELS: Partial<Record<NightArea["missingEvidence"][number], string>> = {
  venue_density: "venue density",
  identity_conflict: "venue identity checks",
  opening_hours: "opening hours",
  price_coverage: "price coverage",
  amenity_coverage: "amenity coverage",
  transport_anchor: "a transport anchor",
  route_feasibility: "route feasibility",
  terminal_get_home: "the route home",
  terminal_food: "a food ending",
  stale_review: "a fresh review",
  unreviewed_source: "reviewed sources",
};

function formatGateCode(code: NightArea["missingEvidence"][number]): string {
  return GATE_LABELS[code] ?? code.replaceAll("_", " ");
}

export function nightAreaCoverageSummary(
  area: NightArea,
  now = new Date(),
): NightAreaCoverageSummary {
  if (isNightAreaRouteReady(area, now)) {
    return {
      label: "Route-ready",
      detail: "You can plan a crawl here now.",
      tone: "ready",
    };
  }

  const missing = area.missingEvidence.slice(0, 2).map(formatGateCode);
  const remaining = area.missingEvidence.length - missing.length;
  const missingEvidenceDetail = missing.length > 0
    ? `missing ${missing.join(" and ")}${remaining > 0 ? ` + ${remaining} more` : ""}.`
    : "Area review is unavailable. Check each stop before you go.";

  switch (area.coverageStatus) {
    case "captured":
      return { label: "Not all checked", detail: `Some checks complete. ${missingEvidenceDetail[0]?.toUpperCase()}${missingEvidenceDetail.slice(1)}`, tone: "capture" };
    case "discovered":
      return { label: "Rough guess", detail: "We haven't checked this area yet. The route stays yours to change.", tone: "discovery" };
    case "reviewed":
      return { label: "Not all checked", detail: `Checked with gaps. ${missingEvidenceDetail[0]?.toUpperCase()}${missingEvidenceDetail.slice(1)}`, tone: "review" };
    case "paused":
      return { label: "Gone stale", detail: "Prices here have gone stale. You can still plan, but check each stop.", tone: "paused" };
    default:
      return { label: "Not all checked", detail: `Checks in progress. ${missingEvidenceDetail[0]?.toUpperCase()}${missingEvidenceDetail.slice(1)}`, tone: "review" };
  }
}


function nextEvening(): string {
  return defaultLondonStartInput();
}

/**
 * A start at or before now belongs to a night that began without this plan.
 * The lock refuses it, so a request never carries it: a recovered draft keeps
 * showing what was saved, and the next request takes the current default.
 */
function startHasPassed(input: string, now = Date.now()): boolean {
  const iso = londonDateTimeInputToIso(input);
  return iso !== null && Date.parse(iso) <= now;
}

/**
 * The name of the night the late default stepped over, for the one-tap choice
 * beside the field: null whenever `tonightLondonStartInput` has no slot left
 * to offer. Read on every render, and the slot itself read again on the tap,
 * never latched - a quarter-hour held from mount is a moment that has passed
 * by the time a reader has described a night and sorted it, and the lock
 * refuses a start in the past. The tap writes that fresh slot or nothing: a
 * control may not write a night its own label does not name.
 */
function tonightChoiceLabel(): string | null {
  const value = tonightLondonStartInput();
  return value === null ? null : routeStartLabel(value);
}

function unsupportedPatchForCurrentGenerator(
  draft: PlanIntakeDraft,
  contextPatch: Partial<NightContext>,
): NightPatch | null {
  if (!draft.answers.area || contextPatch.nightArea) return null;
  return resolveNightPatch(draft.answers.area);
}

function canSortPlan(
  query: string,
  contextPatch: Partial<NightContext>,
  currentContext: NightContext | null,
  unsupportedPatch: NightPatch | null,
): boolean {
  if (unsupportedPatch) return false;
  return [query.trim(), contextPatch.nightArea, currentContext].some(Boolean);
}

function conciergeStatusText(
  sorting: boolean,
  unsupportedPatch: NightPatch | null,
  note: string,
): string {
  if (sorting) return "Planning your outing and picking stops we can back up.";
  if (unsupportedPatch) {
    return `${unsupportedPatch.label} is saved. We can't build an exact route for this patch yet. Pick another area to build the route now.`;
  }
  return note;
}

/**
 * L11 accepted-context panel: a summary of the Venue, area, and date the person
 * already accepted, plus any arbitration conflicts we resolved in their favour.
 * Rendered only when the handoff is active.
 *
 * The area and the date stay editable below, and the accepted pub does not:
 * while the acceptance is held, Stop 1 IS that pub, because the grounding proof
 * is about it. So the panel says exactly that, and carries the one way out.
 * Without the release control the acceptance could not be put down for the
 * whole PlanningIntent TTL, and the panel's own sentence said otherwise.
 */
export function AcceptedContextPanel({
  handoff,
  acceptedVenueName = null,
  onRelease,
  releaseDisabled = false,
}: {
  handoff: ComposerHydration;
  acceptedVenueName?: string | null;
  onRelease?: () => void;
  releaseDisabled?: boolean;
}) {
  // Never the raw id: it is our name for a row, and a pin promoted out of the
  // UK base layer never reaches the slim index, so the id would have stood here
  // for good. A neutral label says the same true thing and reads as English.
  const venueName = acceptedVenueName ?? handoff.routePreview?.value.stops
    .find((stop) => stop.venueId === handoff.heldVenueId)?.venueName
    ?? UNRESOLVED_ACCEPTED_VENUE_LABEL;
  const whenLabel = londonServiceDateLabel(handoff.startsAt);
  return (
    <>
      {handoff.showAcceptedSummary && (
        <section className="planComposer__accepted" aria-label="Accepted plan context">
          <span className="planPage__eyebrow">Carried over from what you accepted</span>
          <dl className="planComposer__acceptedList">
            {handoff.heldVenueId && (
              <div><dt>Venue</dt><dd>{venueName}</dd></div>
            )}
            {handoff.area && (
              <div><dt>Area</dt><dd>{acceptedPlanAreaLabel(handoff.area)}</dd></div>
            )}
            {whenLabel && (
              <div><dt>When</dt><dd>{whenLabel}</dd></div>
            )}
          </dl>
          <p className="planComposer__acceptedNote">
            You can change the area and the date below. Stop 1 stays this pub until you release it. Releasing keeps every stop.
          </p>
          {onRelease && handoff.heldVenueId ? (
            <button
              className="planComposer__acceptedRelease"
              type="button"
              onClick={onRelease}
              disabled={releaseDisabled}
            >Release this pub</button>
          ) : null}
        </section>
      )}
      {handoff.conflicts.length > 0 && (
        <ul className="planComposer__conflicts" aria-label="Plan changes we kept safe">
          {handoff.conflicts.map((conflict, index) => (
            <li key={`${conflict.code}-${index}`}>{conflict.message}</li>
          ))}
        </ul>
      )}
    </>
  );
}

/**
 * The lock-failure banner. Copy for anchored 422 (proof invalid/expired) and 409
 * (replay-conflict) is mapped by composerLockErrorFromResponse before it reaches
 * `message`; this is the exact element the form renders it in.
 */
export function PlanComposerErrorNotice({ message }: { message: string }) {
  return <p id="plan-composer-error" className="planComposer__error" role="alert" tabIndex={-1}>{message}</p>;
}

type ComposerDraftFields = {
  title: string;
  creatorName: string;
  startTime: string | (() => string);
};

/**
 * Prefer arbitrated accepted context when the handoff is present. The ?? chain
 * keeps generic Plan values when no accepted context exists.
 * `startTime` keeps the bare `nextEvening` function reference (not a call) so
 * `useState` still lazily initialises it when neither source has a value.
 */
function initialComposerDraftFields(
  handoff: ComposerHydration | null,
  recoveredDraft: ReturnType<typeof parsePlanDraft>,
): ComposerDraftFields {
  const startTime = handoff?.startsAt ?? recoveredDraft?.startTime;
  return {
    title: handoff?.title ?? recoveredDraft?.title ?? "Tonight, sorted",
    creatorName: handoff?.creatorName ?? recoveredDraft?.creatorName ?? "",
    startTime: startTime?.endsWith("Z")
      ? londonDateTimeInputFromIso(startTime) ?? startTime : startTime ?? nextEvening,
  };
}

function initialComposerStops(
  recoveredRouteDraft: StoredRouteDraft | null,
  recoveredDraft: ReturnType<typeof parsePlanDraft>,
  handoff: ComposerHydration | null,
): DraftStop[] {
  const recoveredPlanStops = recoveredDraft?.stops.map((stop) => ({
      ...stop,
      alternatives: [],
    })) ?? [];
  if (recoveredRouteDraft?.stops.length) return recoveredRouteDraft.stops;
  if (recoveredPlanStops.length) return recoveredPlanStops;
  const provisional = seedProvisionalStop1({
    acceptedVenueId: handoff?.heldVenueId,
    recoveredRouteStops: recoveredRouteDraft?.stops,
    recoveredPlanStops,
  });
  return provisional ? [provisional] : [];
}

type ComposerRouteDraftFields = {
  nightContext: NightContext | null;
  routeNight: RouteNight | null;
  routeRevision: RouteRevision | null;
  routeStale: boolean;
  groundingProof: string | null;
  createOperationKey: string | null;
  planAnchor: GeneratedPlanAnchor | null;
  routeStatus: string;
};

function initialComposerRouteDraft(
  recoveredRouteDraft: StoredRouteDraft | null,
): ComposerRouteDraftFields {
  return {
    nightContext: recoveredRouteDraft?.nightContext ?? null,
    routeNight: recoveredRouteDraft?.routeNight ?? null,
    routeRevision: recoveredRouteDraft?.routeRevision ?? null,
    routeStale: recoveredRouteDraft?.routeStale ?? false,
    groundingProof: recoveredRouteDraft?.groundingProof ?? null,
    createOperationKey: recoveredRouteDraft?.createOperationKey ?? null,
    planAnchor: recoveredRouteDraft?.planAnchor ?? null,
    routeStatus: recoveredRouteDraft
      ? recoveredRouteDraft.routeStale
        ? "Recovered a route that needs refreshing before it can be locked."
        : "Recovered your route preview. Nothing is published until you lock it in."
      : "",
  };
}

type UrlPrefill = {
  /** Any prefill the address carries: `occasion`, `describe` or `query`. */
  ask: string | null;
  /** The Pub Pal handoff `query` alone, which is the narrower question. */
  handoffAsk: string | null;
};

const NO_URL_PREFILL: UrlPrefill = { ask: null, handoffAsk: null };

function planWindowContainsStart(option: (typeof PLAN_TIME_WINDOWS)[number], exactStartIso: string): boolean {
  const clock = londonDateTimeInputFromIso(exactStartIso)?.slice(11);
  if (!clock) return false;
  return option.end === null
    ? clock >= option.start || clock < "04:00"
    : clock >= option.start && clock < option.end;
}

function reconcilePlanStart(draft: PlanIntakeDraft, value: string): PlanIntakeDraft {
  if (!draft.answers.timeWindow) return draft;
  const exactStartIso = londonDateTimeInputToIso(value, new Date());
  if (!exactStartIso) return reopenPlanIntakeStep({ ...draft, answers: { ...draft.answers, exactStartIso: null } }, "time-window");
  const current = PLAN_TIME_WINDOWS.find((option) => option.id === draft.answers.timeWindow);
  const option = current && planWindowContainsStart(current, exactStartIso) ? current
    : PLAN_TIME_WINDOWS.find((candidate) => planWindowContainsStart(candidate, exactStartIso));
  if (option?.id === draft.answers.timeWindow && exactStartIso === draft.answers.exactStartIso) return draft;
  const next = { ...draft, answers: { ...draft.answers, timeWindow: option?.id ?? null, exactStartIso: option ? exactStartIso : null } };
  return settlePlanIntakeStep({ ...next, currentStep: "time-window" }, { skip: !option });
}

function initialComposerIntake(
  intake: PlanIntakeDraft,
  count: PlanStopCount | undefined,
  source: PlanStopCountSource | undefined,
  startTime: string,
): PlanIntakeDraft {
  return reconcilePlanStart(applyPlanStopCount(intake, null, count, source).draft, startTime);
}

function tuneTimeAnswers(daypart: NightContext["daypart"], displayedStart: string, savedExactStartIso: string | null): Pick<PlanIntakeDraft["answers"], "timeWindow" | "exactStartIso"> {
  const option = PLAN_TIME_WINDOWS.find((window) => window.daypart === daypart);
  if (!option) return { timeWindow: null, exactStartIso: null };
  const now = new Date();
  const exactStartIso = resolveFutureLondonStartIso(displayedStart, savedExactStartIso, now)
    ?? londonDateTimeInputToIso(displayedStart, now) ?? savedExactStartIso;
  if (exactStartIso && Date.parse(exactStartIso) > now.getTime() && planWindowContainsStart(option, exactStartIso)) {
    return { timeWindow: option.id, exactStartIso };
  }
  const input = exactStartIso && londonDateTimeInputFromIso(exactStartIso);
  const nextStart = input && londonDateTimeInputToIso(`${input.slice(0, 10)}T${option.start}`, now);
  return { timeWindow: option.id, exactStartIso: nextStart || nextLondonOccurrenceIso(option.id, now) };
}

/**
 * The ask a `/plan` URL carries, both the wide answer and the narrow one.
 *
 * Only read once the page can persist: the server knows no address, so a read
 * during the hydration render would paint a field the server left empty and
 * mismatch it. `PlanComposerForm` is remounted under a fresh key the moment
 * hydration lands. On a client-side navigation the render-phase read can still
 * see the previous route, so `PlanComposerForm` re-reads in `useLayoutEffect`
 * after the router commits the new address. Nothing but `window.location` is
 * touched.
 */
function describeAskFromLocation(): UrlPrefill {
  if (typeof window === "undefined") return NO_URL_PREFILL;
  try {
    const { search } = window.location;
    return {
      ask: parsePlanDescribeFromSearch(search),
      handoffAsk: parsePlanHandoffQueryFromSearch(search),
    };
  } catch {
    return NO_URL_PREFILL;
  }
}

// The form owns several independent draft and route transitions; keep this
// warning visible in reviews without turning its state machine into wrappers.
// eslint-disable-next-line complexity
function PlanComposerForm({
  recoveredDraft,
  recoveredRouteDraft,
  recoveredIntake,
  recoveredPreviewToCopy,
  recoveredPreviewReference,
  recoveredIntent,
  hasDurableIntakeDraft,
  requestAmbiguous,
  preserveStoredDrafts,
  provisionalRequest,
  acceptedOwner,
  handoff: hydratedHandoff,
  canPersist,
  allowUrlPrefill,
}: {
  recoveredDraft: ReturnType<typeof parsePlanDraft>;
  recoveredRouteDraft: StoredRouteDraft | null;
  recoveredIntake: PlanIntakeDraft;
  recoveredPreviewToCopy: ComposerPreviewCopy | null;
  recoveredPreviewReference: NonNullable<StoredPlanDraft["routeReference"]> | null;
  recoveredIntent: ReturnType<typeof resolveRequestedPlanIntent>;
  hasDurableIntakeDraft: boolean;
  requestAmbiguous: boolean;
  preserveStoredDrafts: boolean;
  provisionalRequest: boolean;
  acceptedOwner: ComposerRequestOwner | null;
  handoff: ComposerHydration | null;
  canPersist: boolean;
  allowUrlPrefill: boolean;
}) {
  const router = useRouter();
  const formLifetime = useRef<AbortController | null>(null);
  useLayoutEffect(() => {
    const lifetime = new AbortController();
    formLifetime.current = lifetime;
    return () => lifetime.abort();
  }, []);
  const { user, identityResolved } = useAuth();
  const viewerHandle = useViewerHandle();
  const areaGroups = nightAreaSelectorGroups();
  const readyAreas = areaGroups[0]?.areas ?? [];
  const areasInProgress = areaGroups[1]?.areas ?? [];
  // Releasing the accepted pub retires the whole handoff for this composer, so
  // every reader of it below - the panel, the seeded Stop 1's protection, the
  // anchored generation body and the draft the effects persist - stops holding
  // an acceptance in the same beat.
  const [acceptanceReleased, setAcceptanceReleased] = useState(false);
  const handoff = acceptanceReleased ? null : hydratedHandoff;
  const heldVenueId = handoff?.heldVenueId ?? null;
  const liveHeldVenueId = useRef(heldVenueId);
  useEffect(() => {
    liveHeldVenueId.current = heldVenueId;
  }, [heldVenueId]);
  const draftFields = initialComposerDraftFields(handoff, recoveredDraft);
  const [title, setTitle] = useState(draftFields.title);
  const [creatorName, setCreatorName] = useState(draftFields.creatorName);
  const automaticCreatorName = useRef<string | null>(null);
  const pendingDraftSave = useRef(false);
  const requestOwner = useRef(acceptedOwner);
  if (canPersist && requestOwner.current === null) requestOwner.current = acceptedOwner;
  const ownerAccountId = useRef(user?.id);
  if (canPersist && ownerAccountId.current !== user?.id) {
    // Sign-in keeps anonymous inputs but clears their stored copies.
    const current = readComposerAcceptanceRecords();
    for (const scope of ["session", "local"] as const) {
      const expected = requestOwner.current?.[scope];
      if (!expected) continue;
      for (const key of Object.keys(expected)) {
        if (key !== PLANNING_INTENT_STORAGE_KEY && current[scope]?.[key] === null) expected[key] = null;
      }
    }
    ownerAccountId.current = user?.id;
  }
  const generatedRelease = useRef<ComposerGeneratedRelease | null>(null);
  const requestEditTime = useRef<number | null>(null);
  const [initialStartTime] = useState(draftFields.startTime);
  const [startTime, setStartTime] = useState(initialStartTime);
  const recoveredRequestTitle = recoveredDraft?.title ?? draftFields.title;
  const recoveredRequestCreator = recoveredDraft?.creatorName ?? draftFields.creatorName;
  const recoveredRequestStart = recoveredDraft?.startTime ?? initialStartTime;
  const [stops, setStops] = useState<DraftStop[]>(
    initialComposerStops(recoveredRouteDraft, recoveredDraft, handoff),
  );
  const [venues, setVenues] = useState<PlanVenueOption[]>([]);
  const [venueIndexRead, setVenueIndexRead] = useState(0);
  const [venueIndexStatus, setVenueIndexStatus] = useState<"reading" | "read" | "failed">("reading");
  const pathname = usePathname();
  const [urlPrefill] = useState(() =>
    canPersist && allowUrlPrefill ? describeAskFromLocation() : NO_URL_PREFILL,
  );
  const urlAsk = urlPrefill.ask;
  const recoveredStopCount = urlAsk
    ? matchPlanStopCount(urlAsk)
    : recoveredIntent.stopCount;
  // Describe-first is the default open. A returning visitor with real,
  // unfinished wizard progress lands back on the wizard instead, so their
  // answers so far are not hidden behind the question they already passed.
  // ONLY the Pub Pal handoff overrides that: it is a fresh ask the drinker
  // just chose, and describe-first is the only surface that can show it. A
  // chip link (`occasion`, `describe`) does not, so those keep the rule.
  // A sole area may come from the remembered-area seed. Only a recorded
  // choice or legacy progress beyond that seed can reopen the wizard.
  const wizardProgress = recoveredIntake.skippedSteps.includes("area")
    || recoveredIntake.settledSteps.some((step) => step !== "area");
  const initialEntryMode: "describe" | "wizard" =
    (recoveredDraft?.entryMode === "wizard" || (hasDurableIntakeDraft && wizardProgress))
      && !recoveredIntake.completed && !urlPrefill.handoffAsk
      ? "wizard"
      : "describe";
  // A URL ask is never dropped in silence. Where describe-first cannot render
  // it - a held acceptance opens the full composer instead - it lands in that
  // surface's own field, and it WINS there: the drinker chose this ask just
  // now, where a recovered concierge line is whatever they left behind.
  const askNeedsConciergeField =
    Boolean(urlAsk)
    && !planComposerShowsDescribeFirst({
      heldVenueId,
      completed: recoveredIntake.completed,
      entryMode: initialEntryMode,
    });
  const [conciergeQuery, setConciergeQuery] = useState(
    (askNeedsConciergeField ? urlAsk ?? "" : "") || recoveredIntent.conciergeQuery,
  );
  const [planIntake, setPlanIntake] = useState(() =>
    initialComposerIntake(recoveredIntake, recoveredStopCount, urlAsk ? "text" : recoveredIntent.stopCountSource, startTime));
  const requestedStopCount = planIntake.answers.stopCount;
  const [draftSaveFailure, setDraftSaveFailure] = useState<ComposerDraftSaveFailure>(null);
  const [wizardChosen, setWizardChosen] = useState(recoveredDraft?.entryMode === "wizard");
  const [entryMode, setEntryMode] = useState<"describe" | "wizard">(initialEntryMode);
  const [askDraftQuery, setAskDraftQuery] = useState(urlAsk ?? "");
  const askDraftConsumedRef = useRef(false);
  // The crawl an ask drafted, read from the same one-shot session draft, kept
  // until the generation that answers that same ask spends it
  // (lib/palPlanHandoff.ts): Plan keeps those pubs instead of choosing its own.
  const palDraftRef = useRef<PalPlanDraft | null>(null);
  // An ask the address carries is applied ONCE. This effect re-runs whenever
  // the surface it has to write into can change - releasing a held acceptance
  // flips `heldVenueId` - and a second application would overwrite whatever
  // the drinker has typed since with the line the URL opened on.
  const appliedUrlAskRef = useRef<string | null>(null);
  // The planner's report line for the route it last built, with the stops it
  // was about, so the lock hands the plan card a line only for that route.
  const generatedReportRef = useRef<{ line: string; venueIds: string } | null>(null);
  // WHETHER THE GENERATOR HAS ANSWERED, which is the moment the page's one
  // painted primary becomes `Lock it in` and the concierge control above steps
  // back. It is NOT "a Stop names a pub": a held acceptance seeds Stop 1 and
  // has no route at all, and asking the stops made `Make a plan` disappear on
  // exactly the surface that still needs it (e2e/plan-held-acceptance.spec.ts).
  // A recovered route draft IS a route, so it seeds this true.
  const [routeSorted, setRouteSorted] = useState(Boolean(recoveredRouteDraft));
  const routeSaveRevoked = useRef(Boolean(urlAsk));
  const adoptFreshAsk = useCallback((query: string) => {
    pendingDraftSave.current = true;
    routeSaveRevoked.current = true;
    setRouteStale(routeSorted);
    setGroundingProof(null);
    setCreateOperationKey(null);
    setRouteStatus("Your new description needs a fresh route before you lock it in.");
    setAskDraftQuery(query);
    setConciergeQuery(query);
    setExplicitNightContext({});
    setPlanIntake((current) => {
      const draft = createPlanIntakeDraft();
      return applyPlanStopCount(
        current.completed ? skipRemainingPlanIntake(draft) : draft,
        null,
        matchPlanStopCount(query),
        matchPlanStopCount(query) === undefined ? undefined : "text",
      ).draft;
    });
  }, [routeSorted]);
  useLayoutEffect(() => {
    if (!canPersist || !allowUrlPrefill) return;
    const fresh = describeAskFromLocation();
    if (!fresh.ask) return;
    if (appliedUrlAskRef.current === fresh.ask) return;
    const ask = fresh.ask;
    appliedUrlAskRef.current = ask;
    routeSaveRevoked.current = true;
    const opensDescribeFirstForHandoff =
      Boolean(fresh.handoffAsk) && hasDurableIntakeDraft && !recoveredIntake.completed;
    // Deferred out of the effect body (react-hooks/set-state-in-effect). The
    // draft restore below is scheduled from a PASSIVE effect, so its microtask
    // is queued after this one and the URL ask still lands first.
    void Promise.resolve().then(() => {
      adoptFreshAsk(ask);
      if (opensDescribeFirstForHandoff) {
        setWizardChosen(false);
        setEntryMode("describe");
      }
    });
  }, [canPersist, allowUrlPrefill, pathname, heldVenueId, recoveredIntake.completed, hasDurableIntakeDraft, adoptFreshAsk]);
  useEffect(() => {
    // The URL ask is already in state; this effect exists to SPEND the draft,
    // which is a storage write and so waits for a browser that can persist.
    if (!canPersist) return;
    if (askDraftConsumedRef.current) return;
    askDraftConsumedRef.current = true;
    try {
      // The ask draft is one-shot, so it is SPENT whichever prefill wins: a
      // URL that carries its own describe used to leave the draft behind for
      // the next /plan visit to open on somebody's earlier ask.
      let raw: string | null = null;
      try {
        const askDraftStore = safeSessionStorage();
        raw = askDraftStore?.getItem(ASK_PLAN_DRAFT_STORAGE_KEY) ?? null;
        if (raw) askDraftStore?.removeItem(ASK_PLAN_DRAFT_STORAGE_KEY);
      } catch {
        raw = null;
      }
      // The address is re-read HERE rather than closed over: this effect is
      // scheduled by the mount render, which on a client-side navigation
      // still saw the previous route, so a captured ask would read as none
      // and hand the field back to the draft the URL just beat.
      const askOnScreen = (allowUrlPrefill ? describeAskFromLocation().ask : null) ?? appliedUrlAskRef.current;
      // The Pal's "Open in Plan" puts its ask in the address; Ask the map
      // leaves it to prefill the field. Either way the drafted pubs ride
      // with that ask, and only with it.
      if (askOnScreen) {
        palDraftRef.current = palPlanDraftFor(raw, askOnScreen);
        return;
      }
      if (!raw) return;
      const parsed = JSON.parse(raw) as AskPlanDraft;
      const query = typeof parsed?.query === "string" ? parsed.query.trim().slice(0, 500) : "";
      if (!query) return;
      palDraftRef.current = palPlanDraftFor(raw, query);
      routeSaveRevoked.current = true;
      void Promise.resolve().then(() => {
        adoptFreshAsk(query);
        if (hasDurableIntakeDraft && !recoveredIntake.completed) {
          setWizardChosen(false);
          setEntryMode("describe");
        }
      });
    } catch {
      /* private mode or bad JSON */
    }
  }, [canPersist, allowUrlPrefill, hasDurableIntakeDraft, recoveredIntake.completed, adoptFreshAsk]);
  const palHandoffAutoGenerateStartedRef = useRef(false);
  // D3: a generated route must be SEEN. The reveal is requested by the
  // generation success path and runs in an effect, because on a describe-first
  // chip tap the route status element only mounts with the same commit that
  // carries the new stops.
  const [routeRevealTick, setRouteRevealTick] = useState(0);
  // The route as it arrived, by its pubs in order: the strip draws it once.
  const [routeDrawKey, setRouteDrawKey] = useState<string | null>(null);
  const [tuneOpen, setTuneOpen] = useState(false);
  const revealedTick = useRef(0);
  useEffect(() => {
    if (routeRevealTick === revealedTick.current) return;
    // The sheet was how this route was asked for; the route is the answer.
    if (tuneOpen) {
      void Promise.resolve().then(() => setTuneOpen(false));
      return;
    }
    revealedTick.current = routeRevealTick;
    // The closing sheet's focus trap lifts inert and hands focus back to Tune
    // details in a microtask queued by its cleanup, which ran before this
    // effect. Queued after it, the reveal is the focus that stays.
    queueMicrotask(() => revealPlanRouteStatus());
  }, [routeRevealTick, tuneOpen]);

  // The host name is public (the plan, the share card, the unfurler), so it
  // waits for the live session rather than taking whatever is to hand: until
  // identity has answered, the handle in front of us may be the previous
  // account's. See creatorNameFromAccount for what may fill it, and what may not.
  const signedInCreatorNameSeededRef = useRef(false);
  useEffect(() => {
    if (!user || !identityResolved || signedInCreatorNameSeededRef.current) return;
    signedInCreatorNameSeededRef.current = true;
    setCreatorName((current) => {
      if (current.trim()) return current;
      const seeded = creatorNameFromAccount({ handle: viewerHandle, user });
      if (seeded) automaticCreatorName.current = seeded;
      return seeded || current;
    });
  }, [identityResolved, user, viewerHandle]);
  // The name typed for an earlier plan on this device, so it is asked for once.
  // It waits for identity too: an account change clears it
  // (DEVICE_IDENTITY_LOCAL_KEYS), and reading before that would offer the
  // previous person's name. Declared after the account seed, so an account
  // name wins and this fills only what that left empty.
  const deviceCreatorNameSeededRef = useRef(false);
  useEffect(() => {
    if (!identityResolved || deviceCreatorNameSeededRef.current) return;
    deviceCreatorNameSeededRef.current = true;
    setCreatorName((current) => {
      if (current.trim()) return current;
      const seeded = readRememberedPlanHostName(safeLocalStorage());
      if (seeded) automaticCreatorName.current = seeded;
      return seeded || current;
    });
  }, [identityResolved]);
  useEffect(() => {
    if (!canPersist || !allowUrlPrefill) return;
    if (palHandoffAutoGenerateStartedRef.current) return;
    // A client-side Pal Open in Plan still sees the previous route during the
    // mount render, so urlPrefill.handoffAsk can be empty. Re-read the live
    // address the same way the prefill layout effect does after the router
    // commits it; gating on the stale read skipped the deferred generate.
    const liveHandoff = describeAskFromLocation().handoffAsk ?? urlPrefill.handoffAsk;
    if (!shouldAutoGeneratePalHandoffPlan(liveHandoff)) return;
    palHandoffAutoGenerateStartedRef.current = true;
    // Defer until the URL ask prefill lands in describe-first or the concierge field.
    void Promise.resolve().then(() => {
      const handoffAsk = describeAskFromLocation().handoffAsk ?? liveHandoff;
      if (!handoffAsk?.trim()) return;
      submitFromEntry(
        handoffAsk.trim(),
        undefined,
        skipRemainingPlanIntake(createPlanIntakeDraft()),
        {},
      );
    });
    // submitFromEntry is intentionally excluded: it is recreated on render,
    // while this effect must run only when the URL handoff changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canPersist, allowUrlPrefill, urlPrefill.handoffAsk]);
  const [conciergeNote, setConciergeNote] = useState("");
  const routeDraftFields = initialComposerRouteDraft(recoveredRouteDraft);
  const [nightContext, setNightContext] = useState<NightContext | null>(routeDraftFields.nightContext);
  const recoveredExplicitNightContext = recoveredIntent.explicitNightContext;
  const [explicitNightContext, setExplicitNightContext] = useState<Partial<NightContext> | undefined>(urlAsk ? {} : recoveredExplicitNightContext);
  const intakeContext = planIntakeNightContextPatch(planIntake);
  const editableBase = nightContext ?? ((hasDurableIntakeDraft && Object.keys(intakeContext).some((key) => key !== "stopCount")) || explicitNightContext !== undefined ? {
    ...inferNightContext(conciergeQuery).context,
    ...intakeContext,
    stopCount: normalizePlanStopCount(requestedStopCount),
  } : null);
  const editableContext = editableBase ? { ...editableBase, ...explicitNightContext } : null;
  const requestContext = { nightArea: askDraftQuery ? undefined : nightContext?.nightArea, ...explicitNightContext };
  const [routeRevision, setRouteRevision] = useState<RouteRevision | null>(routeDraftFields.routeRevision);
  const [routeNight, setRouteNight] = useState<RouteNight | null>(routeDraftFields.routeNight);
  const recoveredStopsNeedRefresh = !recoveredRouteDraft && Boolean(recoveredDraft?.stops.length)
    && (!provisionalRequest || !heldVenueId || recoveredDraft?.routeReference === null);
  const [routeStale, setRouteStale] = useState(routeDraftFields.routeStale || recoveredStopsNeedRefresh);

  const [groundingProof, setGroundingProof] = useState(routeDraftFields.groundingProof);
  const [createOperationKey, setCreateOperationKey] = useState(routeDraftFields.createOperationKey);
  const sentCreateOperation = useRef<StoredMutationKey | null>(null);
  const [planAnchor, setPlanAnchor] = useState(routeDraftFields.planAnchor);
  const [successfulGeneration, setSuccessfulGeneration] = useState(0);
  useLayoutEffect(() => {
    if (successfulGeneration > 0) routeSaveRevoked.current = false;
  }, [successfulGeneration]);
  const routeCopy = useRef({
    identity: JSON.stringify({ stops: recoveredRouteDraft?.stops, planAnchor: recoveredRouteDraft?.planAnchor, nightContext: recoveredRouteDraft?.nightContext }),
    content: composerRouteContent(recoveredRouteDraft),
    savedAt: recoveredRouteDraft?.savedAt,
    generation: 0,
    pending: true,
  });
  // One action owns the composer at a time: a route being made, or a Lock.
  // The ref answers synchronously, so a second tap in the same frame is
  // refused before it can start anything.
  const [activity, setActivity] = useState<"idle" | "generating" | "locking">("idle");
  const activityRef = useRef(activity);
  const sorting = activity === "generating";
  const submitting = activity === "locking";
  const beginActivity = (next: "generating" | "locking"): boolean => {
    if (activityRef.current !== "idle") return false;
    activityRef.current = next;
    setActivity(next);
    return true;
  };
  const endActivity = () => {
    activityRef.current = "idle";
    setActivity("idle");
  };
  // Walk minutes the browser measured between stops, merged over the route's
  // life so a reorder re-times a leg the generator never walked.
  const [measured, setMeasured] = useState<MeasuredLegMinutes>(() => new Map());
  const onMeasuredLegs = useCallback((venueIds: readonly string[], legs: readonly WalkLegDistance[]) => {
    setMeasured((current) => new Map([...current, ...measuredLegMinutes(venueIds, legs)]));
  }, []);
  const [error, setError] = useState("");
  const [routeStatus, setRouteStatus] = useState(routeDraftFields.routeStatus);
  const [routeCheckNoticeText, setRouteCheckNoticeText] = useState(
    recoveredRouteDraft?.stops.length || recoveredDraft?.stops.length
      ? "Opening and travel checks are unavailable for this restored draft." : "",
  );
  // Culture Crawl opener for the CURRENT generated route only. It is never
  // saved with the plan: it is a thing to see beside the route, not a Stop.
  const [cultureOpener, setCultureOpener] = useState<CultureOpenerDTO | null>(null);
  // A dry round's listed alcohol-free price and pint, by pub (lib/dryRound.ts).
  // Null when the last route was not a dry round.
  const [dryRoundPrices, setDryRoundPrices] = useState<ReadonlyMap<string, DryRoundStopPrices> | null>(null);
  const usualLot = useSyncExternalStore(subscribeLastCrew, readLastCrew, () => null);
  const nameInputRef = useRef<HTMLInputElement | null>(null);

  const completeStops = useMemo(
    () => stops.filter((stop) => stop.venueName.trim() && stop.venueId.trim()),
    [stops],
  );
  const conciergeIntake = useMemo(
    () => syncPlanIntakeAreaFromQuery(planIntake, conciergeQuery),
    [conciergeQuery, planIntake],
  );
  const intakeContextPatch = useMemo(
    () => planIntakeNightContextPatch(conciergeIntake),
    [conciergeIntake],
  );
  const unsupportedIntakePatch = unsupportedPatchForCurrentGenerator(conciergeIntake, intakeContextPatch);
  const queryUnsupportedPatch = useMemo(() => {
    const queryArea = nightAreaFromPlanQuery(conciergeQuery);
    return queryArea.kind === "unsupported-patch"
      ? resolveNightPatch(queryArea.patchId)
      : null;
  }, [conciergeQuery]);
  const activeUnsupportedPatch = unsupportedIntakePatch ?? queryUnsupportedPatch;
  const canSortWithCurrentGenerator = canSortPlan(
    conciergeQuery,
    intakeContextPatch,
    nightContext,
    activeUnsupportedPatch,
  );
  const conciergeStatus = conciergeStatusText(sorting, activeUnsupportedPatch, conciergeNote);
  const composerVisible =
    planIntake.completed
    || stops.length > 0
    || Boolean(heldVenueId);
  // The route comes before the request controls in result mode. "Tune details"
  // holds the description, context and templates. Name and start-time fields
  // stay below the cards for locking the plan.
  const resultMode = composerVisible && routeSorted && stops.length > 0;
  // A result with no host name seats "Your name" in the pinned Lock bar, so the
  // one thing Lock still needs sits beside it rather than screens below. The
  // seat is chosen when the result appears and kept, so the field never jumps
  // away from a caret mid-word.
  const [nameInLockBar, setNameInLockBar] = useState(() => resultMode && !creatorName.trim());
  const [nameSeatResultMode, setNameSeatResultMode] = useState(resultMode);
  if (resultMode !== nameSeatResultMode) {
    setNameSeatResultMode(resultMode);
    setNameInLockBar(resultMode && !creatorName.trim());
  }
  const nameField = (
    <div className="planComposer__field">
      <label htmlFor="plan-name">Your name</label>
      <input id="plan-name" type="text" ref={nameInputRef} autoComplete="name" maxLength={CREW_NAME_MAX} required disabled={submitting} value={creatorName} onChange={(event) => { pendingDraftSave.current = true; automaticCreatorName.current = null; setCreatorName(event.target.value); }} placeholder="Shown on the invite" />
    </div>
  );
  // An unresolved Stop 1 carries an empty name on purpose, and an empty string
  // is not nullish, so it must be dropped here or the summary prints a blank
  // row instead of falling through to the neutral label.
  const acceptedVenueName = heldVenueId
    ? venues.find((venue) => venue.id === heldVenueId)?.name.trim()
      || stops.find((stop) => stop.venueId === heldVenueId)?.venueName.trim()
      || null
    : null;
  // The Venue index this composer reads, and the area seed below, are both
  // arrival-time reads of what was hydrated. They stay on the hydrated handoff
  // rather than the live one, so releasing the pub neither refetches an index
  // nor re-asks the browser for a location.
  const acceptedCityId = hydratedHandoff?.acceptedAnchor?.cityId ?? DEFAULT_CITY_ID;
  const completeStopIds = completeStops.map((stop) => stop.venueId);
  const matchingAnchorOnlyPlan = isMatchingAnchorOnlyPlan({
    groundingProof,
    completeStopCount: completeStops.length,
    singleStopVenueId: completeStops[0]?.venueId,
    planAnchor,
  });
  const startTimeIsValid = Boolean(
    resolveFutureLondonStartIso(
      startTime,
      planIntake.answers.exactStartIso,
      new Date(),
    ),
  );
  const lockValidation = planLockValidationError({
    title,
    creatorName,
    startTime,
    completeStopCount: completeStops.length,
    visibleStopCount: stops.length,
    groundingProof,
    singleStopVenueId: completeStops.length === 1 ? completeStops[0]?.venueId : null,
    planAnchor,
  });
  const distinctStops = new Set(completeStopIds).size === completeStopIds.length;
  const stopCountError = nightContext && !matchingAnchorOnlyPlan
    ? planStopCountLockError(nightContext.stopCount, completeStops.length)
    : null;
  const canLockPlan =
    composerVisible &&
    !submitting &&
    !sorting &&
    !routeStale &&
    lockValidation === null &&
    startTimeIsValid &&
    distinctStops &&
    stopCountError === null;

  const lockHint = planLockHint({
    validation: lockValidation,
    busy: submitting || sorting,
    distinctStops,
    stopCountError,
    routeStale,
    startTimeIsValid,
  });
  // A button that is only waiting on the form stays tappable: the tap runs
  // submit(), which names what is missing and moves focus to it. Only a request
  // in flight really disables it.
  const lockBusy = submitting || sorting;

  // The venue index behind the pub finder's datalist. It is only ever read
  // by the composer's own stop rows (the datalist, the pub finder's match, and
  // the held pub's name), so it is asked for only once the
  // composer is on screen. `/plan` opens on describe-first at every width, and
  // measured on the audit's phone rig that arrival spent 1821 KB on two reads
  // of a 911 KB index for a control it had not drawn: 1821 KB of the route's
  // 3554 KB. Once the composer is up, the read runs exactly as it always did.
  useEffect(() => {
    if (!composerVisible) return;
    let active = true;
    fetch(planComposerVenueIndexPath(acceptedCityId))
      .then((response) => {
        if (!response.ok) throw new Error(`Venue index read failed with ${response.status}`);
        return response.json();
      })
      .then((rows: unknown) => {
        if (!active) return;
        const nextVenues = planVenueOptions(rows);
        setVenues(nextVenues);
        setVenueIndexStatus("read");
        const acceptedVenueId = liveHeldVenueId.current;
        if (!acceptedVenueId) return;
        const accepted = nextVenues.find((venue) => venue.id === acceptedVenueId);
        if (!accepted) return;
        setStops((current) => current.map((stop, index) => (
          index === 0
          && stop.venueId === acceptedVenueId
          && stop.venueName.trim() === UNRESOLVED_ACCEPTED_VENUE_NAME
            ? { ...stop, venueName: accepted.name }
            : stop
        )));
      })
      .catch(() => {
        if (active) setVenueIndexStatus("failed");
      });
    return () => { active = false; };
  }, [composerVisible, acceptedCityId, venueIndexRead]);

  useEffect(() => {
    if (recoveredDraft) trackEvent("draft_recovered", { kind: "plan", surface: "plan" });
  }, [recoveredDraft]);

  const intakeChanged = !samePlanIntake(planIntake,
    applyPlanStopCount(recoveredIntake, null, recoveredIntent.stopCount, recoveredIntent.stopCountSource).draft);
  const explicitContextChanged = JSON.stringify(cleanNightContextPatch(explicitNightContext))
    !== JSON.stringify(cleanNightContextPatch(recoveredExplicitNightContext));
  const hasRequestWork = intakeChanged || explicitContextChanged;
  const provisionalStop = provisionalRequest && !routeSorted && stops.length === 1 && Boolean(stops[0]?.venueId);

  useEffect(() => {
    if (!canPersist || (routeSaveRevoked.current && routeSorted && !routeStale)) return;
    function showSaveFailure(failure: ComposerDraftSaveFailure) {
      let cancelled = false;
      void Promise.resolve().then(() => {
        if (!cancelled) setDraftSaveFailure(failure);
      });
      return () => { cancelled = true; };
    }
    const actualMutation = pendingDraftSave.current;
    pendingDraftSave.current = false;
    const release = generatedRelease.current;
    generatedRelease.current = null;
    const acceptedAnchor = handoff?.acceptedAnchor;
    const persistedAcceptedAnchor = acceptedAnchorForPlanDraft(acceptedAnchor, stops[0]?.venueId);
    const owner = requestOwner.current;
    const session = composerAcceptanceStorage(safeSessionStorage(), owner, "session");
    const previousSession = readPlanDraftEnvelope(session);
    const acceptedIntentTime = pendingComposerAcceptanceTime(handoff, persistedAcceptedAnchor, previousSession);
    if (!actualMutation && !canSaveRecoveredComposerDraft(
      stops, preserveStoredDrafts, recoveredRouteDraft, acceptedIntentTime, recoveredPreviewReference,
    )) return;
    if (!ownsAcceptance(owner)) return showSaveFailure("request");
    const savedAt = Date.now();
    const keepsHiddenIntake = keepsProvisionalComposerIntake({
      provisionalRequest, routeSorted, hasRequestWork, conciergeQuery, recoveredQuery: recoveredIntent.conciergeQuery,
      startTime, recoveredRequestStart, wizardChosen, recoveredDraft,
    });
    const previousIntake = readComposerIntakeForSave();
    const sameIntake = previousIntake && samePlanIntake(planIntake, previousIntake.draft);
    const routeDraft = {
      stops,
      nightContext,
      explicitNightContext,
      routeNight,
      routeRevision,
      routeStale,
      groundingProof,
      createOperationKey,
      planAnchor,
    };
    const retainedPreview = retainedComposerPreviewForSave(routeDraft, {
      reference: recoveredPreviewReference, routeSorted, routeSaveRevoked: routeSaveRevoked.current,
      successfulGeneration, hasRequestWork, conciergeQuery, recoveredQuery: recoveredIntent.conciergeQuery,
      startTime, recoveredStartTime: recoveredRequestStart, wizardChosen, recoveredDraft, recoveredRouteDraft,
      sameIntake, previousIntake,
    });
    if (retainedPreview && !retainedPreview.routeReference) return showSaveFailure("request");
    const savedRoute = retainedPreview ?? saveComposerRouteCopy(routeDraft, routeCopy, {
      savedAt, successfulGeneration, actualMutation, preserveStoredDrafts, recoveredRouteDraft, recoveredPreviewToCopy, owner,
    });
    const { routeChanged, hasRouteDetails, routeSaved, previewSaved, routeReference } = savedRoute;
    if (!ownsAcceptance(owner)) return showSaveFailure(hasRouteDetails && !routeSaved ? "route" : "request");
    if (!actualMutation && !canSaveRecoveredComposerRequest(requestAmbiguous, routeCopy.current.savedAt, acceptedIntentTime)) return;
    const keepRevocation = (provisionalStop && acceptanceReleased) || preserveComposerRouteRevocation(routeSorted, recoveredDraft, previousIntake);
    const sessionDraft = composerSessionDraftForSave({
      title,
      creatorName: automaticCreatorName.current === creatorName ? "" : creatorName,
      startTime,
      conciergeQuery,
      stops,
      requestIntake: planIntake,
      explicitNightContext,
      requestedStopCountSource: planIntake.answers.stopCountSource,
    }, {
      provisionalStop, wizardChosen, retainedPreview, routeStale, routeSaveRevoked: routeSaveRevoked.current,
      keepRevocation, routeReference, requestedStopCount, persistedAcceptedAnchor,
    });
    const sameRequest = samePlanRequest(sessionDraft, previousSession?.draft);
    const recoveredRequest = {
      title: recoveredRequestTitle,
      creatorName: recoveredRequestCreator,
      startTime: recoveredRequestStart,
      conciergeQuery: recoveredIntent.conciergeQuery,
      requestedStopCount: recoveredIntent.stopCount,
      requestedStopCountSource: recoveredIntent.stopCountSource,
      acceptedAnchor: recoveredDraft?.acceptedAnchor,
      entryMode: recoveredDraft?.entryMode,
      provisionalStop: recoveredDraft?.provisionalStop,
      explicitNightContext: recoveredExplicitNightContext,
      stops: [],
    };
    if (composerRequestMutated({
      actualMutation, routeChanged, hasRequestWork, recoveredDraft, sessionDraft, recoveredRequest, previousIntake, previousSession, recoveredIntake, sameIntake,
    })) requestEditTime.current = savedAt;
    const requestChanged = requestEditTime.current !== null;
    const sessionSavedAt = planRequestSaveTime(requestEditTime.current, savedAt, {
      routeSavedAt: routeCopy.current.savedAt, sameRequest, previousSession, sameIntake, previousIntake, acceptedIntentTime,
    });
    if (!ownsAcceptance(owner)) return showSaveFailure("request");
    const writtenSession = writePlanDraftEnvelope(sessionDraft,
      persistedAcceptedAnchor ? "planning-intent" : "manual", session, sessionSavedAt,
      { requireV1: retainedPreview !== null });
    if (!ownsAcceptance(owner)) return showSaveFailure("request");
    const releaseReference = releasedComposerRouteReference(release, previousSession, writtenSession, {
      routeChanged, routeSaved, savedAt: routeCopy.current.savedAt,
    });
    const intakeRequest = releaseReference ? { ...sessionDraft, routeReference: releaseReference } : sessionDraft;
    const writtenIntake = !keepsHiddenIntake && persistComposerIntake(planIntake, sessionSavedAt, intakeRequest, actualMutation, {
      retainedPreview, hasDurableIntakeDraft, hasRequestWork, previousIntake, requestedStopCount, owner,
    });
    const { sessionWrite, intakeSaved, certificate } = composerRequestSaveStatus({
      draft: sessionDraft, intakeDraft: planIntake, writtenSession, writtenIntake, savedAt: sessionSavedAt,
      routeDraft: { ...routeDraft, savedAt: routeCopy.current.savedAt }, routeSorted, actualMutation, requestChanged,
      retainsPreview: retainedPreview !== null,
    });
    const hasStops = stops.some((stop) => stop.venueId || stop.venueName);
    return showSaveFailure(composerDraftSaveFailure({
      hasRequestWork, sessionWrite, intakeSaved, hasStops,
      routeSaved,
      previewSaved, hasRouteDetails, certificate,
    }));
  }, [acceptanceReleased, canPersist, conciergeQuery, createOperationKey, creatorName, explicitNightContext, groundingProof, handoff, hasDurableIntakeDraft, hasRequestWork, heldVenueId, nightContext, planAnchor, planIntake, preserveStoredDrafts, provisionalRequest, provisionalStop, recoveredDraft, recoveredExplicitNightContext, recoveredIntake, recoveredIntent, recoveredPreviewReference, recoveredPreviewToCopy, recoveredRequestCreator, recoveredRequestStart, recoveredRequestTitle, recoveredRouteDraft, requestAmbiguous, requestedStopCount, routeNight, routeRevision, routeSorted, routeStale, startTime, stops, successfulGeneration, title, wizardChosen]);

  useEffect(() => {
    if (hasDurableIntakeDraft) return;
    let cancelled = false;
    function seedArea(patchId: string | null): void {
      const seed = resolvePlanIntakeAreaSeed(patchId, readRememberedArea());
      if (!seed) return;
      setPlanIntake((current) => {
        if (cancelled || !canSeedPlanIntakeArea(current)) return current;
        // A seed answers the area alone. A pub-stop count the reader already
        // chose on this blank draft is theirs, so it rides into the seeded one.
        const seeded = createPlanIntakeDraft(seed);
        return current.answers.stopCount === undefined
          ? seeded
          : applyPlanStopCount(seeded, null, current.answers.stopCount, current.answers.stopCountSource).draft;
      });
    }
    function seedRememberedSoon(): void {
      queueMicrotask(() => {
        if (!cancelled) seedArea(null);
      });
    }
    // L11: an accepted night-patch area answers the area step up front, so the
    // composer never re-asks a geography the person already accepted.
    if (hydratedHandoff?.area?.kind === "night-patch") {
      seedArea(hydratedHandoff.area.id);
      return () => { cancelled = true; };
    }
    if (!composerGeolocationMaySeedIntake({
      showsDescribeFirst: planComposerShowsDescribeFirst({
        heldVenueId,
        completed: planIntake.completed,
        entryMode,
      }),
      hasQueryText: Boolean(conciergeQuery.trim() || askDraftQuery.trim()),
    })) {
      return () => { cancelled = true; };
    }
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      seedRememberedSoon();
      return () => { cancelled = true; };
    }
    navigator.geolocation.getCurrentPosition(
      ({ coords }) => {
        if (cancelled) return;
        const patch = nearestNightPatch(coords.latitude, coords.longitude);
        seedArea(patch?.id ?? null);
      },
      () => seedRememberedSoon(),
      { enableHighAccuracy: false, maximumAge: 5 * 60 * 1000, timeout: 10_000 },
    );
    return () => { cancelled = true; };
  }, [
    hasDurableIntakeDraft,
    hydratedHandoff,
    heldVenueId,
    planIntake.completed,
    entryMode,
    conciergeQuery,
    askDraftQuery,
  ]);

  function updatePlanIntake(next: PlanIntakeDraft) {
    if (!samePlanIntake(next, planIntake)) pendingDraftSave.current = true;
    const reconciled = next.answers.stopCount === undefined
      ? { draft: next, context: nightContext }
      : applyPlanStopCount(next, nightContext, next.answers.stopCount, next.answers.stopCountSource);
    const answersChanged = JSON.stringify(planIntakeHandoff(planIntake))
      !== JSON.stringify(planIntakeHandoff(reconciled.draft));
    if (answersChanged && nightContext) {
      setRouteStale(true);
      setRouteStatus("Route needs refreshing after those planning details changed.");
    }
    const exactStartInput = next.answers.exactStartIso
      ? londonDateTimeInputFromIso(next.answers.exactStartIso)
      : null;
    if (exactStartInput) setStartTime(exactStartInput);
    // A step change through the wizard itself (including "Tune details"
    // reopening a settled step) always means the wizard is the active
    // surface, so the describe-first question never reappears mid-edit.
    if (!reconciled.draft.completed) setEntryMode("wizard");
    if (next.answers.stopCount !== undefined) {
      setExplicitNightContext((current) => ({ ...current, stopCount: next.answers.stopCount }));
      setNightContext(reconciled.context);
    }
    setPlanIntake(reconciled.draft);
  }

  /** Step by step from describe-first: the guide opens on the count the reader chose there. */
  function openGuide(stopCount?: PlanStopCount) {
    pendingDraftSave.current = true;
    setWizardChosen(true);
    setEntryMode("wizard");
    if (stopCount === undefined) return;
    const intent = resolvePlanStopCountIntent(conciergeQuery, planIntake.answers.stopCount, planIntake.answers.stopCountSource);
    updatePlanIntake(applyPlanStopCount(planIntake, null, stopCount, intent.stopCountSource).draft);
  }

  function adoptDescribePrefillQuery(value: string) {
    setConciergeQuery((current) => {
      const next = value.trim();
      if (!next) return current;
      if (appliedUrlAskRef.current === next) return next;
      if (!current.trim()) return next;
      return current;
    });
  }

  function submitFromEntry(
    query: string,
    stopCount: PlanStopCount | undefined = matchPlanStopCount(query),
    intakeBase: PlanIntakeDraft = planIntake,
    context?: Partial<NightContext>,
  ) {
    // Computed once and threaded through explicitly: setPlanIntake has not
    // re-rendered yet when sortWithConcierge runs below, so reading the
    // planIntake state variable here would still see the pre-skip draft and
    // send a body the server flags as PLAN_INTAKE_MALFORMED.
    const areaSynced = syncPlanIntakeAreaFromQuery(intakeBase, query);
    const intent = resolvePlanStopCountIntent(query, intakeBase.answers.stopCount, intakeBase.answers.stopCountSource);
    const skippedIntake = skipRemainingPlanIntake({
      ...areaSynced,
      answers: {
        ...areaSynced.answers,
        stopCount,
        stopCountSource: intent.stopCountSource,
      },
    });
    setConciergeQuery(query);
    setExplicitNightContext({ ...(context ?? explicitNightContext), stopCount });
    updatePlanIntake(skippedIntake);
    sortWithConcierge(query, skippedIntake, context);
  }

  function updatePlanStartTime(value: string) {
    if (value !== startTime) pendingDraftSave.current = true;
    setStartTime(value);
    if (planIntake.answers.timeWindow) {
      const next = reconcilePlanStart(planIntake, value);
      updatePlanIntake(next);
      const option = PLAN_TIME_WINDOWS.find((candidate) => candidate.id === next.answers.timeWindow);
      if (next.answers.timeWindow !== planIntake.answers.timeWindow && londonDateTimeInputToIso(value, new Date())) {
        const daypart = option?.daypart ?? "daytime";
        setExplicitNightContext((current) => ({ ...current, daypart }));
        setNightContext((current) => current && { ...current, daypart });
      }
    }
    if (nightContext) {
      setRouteStale(true);
      setRouteStatus("Route needs refreshing after the exact start time changed.");
    }
  }

  function applyStopIdentityMutation(
    nextStops: DraftStop[],
    status: string,
    options: { reorder?: boolean; swapToAlternative?: boolean; settledStatus?: string; release?: boolean } = {},
  ): boolean {
    if (activityRef.current === "locking") return false;
    const release = Boolean(options.release && heldVenueId);
    const mutation = composerRouteMutation({
      currentStops: stops,
      nextStops,
      heldVenueId: release ? null : heldVenueId,
      groundingProof,
      createOperationKey,
      planAnchor,
      routeStale,
      reorder: options.reorder,
      swapToAlternative: options.swapToAlternative,
    });
    if (!mutation.accepted) {
      setRouteStatus("The accepted pub stays as Stop 1. Refresh the route to change the other stops.");
      return false;
    }
    pendingDraftSave.current = true;
    const stopIdentitiesChanged = stops.length !== mutation.stops.length
      || stops.some((stop, index) => stop.venueId !== mutation.stops[index]?.venueId);
    if (stopIdentitiesChanged) {
      setRouteCheckNoticeText(mutation.stops.length ? "Opening and travel checks are unavailable for this draft." : "");
      // A valid route proof can survive a swap, but the earlier cost list cannot.
      setCultureOpener((current) => {
        if (!current?.costs) return current;
        return {
          ...current,
          costs: {
            ...current.costs,
            knownItems: [],
            knownSubtotalPence: null,
            unknownItems: current.costs.unknownItems.includes("drinks")
              ? current.costs.unknownItems
              : [...current.costs.unknownItems, "drinks"],
          },
        };
      });
    }
    setStops(mutation.stops);
    setGroundingProof(mutation.groundingProof);
    setCreateOperationKey(mutation.createOperationKey);
    setPlanAnchor(mutation.planAnchor);
    setRouteStale(mutation.routeStale);
    // Removing or adding a Stop IS a request for a shorter or longer night, so
    // the asked-for count follows the route the drinker now has. Without this
    // the count stayed at what was generated, Lock it in went quietly dead on
    // the mismatch, and the next Sort put the removed Stop straight back.
    const stopCount = mutation.stops.length;
    if (stops.length !== stopCount && isPlanStopCount(stopCount)) {
      const reconciled = applyPlanStopCount(planIntake, nightContext, stopCount, "route-edit");
      setExplicitNightContext((current) => ({ ...current, stopCount }));
      setPlanIntake(reconciled.draft);
      setNightContext(reconciled.context);
    }
    if (mutation.routeStale) setRouteStatus(status);
    else if (options.settledStatus) setRouteStatus(options.settledStatus);
    if (release) dropAcceptance();
    return true;
  }

  function dropAcceptance() {
    const session = canPersist ? safeSessionStorage() : null;
    const owner = requestOwner.current;
    const ownsRequest = ownsAcceptance(owner);
    const currentIntent = readPlanningIntent({ storage: session, cleanupInvalid: false });
    const ownsRoute = canPersist && routeSorted && stops[0]?.venueId === heldVenueId;
    pendingDraftSave.current = ownsRequest;
    if (owner && ownsRequest && ownsRoute && createOperationKey && groundingProof) {
      const plan = readPlanDraftEnvelope(session);
      const stored = readComposerRouteDraft().envelope;
      const provisionalSavedAt = plan?.draft.provisionalSavedAt;
      if (provisionalSavedAt && stored && stored.value.groundingProof === groundingProof && !stored.value.routeStale
        && Date.parse(stored.savedAt ?? "") > Date.parse(provisionalSavedAt)) {
        generatedRelease.current = { operationKey: createOperationKey, provisionalSavedAt };
      }
    }
    if (ownsAcceptance(owner)) releaseAcceptedPlanContext({
      intent: currentIntent ? composerAcceptanceStorage(session, owner, "session") : null,
      planDraft: composerAcceptanceStorage(session, owner, "session"),
      routeDraft: ownsRoute ? composerAcceptanceStorage(safeLocalStorage(), owner, "local") : null,
    });
    setPlanAnchor(null);
    setGroundingProof(null);
    if (owner && !routeSorted) setRouteStale(true);
    setAcceptanceReleased(true);
  }

  function isUnnamedHeldStop(stop: DraftStop, index: number): boolean {
    return venueIndexStatus !== "reading" && index === 0 && Boolean(heldVenueId) && stop.venueId === heldVenueId && !stop.venueName.trim();
  }

  function isLockedHeldStop(stop: DraftStop, index: number): boolean {
    return index === 0 && Boolean(heldVenueId) && stop.venueId === heldVenueId && !isUnnamedHeldStop(stop, index);
  }

  function clearUnnamedHeldStop(key: number, index: number) {
    applyStopIdentityMutation(
      stops.map((stop) => stop.key === key ? { key, venueId: "", venueName: "", alternatives: [] } : stop),
      `Find a pub for stop ${index + 1}. Refresh the route before locking.`,
      { release: true },
    );
  }

  function releaseAcceptance() {
    if (activityRef.current === "locking") return;
    focusPlanRouteStatus();
    const first = stops[0];
    if (first && isUnnamedHeldStop(first, 0)) {
      clearUnnamedHeldStop(first.key, 0);
      return;
    }
    if (canPersist && routeSorted && first?.venueId === heldVenueId && ownsAcceptance(requestOwner.current)) setRouteStale(false);
    dropAcceptance();
    setRouteStatus(releasedAcceptanceStatus({
      venueName: acceptedVenueName,
    }));
  }

  /** A pub chosen for a stop that had none: the stop becomes a card. */
  function pickVenue(key: number, venue: PlanVenueOption) {
    const selected = stops.find((stop) => stop.key === key);
    if (!selected) return;
    applyStopIdentityMutation(
      stops.map((stop) => stop.key === key ? pickedPlanStop(stop, venue) : stop),
      "Stop chosen. Refresh the route before locking.",
    );
  }

  function removeStop(key: number) {
    const index = stops.findIndex((stop) => stop.key === key);
    if (index < 0) return;
    const removed = applyStopIdentityMutation(
      stops.filter((stop) => stop.key !== key),
      `Stop ${index + 1} removed. Refresh the route before locking.`,
      { release: isUnnamedHeldStop(stops[index]!, index) },
    );
    if (removed) haptic("selection-released");
  }

  function addStop() {
    if (stops.length >= MAX_PLAN_STOP_COUNT) return;
    applyStopIdentityMutation(
      [...stops, { key: Math.max(0, ...stops.map((stop) => stop.key)) + 1, venueId: "", venueName: "", alternatives: [] }],
      "Stop added. Refresh the route before locking.",
    );
  }

  /** One card moved to a new place. The haptic is the gesture's: a kept drop. */
  function reorderStops(from: number, to: number) {
    applyStopIdentityMutation(
      moveItem(stops, from, to),
      `Stop ${from + 1} moved to ${to + 1}. Refresh the route before locking.`,
      { reorder: true, settledStatus: `Stop ${from + 1} moved to place ${to + 1}.` },
    );
  }

  function updateNightContext(patch: Partial<NightContext>) {
    if (!editableContext) return;
    pendingDraftSave.current = true;
    const next = { ...editableContext, ...patch };
    if ((routeSorted || routeStale) && nightContextChanged(editableContext, next)) {
      setRouteStale(true);
      setGroundingProof(null);
      setCreateOperationKey(null);
      setRouteStatus("Route needs refreshing after that context change.");
    }
    let draft = patch.nightArea
      ? syncPlanIntakeAreaFromQuery(planIntake, getNightArea(patch.nightArea).name)
      : planIntake;
    draft = { ...draft, answers: {
      ...draft.answers,
      ...(patch.daypart !== undefined ? tuneTimeAnswers(patch.daypart, startTime, draft.answers.exactStartIso) : {}),
      ...(patch.groupSize !== undefined ? { groupSize: patch.groupSize } : {}),
      ...(patch.budget !== undefined ? { budget: patch.budget } : {}),
      ...(patch.budgetLimitPence !== undefined ? { budget: next.budget, budgetLimitPence: patch.budgetLimitPence } : {}),
    } };
    const editedSteps: PlanIntakeStep[] = [
      ...(patch.daypart !== undefined ? ["time-window" as const] : []),
      ...(patch.groupSize !== undefined ? ["group-size" as const] : []),
      ...(patch.budget !== undefined || patch.budgetLimitPence !== undefined ? ["budget" as const] : []),
    ];
    for (const step of editedSteps) {
      draft = settlePlanIntakeStep({ ...draft, currentStep: step }, { skip: !planIntakeStepHasAnswer(draft, step) });
    }
    const reconciled = patch.stopCount === undefined
      ? { draft, context: next }
      : applyPlanStopCount(draft, next, patch.stopCount, "picker");
    if (routeSorted || routeStale) setNightContext(reconciled.context);
    setPlanIntake(reconciled.draft);
    const exactStartInput = reconciled.draft.answers.exactStartIso && londonDateTimeInputFromIso(reconciled.draft.answers.exactStartIso);
    if (patch.daypart !== undefined && exactStartInput) setStartTime(exactStartInput);
    setExplicitNightContext((current) => ({ ...current, ...patch }));
    if (!user || patch.drinkCategory !== undefined || patch.zeroProof !== undefined) {
      writeDeviceNightContext(reconciled.context ?? next, acceptedCityId, undefined, editableContext);
    }
  }

  function swapStop(key: number) {
    const index = stops.findIndex((stop) => stop.key === key);
    const current = stops[index];
    if (current && isUnnamedHeldStop(current, index)) {
      clearUnnamedHeldStop(key, index);
      return;
    }
    if (!current?.alternatives.length) return;
    const usedByOtherStops = new Set(stops.filter((stop) => stop.key !== key).map((stop) => stop.venueId));
    const next = swapDraftStop(current, usedByOtherStops);
    if (next === current) {
      setRouteStatus("No other pub we can vouch for near that stop yet.");
      return;
    }
    const position = stops.findIndex((stop) => stop.key === key) + 1;
    applyStopIdentityMutation(
      stops.map((stop) => stop.key === key ? next : stop),
      `Stop ${position} swapped to ${next.venueName}. Refresh the route before locking.`,
      { swapToAlternative: true, settledStatus: `Stop ${position} swapped to ${next.venueName}.` },
    );
  }

  function prepareConciergeRequest(
    queryOverride?: string,
    intakeOverride?: PlanIntakeDraft,
    context: Partial<NightContext> = requestContext,
  ) {
    // Both overrides (from the describe-first entry surface) are threaded
    // through explicitly before React re-renders, so state reads here cannot
    // send the pre-skip intake to the server.
    const query = queryOverride ?? conciergeQuery;
    const queryArea = nightAreaFromPlanQuery(query);
    const intakeBase = intakeOverride ?? planIntake;
    const { stopCount, stopCountSource } = resolvePlanStopCountIntent(query, intakeBase.answers.stopCount, intakeBase.answers.stopCountSource);
    const explicitContext = { ...context, stopCount };
    if (queryArea.kind !== "none") {
      setExplicitNightContext((current) => ({
        ...current,
        nightArea: queryArea.kind === "unsupported-patch" ? null : queryArea.slug,
      }));
    }
    const intake = syncPlanIntakeAreaFromQuery(
      applyPlanStopCount(intakeBase, null, stopCount, stopCountSource).draft,
      query,
    );
    if (queryOverride === undefined && intake !== planIntake) {
      updatePlanIntake(intake);
    }
    const intakeContextForSort = planIntakeNightContextPatch(intake);
    const intakeUnsupportedPatch = unsupportedPatchForCurrentGenerator(
      intake,
      intakeContextForSort,
    );
    const queryUnsupportedPatchForSort =
      queryArea.kind === "unsupported-patch"
        ? resolveNightPatch(queryArea.patchId)
        : null;
    const blockedUnsupportedPatch = intakeUnsupportedPatch ?? queryUnsupportedPatchForSort;
    if (queryOverride === undefined && !canSortWithCurrentGenerator) return null;
    if (blockedUnsupportedPatch) {
      setConciergeNote(conciergeStatusText(false, blockedUnsupportedPatch, ""));
      return null;
    }
    pendingDraftSave.current = true;
    if (queryOverride !== undefined) setPlanIntake(intake);
    const submittedContext = mergeSubmittedNightContext(
      explicitContext,
      intakeContextForSort,
      queryArea,
    );
    if (!submittedContext.nightArea && queryArea.kind === "none") {
      const area = venueNightArea(venues.find((venue) => venue.id === heldVenueId), acceptedCityId);
      if (area) submittedContext.nightArea = area;
    }
    return { query, intake, submittedContext };
  }

  async function sortWithConcierge(
    queryOverride?: string,
    intakeOverride?: PlanIntakeDraft,
    context: Partial<NightContext> = requestContext,
  ) {
    const lifetimeSignal = formLifetime.current?.signal;
    if (!lifetimeSignal || activityRef.current !== "idle") return;
    const signal = compositeActionSignal([lifetimeSignal, readProviderAccountSignal()]);
    if (signal.aborted) return;
    const request = prepareConciergeRequest(queryOverride, intakeOverride, context);
    if (!request) return;
    const { query, intake, submittedContext } = request;
    // A crawl the Pal (or Ask the map) drafted for THIS ask is kept: spent
    // here, once, by the generation that answers it.
    const palDraft = takePalDraft(palDraftRef, query);
    // A start that passed while the page stayed open is not sent. The field
    // takes the current default, and that is the start the request carries.
    let submittedStart = startTime;
    if (startHasPassed(submittedStart)) {
      submittedStart = nextEvening();
      setStartTime(submittedStart);
    }
    beginActivity("generating");
    setError("");
    setRouteStatus(palDraftCheckingLine(palDraft, routeSorted
      ? "Refreshing the route and rechecking every stop for your updated night."
      : "Building the route and checking every stop for your night."));
    let responseStatus: number | null = null;
    try {
      // The handoff policy owns fallback order and protects an accepted first pub.
      const baseContext = { ...submittedContext };
      const { response, body: rawBody, attempt: taken } = await requestPlanGeneration(
        palDraft,
        palDraftAttempts(palDraft, handoff?.acceptedAnchor, intake.answers.stopCount ?? null),
        (attempt) => buildPlanGenerationIntakeBody(
          intake,
          query,
          null,
          { ...baseContext, ...attempt.context },
          attempt.anchor,
          londonDateTimeInputToIso(submittedStart),
        ),
        signal,
      );
      if (signal.aborted) return;
      responseStatus = response.status;
      if (!ownsAcceptance(requestOwner.current)) throw new Error(COMPOSER_OWNERSHIP_CHANGED);
      // The kept route's own length is the night it answers.
      Object.assign(submittedContext, taken.context);
      const kept = taken.keeps;
      const body = rawBody as {
        stops?: unknown;
        alternatives?: unknown;
        cultureOpener?: unknown;
        dryRound?: unknown;
        inferredContext?: NightContext;
        groundingProof?: unknown;
        constraintReport?: unknown;
        operationKey?: unknown;
        anchored?: unknown;
        anchorVenueId?: unknown;
        anchorSource?: unknown;
        outcome?: unknown;
        planningConfidence?: unknown;
        message?: unknown;
        error?: unknown;
      } | null;
      if (!response.ok) throw new Error(errorMessageFromBody(body, "PUBMAXX could not sort this one."));
      if (!body) throw new Error("PUBMAXX could not sort this one.");
      const anchorConflict = anchorConflictMessage(body);
      if (anchorConflict) {
        // Answered 200 with no Stops on purpose: the kept pub is what is in the
        // way, and only the server knows which check refused it.
        setConciergeNote(anchorConflict);
        setRouteStatus(anchorConflict);
        return;
      }
      const suggested = routeStopsFromGenerated(body.stops, body.alternatives);
      if (!suggested.length) {
        // Zero matches is guidance, not failure (friction sweep follow-up 9):
        // the polite status slot, never the red error banner.
        setConciergeNote(NO_VENUES_MATCHED);
        setRouteStatus(NO_VENUES_MATCHED);
        return;
      }
      pendingDraftSave.current = true;
      setStops(suggested);
      setSuccessfulGeneration((generation) => generation + 1);
      setRouteCheckNoticeText(routeCheckNotice(body.planningConfidence));
      setRouteSorted(true);
      setCultureOpener(cleanCultureOpener(body.cultureOpener));
      setDryRoundPrices(cleanDryRoundPrices(body.dryRound));
      const reportLine = planReportLine(body.constraintReport);
      generatedReportRef.current = reportLine
        ? { line: reportLine, venueIds: suggested.map((stop) => stop.venueId).join(",") }
        : null;
      const grounded = isGroundedGeneratedRoute(body, suggested);
      const generatedAnchor = generatedPlanAnchorFromResponse(body);
      const { reconciled, conciergeNote, routeStatus: generationStatus } = generatedRouteFeedback({
        inferredContext: body.inferredContext,
        submittedContext,
        generatedAnchor,
        suggested,
        refreshed: routeSorted,
      });
      if (reconciled) {
        setNightContext(reconciled);
      }
      setRouteNight(routeNightOf(reconciled ?? submittedContext));
      setRouteRevision(routeRevisionFromState(body));
      setRouteStale(false);
      setGroundingProof(typeof body.groundingProof === "string" ? body.groundingProof : null);
      setCreateOperationKey(typeof body.operationKey === "string" ? body.operationKey : null);
      setPlanAnchor(generatedAnchor);
      markPalRouteActivation();
      if (new URLSearchParams(window.location.search).get("from") === "onboarding") {
        recordPlanHighIntentAction();
      }
      trackEvent("plan_started");
      trackEvent("plan_generated", { stops: suggested.length, grounded });
      // Say what happened to the drafted pubs, ahead of the usual line.
      const shown = palDraftRouteLines(palDraft, kept, suggested.map((stop) => stop.venueName), {
        conciergeNote,
        routeStatus: generationStatus,
      });
      setConciergeNote(shown.conciergeNote);
      setRouteStatus(shown.routeStatus);
      setRouteRevealTick((tick) => tick + 1);
      setRouteDrawKey(suggested.map((stop) => stop.venueId).join(">"));
      if (body.inferredContext) {
        trackEvent("night_description_submitted", { area: body.inferredContext.nightArea ?? "", daypart: body.inferredContext.daypart });
      }
    } catch (caught) {
      if (signal.aborted) return;
      const message = caught instanceof Error ? caught.message : "PUBMAXX could not sort this one.";
      // planGenerationFailureStatus is the ONE owner of this sentence, so the
      // error notice cannot tell a reader with no route on screen that "the
      // earlier route is still here". A held Stop 1 alone is not a route: only
      // a sorted one can be "still here" or need a refresh.
      const failureStatus = planGenerationFailureStatus(message, routeSorted);
      trackErrorShown("plan", errorShownKindFromStatus(responseStatus));
      setError(failureStatus);
      pendingDraftSave.current = true;
      if (routeSorted) setRouteStale(true);
      setRouteStatus(failureStatus);
      setRouteRevealTick((tick) => tick + 1);
    } finally {
      endActivity();
    }
  }

  function validatePlanSubmission(): boolean {
    const validationError = planLockValidationError({
      title,
      creatorName,
      startTime,
      completeStopCount: completeStops.length,
      visibleStopCount: stops.length,
      groundingProof,
      singleStopVenueId: completeStops.length === 1 ? completeStops[0]?.venueId : null,
      planAnchor,
    });
    if (validationError) {
      setError(validationError.message);
      if (validationError.focus === "name") nameInputRef.current?.focus();
      return false;
    }
    if (!distinctStops) {
      setError(PLAN_DISTINCT_STOPS_ERROR);
      return false;
    }
    if (stopCountError) {
      setError(stopCountError);
      return false;
    }
    if (routeSaveRevoked.current || routeStale) {
      setError("Refresh the route before locking it in. Your previous preview is still safe.");
      setRouteStatus("The route is still a preview because its context changed. Refresh it before locking.");
      return false;
    }
    if (!ownsAcceptance(requestOwner.current)) {
      setError(COMPOSER_OWNERSHIP_CHANGED);
      return false;
    }
    return true;
  }

  function clearConsumedComposerDrafts(owner: ComposerRequestOwner | null): void {
    assertComposerOwnership(ownsAcceptance(owner));
    settleConsumedPlanningIntent(completeStops, owner);
    clearPersistedPlanDrafts({
      planDraft: composerAcceptanceStorage(safeSessionStorage(), owner, "session"),
      routeDraft: composerAcceptanceStorage(safeLocalStorage(), owner, "local"),
    });
    if (ownsAcceptance(owner)) clearPlanIntakeDraft(composerAcceptanceStorage(safeLocalStorage(), owner, "local"));
  }

  // A refused route (422) or a key already spent on other details (409) can
  // never lock as it is: the proof is bound to its key. The route waits for a
  // refresh, which brings a new proof and key, instead of sending the same
  // refusal on every tap.
  function lockFailureMessage(status: number, body: unknown, operationKey: string): string {
    if (status === 422 || status === 409) {
      clearPersistentPlanMutationKey("create", operationKey);
      pendingDraftSave.current = true;
      setGroundingProof(null);
      setCreateOperationKey(null);
      setRouteStale(true);
    }
    const mapped = hydratedHandoff || status === 409 ? composerLockErrorFromResponse(status) : null;
    return mapped || errorMessageFrom(body, "The plan could not be created.");
  }

  async function prepareCreateOperation(createPayload: Record<string, unknown>, signal: AbortSignal) {
    const boundKey = groundingProof ? createOperationKey : null;
    const attempt = await preparePlanMutationKey("create", createPayload, {
      signal,
      boundKey,
      previous: sentCreateOperation.current,
    });
    if (signal.aborted) return null;
    assertComposerOwnership(ownsAcceptance(requestOwner.current));
    if (groundingProof && createOperationKey && attempt.key !== createOperationKey) {
      throw new Error(lockFailureMessage(409, null, createOperationKey));
    }
    sentCreateOperation.current = attempt;
    rememberPlanMutationKey("create", attempt, boundKey);
    return attempt;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const lifetimeSignal = formLifetime.current?.signal;
    if (!lifetimeSignal) return;
    const signal = compositeActionSignal([lifetimeSignal, readProviderAccountSignal()]);
    if (signal.aborted || activityRef.current !== "idle") return;
    if (!validatePlanSubmission()) return;
    beginActivity("locking");
    setError("");
    try {
      const exactStartIso = resolveFutureLondonStartIso(
        startTime,
        planIntake.answers.exactStartIso,
        new Date(),
      );
      if (!exactStartIso) throw new Error("Choose a valid future London start time.");
      const createPayload = composerCreatePayload({
        title,
        creatorName,
        startTime: exactStartIso,
        cityId: acceptedCityId,
        stops: completeStops,
        groundingProof,
        planAnchor,
        context: nightContext,
      });
      const attempt = await prepareCreateOperation(createPayload, signal);
      if (!attempt) return;
      const operationKey = attempt.key;
      const response = await fetch("/api/plans", {
        signal,
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": operationKey },
        body: JSON.stringify(createPayload),
      });
      assertComposerOwnership(ownsAcceptance(requestOwner.current));
      const body = await response.json();
      if (signal.aborted) return;
      assertComposerOwnership(ownsAcceptance(requestOwner.current));
      if (!response.ok || !body?.plan?.plan?.id) {
        throw new Error(lockFailureMessage(response.status, body, operationKey));
      }
      const planId = body.plan.plan.id as string;
      const attribution = serverPlanCreationAttribution(body);
      if (!attribution) throw new Error("We could not check the route details. Reload the plan before continuing.");
      const { grounded } = attribution;
      const acceptanceTelemetry = planAcceptanceTelemetry(body, completeStops.length);
      const draftSavedTelemetry = planDraftSavedTelemetry(body, planAnchor, completeStops);
      const draftSavedToken = responseEventToken(body, "planDraftSaved");
      const acceptedToken = responseEventToken(body, "planAccepted");
      const meaningfulToken = responseEventToken(body, "meaningfulCoreAction");
      if (draftSavedTelemetry && draftSavedToken) {
        trackEvent("plan_draft_saved", draftSavedTelemetry, { deliveryToken: draftSavedToken });
      }
      // The lock is counted for every plan the server attributed, not only the
      // ones that carry signed acceptance tokens: those fail closed for a plan
      // without an anchor, which left the funnel's lock step at zero.
      const lockTelemetry = crawlLockedTelemetry(body, completeStops.length);
      if (lockTelemetry) trackEvent("crawl_locked", lockTelemetry);
      if (acceptanceTelemetry && acceptedToken && meaningfulToken) {
        trackEvent("plan_accepted", acceptanceTelemetry, { deliveryToken: acceptedToken });
        trackMeaningfulCoreAction("plan_accepted", meaningfulToken);
      }
      // lane_to_plan only counts creations with lane provenance (?src=…, set
      // by lane surfaces such as the W1 Tonight lane). window.location is read
      // at submit time — not via useSearchParams — so this client component
      // needs no Suspense boundary on the server-rendered /plan page. Without
      // a known src the event stays silent: honest zero > invented signal.
      const laneSource = laneSourceFromSearch(window.location.search);
      if (attribution.created && laneSource) {
        trackEvent("lane_to_plan", { source: laneSource, stops: completeStops.length });
      }
      if (attribution.created) trackEvent("plan_created", { count: completeStops.length });
      // First high-intent action → arm the signed-out account nudge (self-gates
      // on auth/cooldown; browsing was never gated). In the native shell this
      // wins over the push prompt, which defers via isIdentityNudgePending().
      if (attribution.created) recordPlanNudgeTrigger(planId);
      if (body.memberToken) {
        writePlanCapability(planId, { token: body.memberToken, collaborationAuthorized: true, role: "host" });
        const metadataPatch = createdPlanMetadataPatch(body.plan as PlanState, nightContext);
        if (metadataPatch) {
          assertComposerOwnership(ownsAcceptance(requestOwner.current));
          const metadataResponse = await fetch(`/api/plans/${planId}`, {
            signal,
            method: "PATCH",
            headers: {
              "content-type": "application/json",
              authorization: `Bearer ${body.memberToken}`,
            },
            body: JSON.stringify(metadataPatch),
          });
          if (signal.aborted) return;
          assertComposerOwnership(ownsAcceptance(requestOwner.current));
          if (!metadataResponse.ok) {
            discardBody(metadataResponse);
            throw new Error("The route was created, but its details could not be saved. Try again.");
          }
        }
      }
      trackEvent("plan_saved", { stops: completeStops.length, grounded });
      trackMeaningfulCoreAction("plan_saved");
      rememberPlanHostName(safeLocalStorage(), creatorName);
      const owner = requestOwner.current;
      clearConsumedComposerDrafts(owner);
      clearPersistentPlanMutationKey("create", operationKey);
      haptic("plan-locked");
      rememberLockedReportLine(planId, generatedReportRef.current, completeStops);
      router.push(`/plan/${planId}#share`);
    } catch (caught) {
      if (!signal.aborted) setError(caught instanceof Error ? caught.message : "The plan could not be created.");
    } finally {
      endActivity();
    }
  }

  const routeStaleNotice = routeStale && stops.length && (!provisionalStop || !heldVenueId) ? (
    <div className="planComposer__routeStale" role="group" aria-labelledby="plan-route-stale-title">
      <div>
        <strong id="plan-route-stale-title">This route needs a refresh</strong>
        <span>You&rsquo;ve changed the night since we sorted it, so this preview may not fit any more.</span>
      </div>
      <button
        type="button"
        className="planComposer__regenerate"
        onClick={() => sortWithConcierge()}
        disabled={sorting || !canSortWithCurrentGenerator}
        aria-busy={sorting}
      >
        {sorting ? "Refreshing…" : "Regenerate route"}
      </button>
    </div>
  ) : null;
  const routeStatusLine = (
    <p id="plan-route-status" className={resultMode ? "planResult__status" : "planComposer__routeStatus"} role="status" aria-live="polite" tabIndex={-1}>
      {error && routeStatus === error
        ? null
        : routeStatus || (stops.length
          ? routeStale ? "The route needs refreshing before it can be locked." : "Review the route preview. It stays private until you lock it in."
          : "")}
    </p>
  );
  const draftSaveMessage = draftSaveFailure === "all"
    ? "Your changes could not be saved on this device. Keep this page open to keep them."
    : draftSaveFailure === "route"
      ? "Your route could not be saved on this device. Keep this page open to keep it."
      : draftSaveFailure === "route-details"
        ? "Your stops were saved, but your route details, checks and starting pub could not be saved. Keep this page open to keep them."
        : draftSaveFailure === "request"
          ? "Your plan details could not be saved on this device. Keep this page open to keep them."
        : draftSaveFailure === "description"
          ? "Your description could not be saved on this device. Keep this page open to keep it."
          : "";
  const descriptionRestoreMessage = recoveredIntent.descriptionUnavailable && !conciergeQuery.trim() && !askDraftQuery.trim()
    ? "Your latest description could not be restored. Enter it again." : "";
  const draftSaveNotice = draftSaveMessage || descriptionRestoreMessage ? (
    <>
      {draftSaveMessage ? <p className="planComposer__error" role="alert">{draftSaveMessage}</p> : null}
      {descriptionRestoreMessage ? <p className="planComposer__error" role="alert">{descriptionRestoreMessage}</p> : null}
    </>
  ) : null;
  const stopCountControl = (
      <label htmlFor="plan-context-stops">Stops<select id="plan-context-stops" aria-describedby="plan-route-status" value={normalizePlanStopCount(requestedStopCount)} onChange={(event) => {
        const stopCount = normalizePlanStopCount(Number(event.target.value));
        if (editableContext) updateNightContext({ stopCount });
        else updatePlanIntake(applyPlanStopCount(planIntake, null, stopCount, "picker").draft);
      }}>{PLAN_STOP_COUNTS.map((count) => <option key={count} value={count}>{count}</option>)}</select></label>
  );
  const renderConcierge = (inSheet: boolean) => (
    <section className="planComposer__concierge" {...(inSheet ? { "aria-label": "Describe your outing" } : { "aria-labelledby": "plan-concierge-title" })} aria-busy={sorting}>
      {inSheet ? draftSaveNotice : null}
      {inSheet ? null : (
        <div>
          <span className="planPage__eyebrow">Describe your outing</span>
          <h2 id="plan-concierge-title">Say what you need. Get a route you can stand behind.</h2>
        </div>
      )}
      <div className="planComposer__conciergeInput">
        <label className="planComposer__srOnly" htmlFor="plan-concierge-query">{PLAN_FIELD_LABEL}</label>
        <input id="plan-concierge-query" type="text" aria-describedby="plan-concierge-status" value={conciergeQuery} onChange={(event) => { pendingDraftSave.current = true; setConciergeQuery(event.target.value); }} onKeyDown={inSheet ? (event) => { if (event.key === "Enter") { event.preventDefault(); if (!sorting && canSortWithCurrentGenerator) sortWithConcierge(); } } : undefined} placeholder="Add a mood, occasion or anything we missed" maxLength={500} />
        {/* ONE PAINTED PRIMARY PER SCREEN. Once a route is on the page,
            `Lock it in` is the thing to do next, and two coral fills on one
            screen is the reader choosing between them. This control keeps
            its place and its words change to what it now does; it is
            demoted rather than removed, because editing the description
            above it has to stay answerable. While it is busy it is only
            aria-disabled: a disabled button loses focus, and inside Tune
            details that drops the reader to the page body behind the sheet. */}
        <button
          type="button"
          className={routeSorted ? "planComposer__resort" : undefined}
          onClick={() => { if (!sorting) sortWithConcierge(); }}
          disabled={!canSortWithCurrentGenerator}
          aria-disabled={sorting || undefined}
          aria-busy={sorting}
        >
          <PourLine busy={sorting} />
          {sorting ? "Planning…" : routeSorted ? PLAN_RESUBMIT_LABEL : "Make a plan"}
        </button>
      </div>
      <p id="plan-concierge-status" className="planComposer__conciergeStatus" role="status" aria-live="polite">
        {conciergeStatus}
      </p>
      {inSheet ? null : routeStaleNotice}
      {!editableContext ? <div className="planComposer__context">{stopCountControl}</div> : null}
      {editableContext ? (
        <fieldset className="planComposer__context" disabled={submitting}>
          <legend>What PUBMAXX understood. Edit anything.</legend>
          <p id="plan-context-note" className="planComposer__contextNote">We only call an area crawl-ready when its prices are fresh and checked. An area that is not ready yet may not give a route.</p>
          <label htmlFor="plan-context-area">Area<select id="plan-context-area" aria-describedby="plan-context-note plan-route-status" value={editableContext.nightArea ?? ""} onChange={(event) => updateNightContext({ nightArea: event.target.value as NightContext["nightArea"] })}>
            {areaGroups.map((group) => (
              <optgroup key={group.label} label={group.label}>
                {group.areas.map((area) => (
                  <option key={area.slug} value={area.slug}>
                    {nightAreaOptionLabel(area, group.disabled)}
                  </option>
                ))}
              </optgroup>
            ))}
          </select></label>
          <label htmlFor="plan-context-time">Time<select id="plan-context-time" aria-describedby="plan-route-status" value={editableContext.daypart} onChange={(event) => updateNightContext({ daypart: event.target.value as NightContext["daypart"] })}>
            <option value="daytime">Daytime</option><option value="after_work">After work</option><option value="evening">Evening</option><option value="late_night">Late night</option><option value="get_home">Get home</option>
          </select></label>
          <label htmlFor="plan-context-group">Group<select id="plan-context-group" aria-describedby="plan-route-status" value={editableContext.partyType} onChange={(event) => updateNightContext({ partyType: event.target.value as NightContext["partyType"] })}>
            <option value="solo">Solo</option><option value="friends">Friends</option><option value="work">Work</option>
          </select></label>
          <label htmlFor="plan-context-people">People<input id="plan-context-people" aria-describedby="plan-route-status" type="number" min="1" max="30" value={editableContext.groupSize ?? ""} onChange={(event) => updateNightContext({ groupSize: event.target.value ? Number(event.target.value) : null })} /></label>
          {stopCountControl}
          <label htmlFor="plan-context-budget">Budget<select id="plan-context-budget" aria-describedby="plan-route-status" value={editableContext.budget} onChange={(event) => updateNightContext({ budget: event.target.value as NightContext["budget"] })}>
            <option value="value">Value</option><option value="standard">Standard</option><option value="treat">Treat</option>
          </select></label>
          <label htmlFor="plan-context-budget-limit">Max per person<input id="plan-context-budget-limit" aria-describedby="plan-route-status" type="number" inputMode="decimal" min="5" max="500" step="1" value={editableContext.budgetLimitPence === null ? "" : editableContext.budgetLimitPence / 100} onChange={(event) => updateNightContext({ budgetLimitPence: event.target.value ? Math.round(Number(event.target.value) * 100) : null })} /></label>
          <label htmlFor="plan-context-zero-proof">Drinks<select id="plan-context-zero-proof" aria-describedby="plan-route-status" value={editableContext.zeroProof ? "zero-proof" : editableContext.drinkCategory ?? "any"} onChange={(event) => {
            const choice = event.target.value;
            updateNightContext({
              zeroProof: choice === "zero-proof",
              drinkCategory: choice === "any" || choice === "zero-proof" ? null : choice as DrinkCategory,
            });
          }}>
            {/* "0.0 options" read as broken number formatting, not as a drink.
                The option names the drink the way the rest of the app does. */}
            <option value="any">Any drinks</option><option value="zero-proof">Alcohol-free</option>
            {DRINK_CATEGORIES.filter((category) =>
              category !== "alcohol-free" && category !== "soft-drink" && category !== "coffee" && category !== "other"
            ).map((category) => <option key={category} value={category}>{categoryLabel(category)}</option>)}
          </select></label>
        </fieldset>
      ) : null}
    </section>
  );
  const templatesBlock = (
    <section className="planComposer__templates" aria-labelledby="plan-templates-title">
      <h2 id="plan-templates-title">Need a starting point?</h2>
      <p className="planComposer__templatesLead">
        Pick a prompt to fill in the description. You can still edit it.
      </p>
      {usualLot ? (
        <div className="planComposer__usualLot" data-testid="plan-usual-lot">
          <p>
            Usual lot: <strong>{usualLot.names.join(", ")}</strong>
          </p>
          <button
            type="button"
            className="planComposer__template"
            disabled={submitting}
            onClick={() => {
              if (activityRef.current === "locking") return;
              pendingDraftSave.current = true;
              setTitle("Usual lot · tonight");
              setConciergeNote(`Re-invite ${usualLot.names.join(", ")} after you lock it in.`);
            }}
          >
            Plan with the usual lot
          </button>
        </div>
      ) : null}
      {/* The row reads London's date itself, so a seasonal template leads it
          in its window and is absent outside it (lib/planTemplates.ts). */}
      <PlanTemplateRow
        disabled={submitting}
        onPick={(template) => {
          if (activityRef.current === "locking") return;
          pendingDraftSave.current = true;
          const merged = mergePlanTemplateFields({
            title,
            conciergeQuery,
            conciergeNote,
            template,
            hasAcceptedGeography: Boolean(
              handoff?.answeredArea
              || planIntake.answers.area
              || nightContext?.nightArea
              || explicitNightContext?.nightArea,
            ),
          });
          setTitle(merged.title);
          setConciergeQuery(merged.conciergeQuery);
          setConciergeNote(merged.conciergeNote);
        }}
      />
    </section>
  );
  const coverageBlock = (
    <section className="planComposer__coverage" aria-labelledby="plan-coverage-title">
      <details>
        <summary>
          <span id="plan-coverage-title">Area coverage</span>
          <span className="planComposer__coverageMeta">
            {readyAreas.length} of {readyAreas.length + areasInProgress.length} crawl-ready
          </span>
        </summary>
        <p className="planComposer__coverageIntro">
          Area reviews are unavailable. You can still make a draft and check each stop.
        </p>
        <div className="planComposer__coverageGroups">
          <section aria-labelledby="plan-coverage-ready">
            <h3 id="plan-coverage-ready">Crawl-ready</h3>
            <ul>
              {readyAreas.map((area) => {
                const summary = nightAreaCoverageSummary(area);
                return (
                  <li key={area.slug} data-tone={summary.tone} data-coverage-status={area.coverageStatus}>
                    <div>
                      <strong>{area.name}</strong>
                      <small>{summary.detail}</small>
                      <small className="planComposer__coverageMetaLine">{nightAreaCoverageMeta(area)}</small>
                    </div>
                    <div className="planComposer__coverageActions">
                      <span>{summary.label}</span>
                      <Link className="planComposer__coverageMapLink" href={nightAreaMapHref(area)} aria-label={`Explore ${area.name} pubs on the map`}>Explore map</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
          <section aria-labelledby="plan-coverage-progress">
            <h3 id="plan-coverage-progress">Not crawl-ready yet</h3>
            <ul>
              {areasInProgress.map((area) => {
                const summary = nightAreaCoverageSummary(area);
                return (
                  <li key={area.slug} data-tone={summary.tone} data-coverage-status={area.coverageStatus}>
                    <div>
                      <strong>{area.name}</strong>
                      <small>{summary.detail}</small>
                      <small className="planComposer__coverageMetaLine">{nightAreaCoverageMeta(area)}</small>
                    </div>
                    <div className="planComposer__coverageActions">
                      <span>{summary.label}</span>
                      <Link className="planComposer__coverageMapLink" href={nightAreaMapHref(area)} aria-label={`Explore ${area.name} pubs on the map`}>Explore map</Link>
                    </div>
                  </li>
                );
              })}
            </ul>
          </section>
        </div>
      </details>
    </section>
  );
  // Whether the field is anything OTHER than a start still to come on the
  // night running now: a later night, a start that has already passed, or a
  // time that is not a London one. A passed start is the state that needs the
  // door most - the lock has already refused it - and reading the night alone
  // withheld it there.
  const fieldNight = londonNightsAhead(startTime);
  const fieldWantsTonight = !fieldNight || fieldNight.nights !== 0 || fieldNight.past;
  const tonightLabel = tonightChoiceLabel();
  const fieldsBlock = (
    <>
      <div className="planComposer__field planComposer__field--wide">
        <label htmlFor="plan-title">Name the night</label>
        <input id="plan-title" type="text" maxLength={80} disabled={submitting} value={title} onChange={(event) => { if (activityRef.current === "locking") return; pendingDraftSave.current = true; setTitle(event.target.value); }} />
      </div>
      {nameInLockBar ? null : nameField}
      <div className="planComposer__field">
        <label htmlFor="plan-time">{nightContext && !planUsesPintPrices(nightContext) ? "First stop" : "First pint"}</label>
        <input id="plan-time" type="datetime-local" required disabled={submitting} aria-invalid={lockHint === PLAN_START_TIME_HINT ? true : undefined} aria-describedby={lockHint === PLAN_START_TIME_HINT ? "plan-lock-hint" : undefined} value={startTime} onChange={(event) => updatePlanStartTime(event.target.value)} />
        {/* Late in the evening the default is tomorrow at 19:00, so the night
            the reader is standing in needs a door of its own. It carries the
            date because an early-hours slot reads as tomorrow on a calendar
            and as tonight on a night out. */}
        {tonightLabel && fieldWantsTonight ? (
          <button
            type="button"
            className="planComposer__tonight"
            data-testid="plan-tonight-choice"
            disabled={submitting}
            onClick={() => {
              const slot = tonightLondonStartInput();
              if (slot) updatePlanStartTime(slot);
            }}
          >
            Tonight, {tonightLabel}
          </button>
        ) : null}
      </div>

    </>
  );

  const areaName = routeNight?.nightArea ? getNightArea(routeNight.nightArea)?.name ?? null : null;
  const viewStops = completeStops;
  const summaryLine = routeSummaryLine(viewStops, measured, startTime);
  const stripStops = viewStops.map((stop, position) => ({ venueId: stop.venueId, venueName: stop.venueName, position }));
  const stopsBlock = (
    <fieldset className="planComposer__stops" disabled={submitting}>
      <legend className={resultMode ? "planComposer__srOnly" : undefined}>The {planOutingNoun(stops.length)} <span className="planComposer__previewLabel">{routeRevision === null ? "Preview" : `Preview · revision ${routeRevision}`}</span></legend>
      {resultMode ? null : routeStatusLine}
      <PlanCultureOpener opener={cultureOpener} />
      {venueIndexStatus === "failed" ? (
        <p className="planComposer__error planStops__indexError" role="alert">
          The pub list did not load.
          <button
            type="button"
            onClick={() => {
              setVenueIndexStatus("reading");
              setVenueIndexRead((read) => read + 1);
            }}
          >Try again</button>
        </p>
      ) : null}
      <PlanStopList
        stops={stops}
        areaName={areaName}
        heldVenueId={heldVenueId}
        measured={measured}
        venues={venues}
        canAdd={stops.length < MAX_PLAN_STOP_COUNT}
        refreshKey={routeRevealTick}
        removable={stops.length > 1}
        swapLabel={(stop, index) => isLockedHeldStop(stop, index)
          ? acceptedStop1SwapLabel(stop.venueName.trim() || UNRESOLVED_ACCEPTED_STOP_LABEL)
          : isUnnamedHeldStop(stop, index)
            ? `Swap stop ${index + 1}, currently ${UNRESOLVED_ACCEPTED_STOP_LABEL.toLocaleLowerCase()}`
            : stop.alternatives.length > 0
              ? `Swap stop ${index + 1}, currently ${stop.venueName}`
              : `No alternatives for stop ${index + 1}`}
        swapDisabled={(stop, index) => isLockedHeldStop(stop, index)
          || (!isUnnamedHeldStop(stop, index) && stop.alternatives.length === 0)}
        removeLabel={(stop, index) => isLockedHeldStop(stop, index)
          ? acceptedStop1RemoveLabel(stop.venueName.trim() || UNRESOLVED_ACCEPTED_STOP_LABEL)
          : `Remove stop ${index + 1}`}
        removeDisabled={isLockedHeldStop}
        onSwap={swapStop}
        onRemove={removeStop}
        onPick={pickVenue}
        onReorder={reorderStops}
        onAdd={addStop}
      />
      {routeCheckNoticeText ? <p className="planResult__provenance">{routeCheckNoticeText}</p> : null}
    </fieldset>
  );
  const resultStrip = stripStops.length >= 2 ? (
      <PlanRouteMiniMap
        stops={stripStops}
        mapHref={buildCrawlMapHref(stripStops.map((stop) => stop.venueId))}
        variant="strip"
        drawKey={routeDrawKey ?? undefined}
        onLegs={onMeasuredLegs}
      />
  ) : null;
  const resultHeader = (
    <section className="planResult" aria-labelledby="plan-result-title">
      <div className="planResult__top">
        <h1 id="plan-result-title" className="planResult__title">{routeHeading({ daypart: routeNight?.daypart, areaName, startInput: startTime })}</h1>
        <button type="button" className="planResult__tune" aria-haspopup="dialog" disabled={submitting} onClick={() => setTuneOpen(true)}>
          <SlidersHorizontal size={16} aria-hidden="true" /> <span className="planResult__tuneLabel">Tune details</span>
        </button>
      </div>
      <p className="planResult__summary" data-testid="plan-route-summary">{summaryLine}</p>
      {routeStatusLine}
      {routeStaleNotice}
    </section>
  );
  // The listed prices and their evidence sit under the stops with a running
  // subtotal against the per-person budget.
  const budgetLimitPence = nightContext && planUsesPintPrices(nightContext)
    && typeof nightContext.budgetLimitPence === "number" ? nightContext.budgetLimitPence : null;
  const budgetLedger = budgetLimitPence !== null && viewStops.length > 0 ? (
    <PlanBudgetLedger
      limitPence={budgetLimitPence}
      stops={viewStops.map((stop) => ({
        venueId: stop.venueId,
        venueName: stop.venueName,
        pricePence: stop.estimatedPintPricePence,
        priceKind: stop.priceKind,
        pintPriceEvidence: stop.pintPriceEvidence,
      }))}
    />
  ) : null;
  // A dry round prints each stop's listed alcohol-free price with its pint
  // beside it. A pub added by hand that lists none says so on its own row.
  const dryRoundLedger = dryRoundPrices && viewStops.length > 0 ? (
    <PlanDryRoundLedger
      prices={dryRoundPrices}
      stops={viewStops.map((stop) => ({ venueId: stop.venueId, venueName: stop.venueName }))}
    />
  ) : null;
  // THE STOPS COME FIRST. The fine print and the map strip used to sit between
  // the summary and the pubs, so on a phone the first stop started below the
  // fold. They now follow the stops, and the two caveats read as one line.
  const resultFinePrint = (
    <p className="planResult__provenance">
      {viewStops.some((stop) => typeof stop.estimatedPintPricePence === "number" && stop.estimatedPintPricePence > 0) && (
        <><span>
          {routeHasKnownPintServings(viewStops) ? "One pint per person at each stop. " : ""}
          Meal prices are not verified.
        </span>{" "}</>
      )}
      <PlanResultProvenance />
    </p>
  );

  return (
    <form id="plan-composer" className="planComposer" data-result={resultMode ? "true" : undefined} onSubmit={submit} noValidate>
      {tuneOpen ? null : draftSaveNotice}
      {handoff && (
        <AcceptedContextPanel
          handoff={handoff}
          acceptedVenueName={acceptedVenueName}
          onRelease={releaseAcceptance}
          releaseDisabled={submitting}
        />
      )}
      {planComposerShowsDescribeFirst({
        heldVenueId,
        completed: planIntake.completed,
        entryMode,
      }) ? (
        <PlanDescribeFirst
          ready={canPersist}
          initialQuery={askDraftQuery || recoveredIntent.conciergeQuery}
          initialStopCount={requestedStopCount}
          initialStopCountSource={planIntake.answers.stopCountSource}
          onStopCountChange={(count) => { pendingDraftSave.current = true; setPlanIntake((current) => applyPlanStopCount(current, null, count, "picker").draft); }}
          onSubmit={submitFromEntry}
          onQueryChange={(query) => { pendingDraftSave.current = true; setConciergeQuery(query); }}
          onPrefillQueryChange={adoptDescribePrefillQuery}
          onGuideMeInstead={openGuide}
        />
      ) : !(resultMode && planIntake.completed) && planComposerShowsIntake({
        heldVenueId,
        completed: planIntake.completed,
        entryMode,
      }) ? (
        <PlanIntake
          draft={planIntake}
          onChange={(draft) => {
            if (!draft.completed && !wizardChosen) {
              pendingDraftSave.current = true;
              setWizardChosen(true);
            }
            updatePlanIntake(draft);
          }}
        />
      ) : null}
      {composerVisible ? (
        <>
          {resultMode ? (
            <>
              <div className="planResult__route">
                {resultHeader}
                {stopsBlock}
                {budgetLedger}
                {dryRoundLedger}
                {resultFinePrint}
              </div>
              {resultStrip}
              {fieldsBlock}
              {coverageBlock}
              {tuneOpen ? null : (
                <p id="plan-concierge-status" className="planComposer__srOnly" role="status" aria-live="polite">{conciergeStatus}</p>
              )}
              <PlanTuneSheet open={tuneOpen} title="Tune details" onClose={() => setTuneOpen(false)}>
                {renderConcierge(true)}
                {templatesBlock}
              </PlanTuneSheet>
            </>
          ) : (
            <>
              {renderConcierge(false)}
              {templatesBlock}
              {coverageBlock}
              {fieldsBlock}
              {stopsBlock}
            </>
          )}
      {error ? <PlanComposerErrorNotice message={error} /> : null}
      {/* THE ANSWER IS PINNED. On a phone this action sat at the natural end of
          a page several screens long, which is under the tab bar and under the
          old floating create action: PlanAstra measured it 40% covered at 390.
          It is now a full-width bar above the reserved chrome, carrying the one
          line that qualifies it, so the two can never separate. */}
      {stops.length ? <div className="planComposer__lock" data-name-seat={nameInLockBar ? "true" : undefined}>
        {nameInLockBar ? nameField : null}
        <button
          className="planComposer__submit"
          type="submit"
          disabled={lockBusy}
          aria-disabled={!lockBusy && !canLockPlan ? true : undefined}
          aria-describedby={lockHint ? "plan-lock-hint" : undefined}
        >{submitting ? "Locking it in…" : "Lock it in"}</button>
        {lockHint ? <p id="plan-lock-hint" className="planComposer__lockHint">{lockHint}</p> : null}
        <p className="planComposer__trust">Anyone with the link can see the plan. Joining only asks for a name.</p>
      </div> : null}
        </>
      ) : null}
    </form>
  );
}

export default function PlanComposer() {
  const hydrated = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
  // A departure must discard both mounted inputs and recovery candidates.
  // Ignore stored inputs and URL prefills for the rest of this composer's lifetime.
  const accountGeneration = useLiveAccountGeneration();
  useLayoutEffect(() => {
    if (accountGeneration === 0) return;
    const url = new URL(window.location.href);
    for (const parameter of [PLAN_QUERY_PARAM, PLAN_DESCRIBE_PARAM, PLAN_OCCASION_PARAM]) {
      url.searchParams.delete(parameter);
    }
    window.history.replaceState(window.history.state, "", url);
  }, [accountGeneration]);
  // Account resets must read ownership again even when hydration is unchanged.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const records = useMemo(() => hydrated ? readComposerAcceptanceRecords() : null, [hydrated, accountGeneration]);
  const recovery = useMemo(() => {
    if (!records || accountGeneration > 0) return null;
    try {
      const v1 = records.session?.[PLAN_DRAFT_KEY];
      const v2 = records.session?.[PLAN_DRAFT_V2_KEY];
      const routeV1 = records.local?.[PLAN_ROUTE_DRAFT_KEY];
      const routeV2 = records.local?.[PLAN_ROUTE_DRAFT_V2_KEY];
      const routeRecovery = readComposerRouteDraft({
        v1: routeV1 ?? null, v2: routeV2 ?? null,
        pair: routeV1 !== undefined && routeV2 !== undefined ? { v1: routeV1, v2: routeV2 } : null,
      });
      const recovery = projectComposerRecovery({
        plan: v1 !== undefined && v2 !== undefined ? parsePlanDraftEnvelope(v2, v1) : null,
        legacyDraft: parsePlanDraft(v1 ?? null),
        legacyDraftMissing: v1 === null,
        intake: parsePlanIntakeDraftWithMetadata(records.local?.[PLAN_INTAKE_STORAGE_KEY] ?? null),
        planningIntent: parsePlanningIntent(records.session?.[PLANNING_INTENT_STORAGE_KEY] ?? ""),
      }, routeRecovery);
      return {
        ...recovery,
        previewToCopy: recoveredPreviewForStorage(recovery, routeRecovery),
      };
    } catch { return null; }
  }, [records, accountGeneration]);
  const acceptedOwner = useMemo(() => records
    ? { ...records, identity: recovery?.handoff?.acceptedAnchor ?? null } : null, [records, recovery]);
  const recoveredDraft = recovery?.recoveredDraft ?? null;
  const recoveredRouteDraft = recovery?.route.route ?? null;
  const handoff = recovery?.handoff ?? null;
  const recoveredIntake = useMemo(() => selectRecoveredComposerIntake(recovery), [recovery]);
  // The form is MOUNTED AGAIN once hydrated when there is something to recover,
  // so its state initialisers read the recovered drafts and the URL's ask.
  // Whatever the server-painted form held is thrown away with it, so that form
  // takes no input (`canPersist` reaches the describe-first field as `ready`).
  // On a slow load the browser suite typed a query into it, lost it at the
  // remount, and tapped Sort it on an empty field (5 Oct 2026).
  //
  // With nothing to recover the remount would rebuild the same form the server
  // painted, and a fresh paint of every node in it is scored by the browser as
  // a new largest paint: /plan's LCP was the server's own culture line,
  // repainted at the remount, 2.2 to 2.5 s on a throttled phone against a
  // first paint of 0.6 s. So the server form is kept and simply goes live: its
  // state is already what a remount would compute, and every effect that waits
  // on `canPersist` lists it, so each runs the moment it flips.
  const remount = useMemo(() => {
    if (!hydrated) return false;
    const fromUrl = describeAskFromLocation();
    return Boolean(
      handoff ||
        recoveredDraft ||
        recoveredRouteDraft ||
        recoveredIntake.hasDurableDraft ||
        fromUrl.ask ||
        fromUrl.handoffAsk,
    );
  }, [hydrated, handoff, recoveredDraft, recoveredRouteDraft, recoveredIntake]);
  return (
    <PlanComposerForm
      key={`${remount ? "hydrated" : "server"}:${accountGeneration}`}
      recoveredDraft={recoveredDraft}
      recoveredRouteDraft={recoveredRouteDraft}
      recoveredIntake={recoveredIntake.draft}
      recoveredPreviewToCopy={recovery?.previewToCopy ?? null}
      recoveredPreviewReference={recovery?.retainedPreviewReference ?? null}
      recoveredIntent={recoveredIntake.intent}
      hasDurableIntakeDraft={recoveredIntake.hasDurableDraft}
      requestAmbiguous={recovery?.requestAmbiguous ?? false}
      preserveStoredDrafts={recovery?.preserveStoredDrafts ?? false}
      provisionalRequest={recovery?.provisionalRequest ?? false}
      acceptedOwner={acceptedOwner}
      handoff={handoff}
      canPersist={hydrated}
      allowUrlPrefill={accountGeneration === 0}
    />
  );
}

/**
 * The report line rides to the card only when the locked stops are the ones
 * the planner reported on; an edited route has no report.
 */
function rememberLockedReportLine(
  planId: string,
  generated: { line: string; venueIds: string } | null,
  lockedStops: readonly { venueId: string }[],
): void {
  const sameRoute = generated !== null && generated.venueIds === lockedStops.map((stop) => stop.venueId).join(",");
  rememberPlanReportLine(planId, sameRoute ? generated.line : null);
}
