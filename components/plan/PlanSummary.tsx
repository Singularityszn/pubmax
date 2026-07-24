"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import type { PlanState } from "@/lib/plan";
import PlanRoute from "@/components/plan/PlanRoute";
import PlanCollaborationPanel from "@/components/plan/PlanCollaborationPanel";
import InvitePrivacyPreview from "@/components/plan/InvitePrivacyPreview";
import { planViewModel } from "@/components/plan/planPresentation";
import { routeStopsFromGenerated } from "@/components/plan/PlanComposer";
import { parsePlanCapabilitySnapshot, planCapabilityEvent, readPlanCapabilitySnapshot } from "@/lib/planSessionCapability";
import { setActivePlanRole } from "@/lib/activePlan";
import { buildInvitePrivacyPreview, type InvitePrivacyPreviewDTO } from "@/lib/invitePrivacyPreview";
import type { PlanPrivacyPreviewDTO } from "@/lib/planPrivacy";
import type { VibeTally } from "@/lib/vibeTally";

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

type RouteRevision = string | number;
type RouteAlternative = { venueId: string; venueName: string };
type EditableStop = {
  venueId: string;
  venueName: string;
  position: number;
  alternatives?: RouteAlternative[];
};
type PendingRoute = {
  stops: EditableStop[];
  expectedRouteRevision: RouteRevision | null;
};
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

export function routeRevisionFromPlanState(value: unknown): RouteRevision | null {
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
  const row = value as { venueId?: unknown; venueName?: unknown; name?: unknown };
  const venueId = typeof row.venueId === "string" ? row.venueId.trim() : "";
  const venueName = typeof row.venueName === "string"
    ? row.venueName.trim()
    : typeof row.name === "string" ? row.name.trim() : "";
  return venueId && venueName ? { venueId, venueName } : null;
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
    return [{
      venueId,
      venueName,
      position: typeof row.position === "number" ? row.position : index,
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
    return { stops, expectedRouteRevision: cleanRevision(value.expectedRouteRevision) };
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

function validRouteDraft(stops: ReadonlyArray<EditableStop>): boolean {
  return stops.length === 3
    && stops.every((stop) => stop.venueId.trim() && stop.venueName.trim())
    && new Set(stops.map((stop) => stop.venueId)).size === 3;
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
    alternatives: [
      ...remaining,
      { venueId: stop.venueId, venueName: stop.venueName },
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
 * fetched on mount from the capability-gated /api/plans/[id] (which returns the
 * raw PlanState only for a valid host/guest with the flag on, else the preview).
 * Until — or unless — that member state arrives, only the redacted preview renders.
 */
export default function PlanSummary({
  planId,
  initialPreview,
  vibeTally,
}: {
  planId: string;
  initialPreview: PlanPrivacyPreviewDTO;
  vibeTally?: VibeTally | null;
}) {
  const [state, setState] = useState<PlanState | null>(null);
  useEffect(() => {
    let active = true;
    fetch(`/api/plans/${planId}`, { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const canonical = canonicalStateFromBody(body);
        if (active && canonical) setState(canonical);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [planId]);

  if (!state) {
    return (
      <section className="planSummary" aria-labelledby="plan-stops-title">
        <div className="planSummary__rail" aria-hidden="true" />
        <div className="planSummary__heading">
          <p className="planPage__eyebrow">First pint · {initialPreview.startLabel}</p>
          <h2 id="plan-stops-title">The route</h2>
        </div>
        <InvitePrivacyPreview preview={toInvitePreview(initialPreview)} />
      </section>
    );
  }

  return <PlanSummaryMember planId={planId} state={state} vibeTally={vibeTally} />;
}

function PlanSummaryMember({ planId, state, vibeTally }: { planId: string; state: PlanState; vibeTally?: VibeTally | null }) {
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
  const invitePreview = useMemo(() => buildInvitePrivacyPreview(state, vibeTally), [state, vibeTally]);
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
  const pending = useMemo(() => parsePendingRoute(pendingRaw), [pendingRaw]);
  const initialStops = view.stops.map((stop) => ({ ...stop, alternatives: [] as RouteAlternative[] }));
  const [localStops, setLocalStops] = useState<EditableStop[]>(initialStops);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState("");
  const draftStops = pending?.stops ?? localStops;
  const isHost = Boolean(memberToken && role === "host");
  const canCollaborate = Boolean(memberToken && collaborationAuthorized);
  useEffect(() => {
    if (memberToken && role) setActivePlanRole(planId, role);
  }, [memberToken, planId, role]);
  const [savedRevision, setSavedRevision] = useState<RouteRevision | null>(routeRevisionFromPlanState(state));
  const routeRevision = pending?.expectedRouteRevision ?? savedRevision;
  const canonicalStops = view.stops.map((stop) => ({ venueId: stop.venueId }));
  const hasRouteChanged = routeHasChanged(canonicalStops, draftStops);
  const canSaveDraft = validRouteDraft(draftStops) && hasRouteChanged && routeRevision !== null;
  const visibleStops = draftStops.map((stop, index) => ({
    venueId: stop.venueId,
    venueName: stop.venueName,
    position: typeof stop.position === "number" ? stop.position : index,
  }));

  async function beginEditing() {
    if (!memberToken) {
      setError("Join the crew before proposing a route change.");
      return;
    }
    setEditing(true);
    setError("");
    if (pending) {
      setStatus(`Recovered unsaved route changes. Nothing changes until ${isHost ? "you save" : "the host accepts a proposal"}.`);
      return;
    }
    if (!state.context) {
      setEditing(false);
      setError("This plan doesn't have enough saved to sort a fresh route. Add the details, then try again.");
      return;
    }
    setLoadingPreview(true);
    setStatus("Sorting a fresh three-stop route, with a backup for each stop…");
    try {
      const response = await fetch("/api/plans/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ context: state.context }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body?.error?.message || body?.error || "Could not find a replacement route.");
      const generated = routeStopsFromGenerated(body.stops, body.alternatives).map((stop, index) => ({
        venueId: stop.venueId,
        venueName: stop.venueName,
        position: index,
        alternatives: stop.alternatives,
      }));
      if (!validRouteDraft(generated)) throw new Error("Couldn't get three good stops that time. Give it another go.");
      setLocalStops(generated);
      writePendingRoute(planId, { stops: generated, expectedRouteRevision: routeRevisionFromPlanState(state) });
      setStatus(`Fresh route preview ready. Swap a stop, then ${isHost ? "save it" : "send it to the host"}.`);
    } catch (caught) {
      setEditing(false);
      setError(caught instanceof Error ? caught.message : "Could not find a replacement route.");
      setStatus("The current canonical route is unchanged.");
    } finally {
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
      setStatus("No other stop to swap in for that one yet.");
      return;
    }
    const nextStops = draftStops.map((stop, stopIndex) => stopIndex === index ? replacement : stop);
    setLocalStops(nextStops);
    writePendingRoute(planId, { stops: nextStops, expectedRouteRevision: routeRevision });
    setEditing(true);
    setStatus(`Stop ${index + 1} swapped to ${nextStops[index]?.venueName}. ${isHost ? "Save the route" : "Explain the proposal below"} when it looks right.`);
    setError("");
  }

  async function saveRoute() {
    if (!memberToken) {
      setError("Only the plan creator can save route changes.");
      return;
    }
    if (!isHost) {
      setError("Only the plan creator can save route changes.");
      return;
    }
    if (!validRouteDraft(draftStops) || !hasRouteChanged) {
      setError("Save requires exactly three distinct stops and a real route change.");
      return;
    }
    if (routeRevision === null) {
      setError("This route has no revision yet. Refresh the plan before saving changes.");
      return;
    }
    setSaving(true);
    setError("");
    setStatus("Saving the route…");
    try {
      const response = await fetch(`/api/plans/${planId}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${memberToken}`,
        },
        body: JSON.stringify({
          stops: draftStops.map(({ venueId, venueName }) => ({ venueId, venueName })),
          expectedRouteRevision: routeRevision,
        }),
      });
      const body = await response.json();
      if (!response.ok) {
        throw new Error(response.status === 409 || response.status === 412
          ? "This route changed in another tab. Nothing was saved; refresh the plan before trying again."
          : body?.error || "Could not save the route.");
      }
      const canonical = canonicalStateFromBody(body);
      if (!canonical) throw new Error("The server did not return a canonical route. Nothing was saved in this view.");
      setSavedRevision(routeRevisionFromPlanState(canonical) ?? routeRevision);
      clearPendingRoute(planId);
      setLocalStops(cleanStops(canonical.stops));
      setEditing(false);
      setStatus("Route saved. The new order is now canonical.");
    } catch (caught) {
      const message = caught instanceof Error ? caught.message : "Could not save the route.";
      setError(message);
      setStatus(`The previous route is still shown. ${message}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="planSummary" aria-labelledby="plan-stops-title">
      <div className="planSummary__rail" aria-hidden="true" />
      <div className="planSummary__heading">
        <p className="planPage__eyebrow">First pint · {view.startLabel}</p>
        <div className="planSummary__headingRow">
          <h2 id="plan-stops-title">The route</h2>
          {memberToken && canCollaborate ? (
            <button type="button" className="planSummary__edit" onClick={() => void beginEditing()} aria-expanded={editing} disabled={loadingPreview}>
              {loadingPreview ? "Finding alternatives…" : editing ? "Editing" : isHost ? "Edit route" : "Propose swap"}
            </button>
          ) : null}
        </div>
      </div>
      {memberToken && canCollaborate && (editing || pending) ? (
        <div className="planSummary__editor" aria-labelledby="plan-route-editor-title">
          <h3 id="plan-route-editor-title">Route preview</h3>
          <p>Swap a stop to make a private draft. {isHost ? "Save only when it differs and still has exactly three distinct stops." : "The route stays unchanged until the host accepts your proposal."}</p>
          <ol className="planSummary__editStops">
            {draftStops.map((stop, index) => (
              <li key={`${stop.position}-${stop.venueId}`}>
                <span className="planSummary__editMarker" aria-hidden="true">{index + 1}</span>
                <span>
                  <strong>{stop.venueName}</strong>
                  {stop.alternatives?.length ? <small>{stop.alternatives.length} backup{stop.alternatives.length === 1 ? "" : "s"} ready</small> : null}
                </span>
                <button
                  type="button"
                  className="planSummary__swap"
                  onClick={() => swapStop(index)}
                  disabled={!stop.alternatives?.length || saving}
                  aria-label={stop.alternatives?.length ? `Swap stop ${index + 1}, currently ${stop.venueName}` : `No alternatives for stop ${index + 1}`}
                >
                  Swap
                </button>
              </li>
            ))}
          </ol>
          {isHost ? (
            <div className="planSummary__editorActions">
              <button type="button" className="planSummary__save" onClick={saveRoute} disabled={saving || !canSaveDraft}>
                {saving ? "Saving…" : canSaveDraft ? "Save route changes" : "Choose a route change"}
              </button>
              <button type="button" className="planSummary__cancel" onClick={() => { clearPendingRoute(planId); setEditing(false); setError(""); setStatus("Unsaved route changes discarded."); }} disabled={saving}>
                Discard draft
              </button>
            </div>
          ) : <p className="planSummary__editorNote">Explain the change in Crew decisions. Only the host can make it canonical.</p>}
        </div>
      ) : null}
      {status ? <p className="planSummary__status" role="status" aria-live="polite">{status}</p> : null}
      {error ? <p className="planComposer__error" role="alert">{error}</p> : null}
      {!editing && !pending ? (
        memberToken
          ? (
            <PlanRoute
              planId={planId}
              startTime={state.plan.startTime}
              stops={visibleStops}
            />
          )
          : <InvitePrivacyPreview preview={invitePreview} />
      ) : null}
      {memberToken && canCollaborate ? (
        <PlanCollaborationPanel
          planId={planId}
          memberToken={memberToken}
          isHost={isHost}
          draftStops={draftStops.map((stop, index) => ({ venueId: stop.venueId, venueName: stop.venueName, position: index }))}
          routeRevision={routeRevision}
          canPropose={!isHost && canSaveDraft}
          onProposalCreated={() => {
            clearPendingRoute(planId);
            setEditing(false);
            setStatus("Proposal sent. Your private draft was cleared; the canonical route is unchanged until the host accepts.");
          }}
        />
      ) : null}
    </section>
  );
}
