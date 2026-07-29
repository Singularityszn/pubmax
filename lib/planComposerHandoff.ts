import {
  arbitratePlanDrafts,
  type DraftArbitrationConflict,
  type DraftArbitrationProvenance,
  type DraftArbitrationUrl,
} from "@/lib/planDraftArbitration";
import type { ParsedPlanDraft } from "@/lib/planDraft";
import type { ParsedPlanIntakeDraft } from "@/lib/planIntake";
import type { ParsedPlanRouteDraft } from "@/lib/planRouteDraft";
import type { PlanningIntentArea, PlanningIntentV1 } from "@/lib/planningIntent";
import type { PlanTemplate } from "@/lib/planTemplates";
import type { RememberedArea } from "@/lib/nightPatches";
import type { TrustedHandoffFlagsDTO } from "@/lib/trustedHandoffFlags";

/**
 * L11 client glue between the L04 arbitration resolver and PlanComposer. It runs
 * arbitration BEFORE any product default is written, decides what accepted
 * context to show (so the composer never re-asks an already-answered area or
 * date), and keeps templates from silently overriding accepted geography. Every
 * function here is pure so the composer can compute hydration deterministically
 * across StrictMode double-invocation and duplicate tabs.
 */

export type ComposerHandoffFlags = Pick<TrustedHandoffFlagsDTO, "intentRead" | "anchoredGeneration">;

export type ComposerHydration = {
  /** True when a trusted-handoff flag engages the new path; off = generic Plan. */
  active: boolean;
  /** Arbitration finished; the composer may now run its default-write effects. */
  defaultsMayWrite: boolean;
  title: string | null;
  creatorName: string | null;
  startsAt: string | null;
  acceptedVenueId: string | null;
  area: PlanningIntentArea;
  /** Show the accepted Venue/area/date summary before intake. */
  showAcceptedSummary: boolean;
  /** Area is already answered by acceptance/intake — do not re-ask it. */
  answeredArea: boolean;
  /** Date is already answered by acceptance/intake — do not re-ask it. */
  answeredDate: boolean;
  conflicts: DraftArbitrationConflict[];
  routePreview: ParsedPlanRouteDraft | null;
  routeProofPresent: boolean;
};

function isAcceptanceSource(source: DraftArbitrationProvenance): boolean {
  return source === "planning-intent"
    || source === "route-v2"
    || source === "route-legacy"
    || source === "explicit-url";
}

/** A field counts as "already answered" only when a real source, not a default, filled it. */
function isAnswered(source: DraftArbitrationProvenance): boolean {
  return source !== "default" && source !== "none";
}

export type ResolveComposerHydrationInput = {
  planDraft: ParsedPlanDraft | null;
  routeDraft: ParsedPlanRouteDraft | null;
  intakeDraft: ParsedPlanIntakeDraft | null;
  planningIntent: PlanningIntentV1 | null;
  rememberedArea: RememberedArea | null;
  flags: ComposerHandoffFlags;
  url?: Partial<DraftArbitrationUrl> | null;
  lastAppliedOperationKey?: string | null;
};

export function resolveComposerHydration(input: ResolveComposerHydrationInput): ComposerHydration {
  const anchored = input.flags.anchoredGeneration;
  const result = arbitratePlanDrafts({
    url: input.url ?? null,
    planDraft: input.planDraft,
    routeDraft: input.routeDraft,
    intakeDraft: input.intakeDraft,
    planningIntent: input.planningIntent,
    // PlanningIntent participates only when intent read is enabled.
    intentReadEnabled: input.flags.intentRead,
    rememberedArea: input.rememberedArea,
    lastAppliedOperationKey: input.lastAppliedOperationKey,
  });

  const acceptedVenueId = result.acceptedVenueId.value;
  return {
    active: input.flags.intentRead || anchored,
    defaultsMayWrite: result.hydration.defaultsMayWrite,
    title: result.title.source === "none" ? null : result.title.value,
    creatorName: result.creatorName.source === "none" ? null : result.creatorName.value,
    startsAt: result.startsAt.value,
    acceptedVenueId,
    area: result.area.value,
    // Anchor UI only surfaces under anchored generation, and only for a real acceptance.
    showAcceptedSummary: anchored && Boolean(acceptedVenueId) && isAcceptanceSource(result.acceptedVenueId.source),
    answeredArea: anchored && isAnswered(result.area.source),
    answeredDate: anchored && isAnswered(result.startsAt.source),
    conflicts: result.conflicts,
    routePreview: result.routePreview,
    routeProofPresent: result.routeProofPresent,
  };
}

/**
 * Locking maps the L09 server outcomes to honest recovery copy. 422 means the
 * V2 grounding proof was missing, tampered, route-mismatched, or expired; 409
 * means the same operation key was replayed with a changed payload.
 */
export function composerLockErrorFromResponse(status: number): string | null {
  if (status === 422) {
    return "Your route needs a refresh before you can lock it in. Rebuild the route and try again.";
  }
  if (status === 409) {
    return "This plan was already locked in from another tab. Reload it to keep going.";
  }
  return null;
}

export type AppliedTemplate = {
  title: string;
  conciergeQuery: string;
  /** When true the composer must not re-infer area from the seed query. */
  geographyLocked: boolean;
};

/**
 * Templates add mood/occasion context (title + concierge seed) but never
 * override accepted geography: when an area is already accepted, the composer
 * keeps it and does not re-derive one from the template's seed query text.
 */
export function applyTemplate(template: PlanTemplate, hasAcceptedGeography: boolean): AppliedTemplate {
  return {
    title: template.title,
    conciergeQuery: template.conciergeQuery,
    geographyLocked: hasAcceptedGeography,
  };
}

/** London service-time label for the accepted start, or null when unset/invalid. */
export function londonServiceDateLabel(startIso: string | null): string | null {
  if (!startIso) return null;
  const ms = Date.parse(startIso);
  if (!Number.isFinite(ms)) return null;
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(ms));
}
