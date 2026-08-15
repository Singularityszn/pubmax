import {
  arbitratePlanDrafts,
  type DraftArbitrationConflict,
  type DraftArbitrationProvenance,
  type DraftArbitrationUrl,
} from "@/lib/planDraftArbitration";
import type { ParsedPlanDraft } from "@/lib/planDraft";
import type { ParsedPlanIntakeDraft } from "@/lib/planIntake";
import type { ParsedPlanRouteDraft } from "@/lib/planRouteDraft";
import type {
  PlanningIntentArea,
  PlanningIntentSource,
  PlanningIntentV1,
} from "@/lib/planningIntent";
import type { CityId } from "@/lib/cities";
import type { PlanTemplate } from "@/lib/planTemplates";
import type { RememberedArea } from "@/lib/nightPatches";

/**
 * L11 client glue between the L04 arbitration resolver and PlanComposer. It runs
 * arbitration BEFORE any product default is written, decides what accepted
 * context to show (so the composer never re-asks an already-answered area or
 * date), and keeps templates from silently overriding accepted geography. Every
 * function here is pure so the composer can compute hydration deterministically
 * across StrictMode double-invocation and duplicate tabs.
 */

export type ComposerHydration = {
  /** True when persisted Plan context participates in this hydration. */
  active: boolean;
  /** Arbitration finished; the composer may now run its default-write effects. */
  defaultsMayWrite: boolean;
  title: string | null;
  creatorName: string | null;
  startsAt: string | null;
  acceptedVenueId: string | null;
  /** Acceptance source when the accepted Venue came from a trusted handoff. */
  acceptedSource: PlanningIntentSource | null;
  /** Exact accepted anchor for generation, when its source is known. */
  acceptedAnchor: {
    venueId: string;
    source: PlanningIntentSource;
    cityId: CityId | null;
    acceptedArea: PlanningIntentArea;
    startsAt: string | null;
    expiresAt: string | null;
  } | null;
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
  url?: Partial<DraftArbitrationUrl> | null;
  lastAppliedOperationKey?: string | null;
};

export function resolveComposerHydration(input: ResolveComposerHydrationInput): ComposerHydration {
  const result = arbitratePlanDrafts({
    url: input.url ?? null,
    planDraft: input.planDraft,
    routeDraft: input.routeDraft,
    intakeDraft: input.intakeDraft,
    planningIntent: input.planningIntent,
    // PlanningIntent is a permanent handoff path.
    intentReadEnabled: true,
    rememberedArea: input.rememberedArea,
    lastAppliedOperationKey: input.lastAppliedOperationKey,
  });

  const acceptedVenueId = result.acceptedVenueId.value;
  const draftAnchor = input.planDraft?.draft.acceptedAnchor?.venueId === acceptedVenueId
    ? input.planDraft.draft.acceptedAnchor
    : null;
  const acceptedSource = draftAnchor?.source ?? (result.acceptedVenueId.source === "planning-intent"
    ? input.planningIntent?.source ?? null
    : result.acceptedVenueId.source === "route-v2" || result.acceptedVenueId.source === "route-legacy"
      ? result.routePreview?.value.anchorSource ?? null
      : null);
  const acceptedAnchor = acceptedVenueId && acceptedSource
    ? draftAnchor ?? {
        venueId: acceptedVenueId,
        source: acceptedSource,
        cityId: result.acceptedVenueId.source === "planning-intent" && input.planningIntent
          ? input.planningIntent.cityId
          : null,
        acceptedArea: result.acceptedVenueId.source === "planning-intent" && input.planningIntent
          ? input.planningIntent.acceptedArea
          : result.area.value,
        startsAt: result.acceptedVenueId.source === "planning-intent" && input.planningIntent
          ? input.planningIntent.startsAt
          : result.startsAt.value,
        expiresAt: result.acceptedVenueId.source === "planning-intent" && input.planningIntent
          ? input.planningIntent.expiresAt
          : null,
      }
    : null;
  const active = Boolean(
    input.planDraft
    || input.routeDraft
    || input.intakeDraft
    || input.planningIntent
    || acceptedVenueId,
  );
  return {
    active,
    defaultsMayWrite: result.hydration.defaultsMayWrite,
    title: result.title.source === "none" ? null : result.title.value,
    creatorName: result.creatorName.source === "none" ? null : result.creatorName.value,
    startsAt: result.startsAt.value,
    acceptedVenueId,
    acceptedSource,
    acceptedAnchor,
    area: result.area.value,
    // Accepted context is always visible for a real acceptance.
    showAcceptedSummary: Boolean(acceptedVenueId) && (Boolean(draftAnchor) || isAcceptanceSource(result.acceptedVenueId.source)),
    answeredArea: isAnswered(result.area.source),
    answeredDate: isAnswered(result.startsAt.source),
    conflicts: result.conflicts,
    routePreview: result.routePreview,
    routeProofPresent: result.routeProofPresent,
  };
}

export type ProvisionalStopSeed = {
  key: 1;
  venueId: string;
  venueName: string;
  alternatives: [];
};

type SeedStop = {
  venueId?: string | null;
  venueName?: string | null;
};

type SeedVenue = {
  id: string;
  name: string;
};

/**
 * What a surface calls the accepted Venue before the slim index has answered.
 * A raw id is never a name: `venue-uk-osm-123456` is what we call a row, and a
 * pin promoted out of the UK base layer is absent from the slim index for good,
 * so the id would have stood in that field permanently. Empty is the honest
 * value - the Stop input is the person's own to fill, and the resolve below
 * writes the real name the moment the index lands.
 */
export const UNRESOLVED_ACCEPTED_VENUE_NAME = "";

/** The neutral label a read-only summary prints while the name is unresolved. */
export const UNRESOLVED_ACCEPTED_VENUE_LABEL = "The pub you kept";

/**
 * Seed the accepted Venue as one editable Stop 1 only when no saved Route or
 * Plan stops exist. The Venue id remains the accepted id; the display name is
 * resolved from the loaded Venue index when available, and stays empty rather
 * than falling back to the id when it is not.
 */
export function seedProvisionalStop1(input: {
  acceptedVenueId: string | null | undefined;
  venues?: ReadonlyArray<SeedVenue> | null;
  recoveredRouteStops?: ReadonlyArray<SeedStop> | null;
  recoveredPlanStops?: ReadonlyArray<SeedStop> | null;
}): ProvisionalStopSeed | null {
  const venueId = typeof input.acceptedVenueId === "string"
    ? input.acceptedVenueId.trim()
    : "";
  if (!venueId) return null;
  if ((input.recoveredRouteStops?.length ?? 0) > 0 || (input.recoveredPlanStops?.length ?? 0) > 0) {
    return null;
  }
  const indexed = input.venues?.find((venue) => venue.id.trim() === venueId);
  const venueName = indexed?.name.trim() || UNRESOLVED_ACCEPTED_VENUE_NAME;
  return {
    key: 1,
    venueId,
    venueName,
    alternatives: [],
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
