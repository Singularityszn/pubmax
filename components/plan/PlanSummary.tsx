"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { PlanState } from "@/lib/plan";
import PlanRoute from "@/components/plan/PlanRoute";
import PlanCollaborationPanel from "@/components/plan/PlanCollaborationPanel";
import InvitePrivacyPreview from "@/components/plan/InvitePrivacyPreview";
import RoundStarter from "@/components/round/RoundStarter";
import { planViewModel } from "@/components/plan/planPresentation";
import { anchorConflictMessage, routeStopsFromGenerated } from "@/components/plan/PlanComposer";
import { parsePlanCapabilitySnapshot, planCapabilityEvent, readPlanCapabilitySnapshot, restorePlanCapability } from "@/lib/planSessionCapability";
import { readPlanMemberProjection, usePlanMemberRead } from "@/components/plan/usePlanMemberRead";
import { setActivePlanRole } from "@/lib/activePlan";
import { isPlanPreviewProjection, type PlanPrivacyPreviewDTO } from "@/lib/planPrivacy";
import { planUsesPintPrices } from "@/lib/planGenerationDto";
import { cleanSelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";

import type { InvitePrivacyPreviewDTO } from "@/lib/invitePrivacyPreview";
import type { VibeTally } from "@/lib/vibeTally";
import {
  isPlanStopCount,
  normalizePlanStopCount,
  PLAN_STOP_COUNT_RANGE_SENTENCE,
} from "@/lib/planStopCount";
import { useAuth } from "@/components/auth/AuthProvider";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { tryGetNightArea } from "@/lib/nightAreas";
import { discardBody } from "@/lib/responseBody";
import {
  livePendingRoute,
  orderedRouteStops,
  ROUTE_CONFLICT_RESEEDED_LINE,
  ROUTE_CONFLICT_UNREAD_LINE,
  ROUTE_SAVED_LINE,
  routeRevisionsMatch,
  routeSaveOutcome,
  seedRouteDraft,
} from "@/lib/planRouteEditor";
import type { EditableStop, PendingRoute, RouteAlternative, RouteEditorNotice, RouteRevision } from "@/lib/planRouteEditor";

/** Map the §4.10 preview onto the existing preview component's DTO. */
function toInvitePreview(preview: PlanPrivacyPreviewDTO): InvitePrivacyPreviewDTO {
  return {
    hostName: preview.hostDisplayName,
    areaName: preview.areaName,
    startLabel: preview.startLabel,
    stopCount: preview.stopCount,
    vibeLabel: preview.vibeLabel,
    accessibilitySummary: preview.accessibilitySummary,
  };
}

type PendingRouteV1 = PendingRoute & { version: 1; savedAt: string };

export const PLAN_PENDING_ROUTE_PREFIX = "pubmaxx:plan-pending-route:v1:";

function pendingRouteKey(planId: string): string {
  return `${PLAN_PENDING_ROUTE_PREFIX}${planId}`;
}

function cleanRevision(value: unknown): RouteRevision | null {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  return null;
}

function routeRevisionFromPlanState(value: unknown): RouteRevision | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { routeRevision?: unknown; revision?: unknown; plan?: unknown };
  const direct = cleanRevision(row.routeRevision ?? row.revision);
  if (direct !== null) return direct;
  if (row.plan && typeof row.plan === "object") {
    const plan = row.plan as { routeRevision?: unknown; revision?: unknown };
    return cleanRevision(plan.routeRevision ?? plan.revision);
  }
  return null;
}

function cleanAlternative(value: unknown): RouteAlternative | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { venueId?: unknown; venueName?: unknown; name?: unknown; selectedDrinkPriceEvidence?: unknown };
  const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
  const venueName = typeof row.venueName === "string"
    ? row.venueName.trim()
    : typeof row.name === "string" ? row.name.trim() : "";
  const evidence = cleanSelectedDrinkPriceEvidence(row.selectedDrinkPriceEvidence);
  return venueId && venueName ? { venueId, venueName, ...(evidence ? { selectedDrinkPriceEvidence: evidence } : {}) } : null;
}

function cleanStops(value: unknown): EditableStop[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((candidate, index) => {
    if (!candidate || typeof candidate !== "object") return [];
    const row = candidate as {
      venueId?: unknown;
      venueName?: unknown;
      position?: unknown;
      alternatives?: unknown;
      selectedDrinkPriceEvidence?: unknown;
    };
    const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
    const venueName = typeof row.venueName === "string" ? row.venueName.trim() : "";
    if (!venueId || !venueName) return [];
    const alternatives = Array.isArray(row.alternatives)
      ? row.alternatives.flatMap((alternative) => {
        const cleaned = cleanAlternative(alternative);
        return cleaned ? [cleaned] : [];
      })
      : [];
    const selectedDrinkPriceEvidence = cleanSelectedDrinkPriceEvidence(row.selectedDrinkPriceEvidence);
    return [{
      venueId,
      venueName,
      position: typeof row.position === "number" ? row.position : index,
      ...(selectedDrinkPriceEvidence ? { selectedDrinkPriceEvidence } : {}),
      alternatives,
    }];
  });
}

export function parsePendingRoute(raw: string | null): PendingRoute | null {
  if (!raw || raw.length > 20_000) return null;
  try {
    const value = JSON.parse(raw) as Partial<PendingRouteV1>;
    if (value.version !== undefined && value.version !== 1) return null;
    const stops = cleanStops(value.stops);
    if (!stops.length) return null;
    return {
      stops,
      expectedRouteRevision: cleanRevision(value.expectedRouteRevision),
      groundingProof: typeof value.groundingProof === "string" && value.groundingProof.length <= 8_000
        ? value.groundingProof
        : null,
      operationKey: typeof value.operationKey === "string" && value.operationKey.trim().length >= 8 && value.operationKey.trim().length <= 120
        ? value.operationKey.trim()
        : null,
    };
  } catch {
    return null;
  }
}

function readPendingRoute(planId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem(pendingRouteKey(planId));
  } catch {
    return null;
  }
}

function announcePendingRouteChange(planId: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(`pubmax:pending-route:${planId}`));
}

function writePendingRoute(planId: string, pending: PendingRoute): void {
  try {
    localStorage.setItem(pendingRouteKey(planId), JSON.stringify({ ...pending, version: 1, savedAt: new Date().toISOString() } satisfies PendingRouteV1));
    announcePendingRouteChange(planId);
  } catch {
    // The editor remains usable in a storage-restricted browser.
  }
}

function clearPendingRoute(planId: string): void {
  try {
    localStorage.removeItem(pendingRouteKey(planId));
    announcePendingRouteChange(planId);
  } catch {
    // Best effort only; a failed clear cannot publish a route.
  }
}

export function routeHasChanged(before: ReadonlyArray<{ venueId: string }>, after: ReadonlyArray<{ venueId: string }>): boolean {
  return before.length !== after.length || before.some((stop, index) => stop.venueId !== after[index]?.venueId);
}

export function canBeginPlanRouteEdit(input: {
  hasMemberToken: boolean;
  collaborationAuthorized: boolean;
  isHost: boolean;
  anchoredPlan: boolean;
}): boolean {
  return input.hasMemberToken
    && input.collaborationAuthorized
    && (input.isHost || !input.anchoredPlan);
}

function validRouteDraft(stops: ReadonlyArray<EditableStop>): boolean {
  return isPlanStopCount(stops.length)
    && stops.every((stop) => stop.venueId.trim() && stop.venueName.trim())
    && new Set(stops.map((stop) => stop.venueId)).size === stops.length;
}

/**
 * Why a refreshed-route answer cannot be used, or null when it can be. An
 * anchored refresh can answer HTTP 200 with no Stops and an anchor-conflict
 * outcome, and only the server's own sentence names which check refused the
 * kept pub, so it is read before the empty-route sentence.
 */
export function refreshedRouteRejection(
  body: unknown,
  generated: ReadonlyArray<EditableStop>,
  requestedStopCount: number,
): string | null {
  const anchorConflict = anchorConflictMessage(body);
  if (anchorConflict) return anchorConflict;
  if (!validRouteDraft(generated)) {
    return `Couldn't get ${requestedStopCount} good stops that time. Give it another go.`;
  }
  return null;
}

type RouteGenerationAuthority = {
  groundingProof: string;
  operationKey: string;
};

function routeGenerationAuthority(value: unknown): RouteGenerationAuthority | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { groundingProof?: unknown; operationKey?: unknown };
  const groundingProof = typeof row.groundingProof === "string" && row.groundingProof.length <= 8_000
    ? row.groundingProof
    : "";
  const operationKey = typeof row.operationKey === "string" ? row.operationKey.trim() : "";
  return groundingProof && operationKey.length >= 8 && operationKey.length <= 120
    ? { groundingProof, operationKey }
    : null;
}

export function planSummaryGenerationBody(state: PlanState): Record<string, unknown> {
  const anchor = state.plan.anchorVenueId && state.plan.anchorSource
    ? {
        venueId: state.plan.anchorVenueId,
        source: state.plan.anchorSource,
        acceptedArea: null,
        startsAt: state.plan.startTime,
      }
    : null;
  const cityId = state.context?.nightArea
    ? tryGetNightArea(state.context.nightArea)?.cityId ?? null
    : null;
  return {
    context: state.context,
    ...(cityId ? { cityId } : {}),
    ...(anchor ? { anchor } : {}),
  };
}

export function planSummaryRouteUpdateBody(input: {
  stops: ReadonlyArray<EditableStop>;
  expectedRouteRevision: RouteRevision;
  authority: RouteGenerationAuthority | null;
}): Record<string, unknown> {
  return {
    stops: input.stops.map(({ venueId, venueName, selectedDrinkPriceEvidence }) => ({
      venueId, venueName,
      ...(selectedDrinkPriceEvidence ? { selectedDrinkPriceEvidence } : {}),
    })),
    expectedRouteRevision: input.expectedRouteRevision,
    ...(input.authority ?? {}),
  };
}

function stopWithNextAlternative(stop: EditableStop, excludedVenueIds: ReadonlySet<string>): EditableStop {
  const alternatives = stop.alternatives ?? [];
  const nextIndex = alternatives.findIndex((alternative) => !excludedVenueIds.has(alternative.venueId));
  if (nextIndex < 0) return stop;
  const next = alternatives[nextIndex];
  const remaining = alternatives.filter((_, index) => index !== nextIndex);
  if (!next) return stop;
  return {
    ...stop,
    venueId: next.venueId,
    venueName: next.venueName,
    selectedDrinkPriceEvidence: next.selectedDrinkPriceEvidence,
    alternatives: [
      ...remaining,
      { venueId: stop.venueId, venueName: stop.venueName, ...(stop.selectedDrinkPriceEvidence
        ? { selectedDrinkPriceEvidence: stop.selectedDrinkPriceEvidence } : {}) },
    ],
  };
}

function canonicalStateFromBody(value: unknown): PlanState | null {
  if (!value || typeof value !== "object") return null;
  const row = value as { stops?: unknown; plan?: unknown; state?: unknown };
  if (Array.isArray(row.stops) && row.plan && typeof row.plan === "object") return value as PlanState;
  if (row.plan && typeof row.plan === "object") {
    const plan = row.plan as { stops?: unknown };
    if (Array.isArray(plan.stops)) return row.plan as PlanState;
  }
  if (row.state && typeof row.state === "object") {
    const state = row.state as { stops?: unknown };
    if (Array.isArray(state.stops)) return row.state as PlanState;
  }
  return null;
}

/**
 * §4.10 boundary: the server never embeds the route in this component's props.
 * The page passes only the privacy-safe preview; a member's full state is
 * fetched from the capability-gated /api/plans/[id] (which returns the raw
 * PlanState only for a valid host/guest, else the preview).
 * Until — or unless — that member state arrives, only the redacted preview renders.
 *
 * The read follows the capability rather than the mount (battle test M01, M02);
 * usePlanMemberRead owns that rule. A read that comes back as the PREVIEW is an
 * answer rather than a failure, so it also takes the route back down when a
 * capability is revoked.
 */
export default function PlanSummary({
  planId,
  initialPreview,
}: {
  planId: string;
  initialPreview: PlanPrivacyPreviewDTO;
  vibeTally?: VibeTally | null;
}) {
  const [state, setState] = useState<PlanState | null>(null);
  const { identityResolved } = useAuth();
  // The session lane, gated the way PlanCrew gates its own: asking before
  // identity has resolved cannot spend the recovery write, so it would be a
  // question that could never come back a member.
  const sessionAsked = useRef(false);
  useEffect(() => {
    if (!identityResolved || sessionAsked.current) return;
    sessionAsked.current = true;
    void restorePlanCapability(planId).catch(() => undefined);
  }, [identityResolved, planId]);
  const readPlan = useCallback((isActive: () => boolean) => {
    // One request per Plan, shared with every other surface asking (F-34).
    void readPlanMemberProjection(planId).then((body) => {
      if (!isActive()) return;
      const canonical = canonicalStateFromBody(body);
      if (canonical) setState(canonical);
      else if (isPlanPreviewProjection(body)) setState(null);
    });
  }, [planId]);
  usePlanMemberRead(planId, readPlan);

  // No rail on the teaser: the rail is the ROUTE's spine, and a preview has no
  // route to hang on it. At 390 it landed at x 66 while the preview copy starts
  // at x 43, so it struck through the host's name and the join control.
  if (!state) {
    return (
      <section className="planSummary" aria-labelledby="plan-stops-title">
        <div className="planSummary__heading planSummary__heading--teaser">
          <p className="planPage__eyebrow">Start time · {initialPreview.startLabel}</p>
          <h2 id="plan-stops-title">The route</h2>
        </div>
        <InvitePrivacyPreview preview={toInvitePreview(initialPreview)} />
      </section>
    );
  }

  return <PlanSummaryMember planId={planId} state={state} />;
}

function PlanSummaryMember({ planId, state }: { planId: string; state: PlanState }) {
  const view = planViewModel(state);
  const tokenEvent = planCapabilityEvent(planId);
  const pendingEvent = `pubmax:pending-route:${planId}`;
  const capabilitySnapshot = useSyncExternalStore(
    (onChange) => {
      window.addEventListener(tokenEvent, onChange);
      return () => {
        window.removeEventListener(tokenEvent, onChange);
      };
    },
    () => readPlanCapabilitySnapshot(planId),
    () => "|0|",
  );
  const { token: memberToken, collaborationAuthorized, role } = parsePlanCapabilitySnapshot(capabilitySnapshot);
  const pendingRaw = useSyncExternalStore(
    (onChange) => {
      window.addEventListener("storage", onChange);
      window.addEventListener(pendingEvent, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(pendingEvent, onChange);
      };
    },
    () => readPendingRoute(planId),
    () => null,
  );
  const [savedRevision, setSavedRevision] = useState<RouteRevision | null>(routeRevisionFromPlanState(state));
  const storedPending = useMemo(() => parsePendingRoute(pendingRaw), [pendingRaw]);
  // A draft older than the stored route is never shown: the server would
  // refuse it with 409, and a route on screen that cannot be saved reads as
  // the route that will be (D02). It is cleared below, once, when found.
  const pending = livePendingRoute(storedPending, savedRevision);
  useEffect(() => {
    if (pendingRaw !== null && !pending) clearPendingRoute(planId);
  }, [pendingRaw, pending, planId]);
  const initialStops = orderedRouteStops(cleanStops(view.stops));
  const [canonicalStops, setCanonicalStops] = useState<EditableStop[]>(initialStops);
  const [localStops, setLocalStops] = useState<EditableStop[]>(initialStops);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  // The rendered `saving` flag lags the click that set it, and a second tap
  // inside that lag used to send a second PATCH (M03). The ref is claimed
  // synchronously before anything is awaited and released in `finally`.
  const saveInFlight = useRef(false);
  // The same rule on the other handler (F-32): `loadingPreview` is rendered
  // state, so it lags the click that set it, and two taps in one task both
  // POSTed /api/plans/generate - on an anchored plan both then reached
  // `writePendingRoute`. The ref is claimed before anything is awaited.
  const previewInFlight = useRef(false);
  // A save or a stale-save unmounts the focused Save control, which drops
  // focus on the document. Focus returns to the control that reopens the
  // editor, so a keyboard or screen-reader host keeps their place.
  const editControl = useRef<HTMLButtonElement | null>(null);
  const closeEditor = () => {
    setEditing(false);
    editControl.current?.focus({ preventScroll: true });
  };
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [localAuthority, setLocalAuthority] = useState<RouteGenerationAuthority | null>(null);
  // Exactly one line under the editor at a time: a status when something
  // landed, an error when it did not.
  const [notice, setNotice] = useState<RouteEditorNotice>(null);

  // F-30: a member read that lands AFTER the mount is the read #1521 was
  // written to add, and its route was dropped on the floor, because the stops
  // are seeded from props once. A route another device saved then never reached
  // the screen, and the editor PATCHed with a stale `expectedRouteRevision`.
  //
  // A revision is not ORDERABLE (`RouteRevision` is a string or a number), so
  // "fresher" is not a comparison: what is tracked is the revision of the last
  // `state` prop this component adopted from. A read carrying a revision it has
  // not adopted from is adopted; a save that moved `savedRevision` past the
  // prop can never be reverted by it, because the prop did not change.
  //
  // It adjusts state DURING RENDER rather than in an effect, which is React's
  // own answer for state derived from a prop: an effect here would be a
  // cascading render, and the rules in this repo refuse one. Nothing outside
  // React is touched - the stale draft is cleared by the effect above, which
  // already re-reads `livePendingRoute` against the revision this moves.
  //
  // The editor is the reader's own working copy, so an open editor is left
  // alone.
  const incomingRevision = routeRevisionFromPlanState(state);
  const [adoptedFromRevision, setAdoptedFromRevision] = useState<RouteRevision | null>(incomingRevision);
  if (
    !editing
    && incomingRevision !== null
    && !routeRevisionsMatch(incomingRevision, adoptedFromRevision)
  ) {
    setAdoptedFromRevision(incomingRevision);
    if (!routeRevisionsMatch(incomingRevision, savedRevision)) {
      setSavedRevision(incomingRevision);
      setCanonicalStops(initialStops);
      setLocalStops(initialStops);
      setLocalAuthority(null);
    }
  }

  const announce = (text: string) => setNotice({ tone: "status", text });
  const refuse = (text: string) => setNotice({ tone: "error", text });
  const draftStops = pending?.stops ?? localStops;
  const pendingAuthority = pending?.groundingProof && pending.operationKey
    ? { groundingProof: pending.groundingProof, operationKey: pending.operationKey }
    : null;
  const routeAuthority = pendingAuthority ?? localAuthority;
  const anchoredPlan = Boolean(state.plan.anchorVenueId && state.plan.anchorSource);
  const isHost = Boolean(memberToken && role === "host");
  const canCollaborate = Boolean(memberToken && collaborationAuthorized);
  const canBeginEditing = canBeginPlanRouteEdit({
    hasMemberToken: Boolean(memberToken),
    collaborationAuthorized: canCollaborate,
    isHost,
    anchoredPlan,
  });
  useEffect(() => {
    if (memberToken && role) setActivePlanRole(planId, role);
  }, [memberToken, planId, role]);
  const routeRevision = savedRevision;
  const canonicalVenueIds = canonicalStops.map((stop) => ({ venueId: stop.venueId }));
  const hasRouteChanged = routeHasChanged(canonicalVenueIds, draftStops);
  const canSaveDraft = validRouteDraft(draftStops)
    && hasRouteChanged
    && routeRevision !== null
    && (!anchoredPlan || routeAuthority !== null);
  const canonicalRouteStops = canonicalStops.map((stop, index) => ({
    venueId: stop.venueId,
    venueName: stop.venueName,
    position: typeof stop.position === "number" ? stop.position : index,
    ...(stop.selectedDrinkPriceEvidence ? { selectedDrinkPriceEvidence: stop.selectedDrinkPriceEvidence } : {}),
  }));

  function adoptCanonical(canonical: PlanState): void {
    const savedStops = orderedRouteStops(cleanStops(canonical.stops));
    setSavedRevision(routeRevisionFromPlanState(canonical) ?? routeRevision);
    setCanonicalStops(savedStops);
    setLocalStops(savedStops);
    setLocalAuthority(null);
    clearPendingRoute(planId);
  }

  async function beginEditing() {
    if (previewInFlight.current) return;
    if (!memberToken) {
      refuse("Join the crew before proposing a route change.");
      return;
    }
    setEditing(true);
    setNotice(null);
    if (pending && (!anchoredPlan || pendingAuthority)) {
      announce(`Recovered unsaved route changes. Nothing changes until ${isHost ? "you save" : "the host accepts a proposal"}.`);
      return;
    }
    if (pending) clearPendingRoute(planId);
    if (!state.context) {
      setEditing(false);
      refuse("This plan doesn't have enough saved to sort a fresh route. Add the details, then try again.");
      return;
    }
    previewInFlight.current = true;
    setLoadingPreview(true);
    const requestedStopCount = normalizePlanStopCount(state.context.stopCount);
    announce(anchoredPlan
      ? `Sorting a fresh ${requestedStopCount}-stop route, with a backup for each stop…`
      : "Finding a backup for each stop…");
    try {
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(planSummaryGenerationBody(state)),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(errorMessageFrom(body, "Could not find a replacement route."));
      const generated = routeStopsFromGenerated(body.stops, body.alternatives).map((stop, index) => ({
        venueId: stop.venueId,
        venueName: stop.venueName,
        position: index,
        selectedDrinkPriceEvidence: stop.selectedDrinkPriceEvidence,
        alternatives: stop.alternatives,
      }));
      const rejection = refreshedRouteRejection(body, generated, requestedStopCount);
      if (rejection) throw new Error(rejection);
      if (!anchoredPlan) {
        // The STORED route is the draft, in its stored order; the fresh
        // generation only supplies the swap candidates (D02).
        setLocalStops(seedRouteDraft(canonicalStops, generated));
        setLocalAuthority(null);
        announce(`Your saved route, with a backup for each stop. Swap one, then ${isHost ? "save it" : "send it to the host"}.`);
        return;
      }
      if (state.plan.anchorVenueId && generated[0]?.venueId !== state.plan.anchorVenueId) {
        throw new Error("The refreshed route did not keep Stop 1. Nothing changed.");
      }
      const authority = routeGenerationAuthority(body);
      if (!authority) {
        throw new Error("The refreshed route could not be verified. Nothing changed.");
      }
      setLocalStops(generated);
      setLocalAuthority(authority);
      writePendingRoute(planId, {
        stops: generated,
        expectedRouteRevision: routeRevision,
        groundingProof: authority.groundingProof,
        operationKey: authority.operationKey,
      });
      announce(`Fresh route preview ready with Stop 1 kept. ${isHost ? "Save it" : "Send it to the host"} when it looks right.`);
    } catch (caught) {
      setEditing(false);
      refuse(`${caught instanceof Error ? caught.message : "Could not find a replacement route."} The current route is unchanged.`);
    } finally {
      previewInFlight.current = false;
      setLoadingPreview(false);
    }
  }

  function swapStop(index: number) {
    if (!memberToken) return;
    const current = draftStops[index];
    if (!current?.alternatives?.length) return;
    const usedByOtherStops = new Set(draftStops.filter((_, stopIndex) => stopIndex !== index).map((stop) => stop.venueId));
    const replacement = stopWithNextAlternative(current, usedByOtherStops);
    if (replacement === current) {
      announce("No other stop to swap in for that one yet.");
      return;
    }
    const nextStops = draftStops.map((stop, stopIndex) => stopIndex === index ? replacement : stop);
    const nextAuthority = anchoredPlan ? null : routeAuthority;
    setLocalStops(nextStops);
    setLocalAuthority(nextAuthority);
    writePendingRoute(planId, {
      stops: nextStops,
      expectedRouteRevision: routeRevision,
      groundingProof: nextAuthority?.groundingProof ?? null,
      operationKey: nextAuthority?.operationKey ?? null,
    });
    setEditing(true);
    announce(`Stop ${index + 1} swapped to ${nextStops[index]?.venueName}. ${isHost ? "Save the route" : "Explain the proposal below"} when it looks right.`);
  }

  async function reseedFromCanonical(): Promise<boolean> {
    try {
      const response = await fetch(`/api/plans/${planId}`, { cache: "no-store" });
      if (!response.ok) {
        discardBody(response);
        return false;
      }
      const canonical = canonicalStateFromBody(await response.json());
      if (!canonical) return false;
      adoptCanonical(canonical);
      return true;
    } catch {
      return false;
    }
  }

  async function saveRoute() {
    if (saveInFlight.current) return;
    if (!memberToken || !isHost) {
      refuse("Only the plan creator can save route changes.");
      return;
    }
    if (!validRouteDraft(draftStops) || !hasRouteChanged) {
      refuse(`Choose ${PLAN_STOP_COUNT_RANGE_SENTENCE} different stops and make a route change before saving.`);
      return;
    }
    if (routeRevision === null) {
      refuse("This route has no revision yet. Refresh the plan before saving changes.");
      return;
    }
    saveInFlight.current = true;
    setSaving(true);
    announce("Saving the route…");
    try {
      const response = await fetch(`/api/plans/${planId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${memberToken}`,
        },
        body: JSON.stringify(planSummaryRouteUpdateBody({
          stops: draftStops,
          expectedRouteRevision: routeRevision,
          authority: routeAuthority,
        })),
      });
      const body = await response.json().catch(() => null);
      const outcome = routeSaveOutcome(response.status, response.ok);
      if (outcome === "conflict") {
        // The draft was built over a revision the store no longer holds, so
        // it can never be saved: drop it and show the route that IS stored.
        clearPendingRoute(planId);
        closeEditor();
        const reseeded = await reseedFromCanonical();
        refuse(reseeded ? ROUTE_CONFLICT_RESEEDED_LINE : ROUTE_CONFLICT_UNREAD_LINE);
        return;
      }
      if (outcome === "refused") {
        refuse(errorMessageFrom(body, "Could not save the route."));
        return;
      }
      const canonical = canonicalStateFromBody(body);
      if (!canonical) {
        // The write may have landed. Re-read rather than guess.
        const reseeded = await reseedFromCanonical();
        closeEditor();
        if (reseeded) announce(ROUTE_SAVED_LINE);
        else refuse("The server did not return the saved route. Refresh the plan to see it.");
        return;
      }
      adoptCanonical(canonical);
      closeEditor();
      announce(ROUTE_SAVED_LINE);
    } catch (caught) {
      refuse(caught instanceof Error ? caught.message : "Could not save the route.");
    } finally {
      saveInFlight.current = false;
      setSaving(false);
    }
  }

  // Nested so ESLint scores the editor's branches apart from the section's
  // (AGENTS.md: a nested call leaves the element tree identical).
  function renderEditor() {
    if (!canBeginEditing || !(editing || pending)) return null;
    return (
      <div className="planSummary__editor" aria-labelledby="plan-route-editor-title" aria-busy={saving || loadingPreview}>
        <h3 id="plan-route-editor-title">Route preview</h3>
        <p>{anchoredPlan ? "Review the fresh route with Stop 1 kept." : "Swap a stop to make a private draft."} {isHost ? `Save only when it differs and still has ${PLAN_STOP_COUNT_RANGE_SENTENCE} distinct stops.` : "The route stays unchanged until the host accepts your proposal."}</p>
        <ol className="planSummary__editStops">
          {draftStops.map((stop, index) => (
            <li key={`${stop.position}-${stop.venueId}`}>
              <span className="planSummary__editMarker" aria-hidden="true">{index + 1}</span>
              <span>
                <strong>{stop.venueName}</strong>
                {stop.alternatives?.length ? <small>{stop.alternatives.length} backup{stop.alternatives.length === 1 ? "" : "s"} ready</small> : null}
              </span>
              {!anchoredPlan ? (
                <button
                  type="button"
                  className="planSummary__swap"
                  onClick={() => swapStop(index)}
                  disabled={!stop.alternatives?.length || saving}
                  aria-label={stop.alternatives?.length ? `Swap stop ${index + 1}, currently ${stop.venueName}` : `No alternatives for stop ${index + 1}`}
                >
                  Swap
                </button>
              ) : null}
            </li>
          ))}
        </ol>
        {isHost ? (
          <div className="planSummary__editorActions">
            <button type="button" className="planSummary__save" onClick={() => void saveRoute()} disabled={saving || !canSaveDraft} aria-disabled={saving || !canSaveDraft}>
              {saving ? "Saving…" : canSaveDraft ? "Save route changes" : "Choose a route change"}
            </button>
            <button type="button" className="planSummary__cancel" onClick={() => { clearPendingRoute(planId); setLocalStops(canonicalStops); setLocalAuthority(null); closeEditor(); announce("Unsaved route changes discarded."); }} disabled={saving}>
              Discard draft
            </button>
          </div>
        ) : <p className="planSummary__editorNote">Explain the change in Crew decisions. Only the host can make it canonical.</p>}
      </div>

    );
  }

  function renderNotice() {
    if (!notice) return null;
    return notice.tone === "status"
      ? <p className="planSummary__status" role="status" aria-live="polite">{notice.text}</p>
      : <p className="planSummary__status planSummary__status--error" role="alert">{notice.text}</p>;
  }

  return (
    <section className="planSummary" aria-labelledby="plan-stops-title">
      <div className="planSummary__heading">
        <p className="planPage__eyebrow">{state.context && !planUsesPintPrices(state.context) ? "First stop" : "First pint"} · {view.startLabel}</p>
        <div className="planSummary__headingRow">
          <h2 id="plan-stops-title">The route</h2>
          {canBeginEditing ? (
            <button ref={editControl} type="button" className="planSummary__edit" onClick={() => void beginEditing()} aria-expanded={editing} disabled={loadingPreview || saving}>
              {loadingPreview ? "Finding alternatives…" : editing ? "Editing" : isHost ? "Edit route" : "Propose swap"}
            </button>
          ) : null}
        </div>
      </div>
      {renderEditor()}
      {renderNotice()}
      {!editing && !pending ? (
        <>
          <PlanRoute
            planId={planId}
            startTime={state.plan.startTime}
            stops={canonicalRouteStops}
          />
          {memberToken ? (
            /* Round has no Plan-constraint fields, so this bridge carries only title and ordered venue identity. */
            <RoundStarter
              defaultTitle={state.plan.title}
              seedStops={canonicalRouteStops.map((stop) => ({
                id: stop.venueId,
                name: stop.venueName,
              }))}
            />
          ) : null}
        </>
      ) : null}
      {memberToken && canCollaborate ? (
        <PlanCollaborationPanel
          planId={planId}
          memberToken={memberToken}
          isHost={isHost}
          draftStops={draftStops.map((stop, index) => ({
            venueId: stop.venueId, venueName: stop.venueName, position: index,
            ...(stop.selectedDrinkPriceEvidence ? { selectedDrinkPriceEvidence: stop.selectedDrinkPriceEvidence } : {}),
          }))}
          routeRevision={routeRevision}
          canPropose={!anchoredPlan && !isHost && canSaveDraft}
          onProposalCreated={() => {
            clearPendingRoute(planId);
            setLocalStops(canonicalStops);
            setLocalAuthority(null);
            setEditing(false);
            announce("Proposal sent. Your private draft was cleared; the canonical route is unchanged until the host accepts.");
          }}
        />
      ) : null}
    </section>
  );
}
