"use client";

// Night Mode — the "during the night" surface (Wave E2). A persistent bottom
// card that appears across every screen while a plan is on tonight, composed
// entirely from pieces that already exist:
//   • current + next stop           ← plan state (/api/plans/[id]) + the get-in
//                                       report (/api/plans/[id]/getin, same feed
//                                       the plan screen's PlanRoute reads).
//   • who's arrived                 ← plan crew presence (status here/on_the_way).
//   • one-tap "log this pint"       ← deep-link into the map's Pint Drop composer
//                                       for the CURRENT stop's venue.
//   • last-train countdown          ← /api/last-train for the current venue's
//                                       coords (the same last-ride feed as
//                                       LastTrainCard), leave-by ticked locally.
//
// No invented data: any section whose feed is absent is simply omitted. The
// "current stop" cursor is user-advanced (never guessed) via the Here-now tap.
//
// Mounted once in the app shell (app/layout.tsx). Renders nothing unless a plan
// is active and undismissed — so it costs nothing on every other night.

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, ChevronRight, MapPin, PlusCircle, TrainFront, Trash2, X } from "lucide-react";

import {
  setActivePlanStopIndex,
  setActivePlanEndingPreview,
  clampStopIndex,
  markNightModeActiveFired,
  type ActivePlanRef,
} from "@/lib/activePlan";
import { trackEvent } from "@/lib/analytics";
import { authedFetch } from "@/lib/authedFetch";
import type { PlanGetInReportDTO, PlanGetInStopDTO } from "@/lib/planGetIn";
import type { CrawlEnding, EndingSelection, PlanCompletionDTO, PlanState, PlanStopDTO } from "@/lib/plan";
import type { CrewMemberDTO } from "@/lib/crew";
import { lastRideFetchUrl } from "@/lib/lastRide";
import type { LateFoodApiResponse, LateFoodTerminal } from "@/lib/lateFood";
import { haversineKm } from "@/lib/haversine";
import RouteEndingCard, { type RouteEndingId, type RouteEndingOptions } from "@/components/night/RouteEndingCard";
import { useActivePlan } from "@/components/night/useActivePlan";
import {
  ensurePendingPlanRecap,
  readPendingPlanRecap,
  resolvePendingPlanRecap,
  subscribePendingPlanRecap,
  writePendingPlanRecap,
  type PendingPlanRecap,
} from "@/lib/planRecap";
import { parsePlanCapabilitySnapshot, readPlanCapabilitySnapshot, restorePlanCapability } from "@/lib/planSessionCapability";
import "./nightMode.css";

type VenueCoord = { id: string; name: string; lat: number; lng: number; cheapestPrice: number | null };
type KeepGoingExtension = VenueCoord & { distanceKm: number };

// Minimal shape we read off /api/last-train (LastRideResult) — narrowed so we
// don't drag the whole tfl type surface into the client for one countdown.
type LastTrainSlim = {
  station?: { name?: string } | null;
  decision?: { leaveByIso?: string | null; decision?: string } | null;
};

// Crew statuses that mean "physically arriving/arrived" — the honest read of the
// presence enum for a during-the-night "who's here" line.
const ARRIVED: ReadonlySet<CrewMemberDTO["status"]> = new Set(["here", "on_the_way"]);
const SWIPE_DISMISS_PX = 72;

function readMemberToken(planId: string): string {
  return parsePlanCapabilitySnapshot(readPlanCapabilitySnapshot(planId)).token;
}

export type PlanRouteRevision = string | number;

export function routeRevisionFromPlan(value: PlanState | null): PlanRouteRevision | null {
  if (!value) return null;
  const direct = (value as PlanState & { routeRevision?: unknown }).routeRevision;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  if (typeof direct === "number" && Number.isInteger(direct) && direct >= 0) return direct;
  const nested = (value.plan as PlanState["plan"] & { routeRevision?: unknown }).routeRevision;
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  if (typeof nested === "number" && Number.isInteger(nested) && nested >= 0) return nested;
  return null;
}

export function completePlanPayload(
  ending: CrawlEnding,
  terminalVenueId: string,
  expectedRouteRevision: PlanRouteRevision,
  endingSelection?: EndingSelection,
  finalPintDropId?: string,
): Record<string, unknown> {
  return {
    ending,
    terminalVenueId,
    expectedRouteRevision,
    ...(endingSelection ? { endingSelection } : {}),
    ...(finalPintDropId ? { finalPintDropId } : {}),
  };
}

export function foodEndingSelection(terminal: LateFoodTerminal): Extract<EndingSelection, { kind: "food" }> {
  return {
    kind: "food",
    optionId: terminal.id,
    externalPlaceId: terminal.id,
    evidenceSnapshot: {
      label: terminal.name,
      confidence: terminal.confidence,
      source: `${terminal.provenance.source} · ${terminal.provenance.sourceUrl}`,
      observedAt: terminal.provenance.observedAt,
      warnings: [terminal.hours.service],
    },
  };
}

export function getHomeEndingSelection(stationName: string | null, leaveByIso: string | null): Extract<EndingSelection, { kind: "get_home" }> {
  const label = stationName?.trim() || "Nearest transport anchor";
  return {
    kind: "get_home",
    optionId: `transport:${label.toLocaleLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "nearest"}`,
    evidenceSnapshot: {
      label,
      confidence: leaveByIso ? "medium" : "unknown",
      source: leaveByIso ? "TfL journey and last-service signal" : "PUBMAXX transport anchor",
      ...(!leaveByIso ? { warnings: ["Live leave-by evidence was unavailable when this ending was confirmed."] } : {}),
    },
  };
}

export function keepGoingEndingSelection(extension: KeepGoingExtension): Extract<EndingSelection, { kind: "keep_going" }> {
  return {
    kind: "keep_going",
    optionId: extension.id,
    venueId: extension.id,
    evidenceSnapshot: {
      label: extension.name,
      confidence: "low",
      source: "PUBMAXX venue index",
      warnings: ["Closing time was unverified when this extension was confirmed."],
    },
  };
}

export function canonicalPlanFromCompleteBody(value: unknown): PlanState | null {
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

export function recommendedEndingForPlan(
  plan: PlanState | null,
  lateFoodCount: number,
): CrawlEnding {
  if ((plan?.context?.foodNeeds?.length ?? 0) > 0 && lateFoodCount > 0) return "food";
  if (plan?.context?.daypart === "get_home") return "get_home";
  if (plan?.context?.daypart === "late_night" && lateFoodCount > 0) return "food";
  return "get_home";
}

export function endingOptionsForSignals({
  lateFoodCount,
  stationName,
  leaveByIso,
  extensionCount,
}: {
  lateFoodCount: number;
  stationName: string | null;
  leaveByIso: string | null;
  extensionCount: number;
}): RouteEndingOptions {
  return [
    {
      id: "food",
      title: "Find food",
      description: lateFoodCount > 0
        ? `${lateFoodCount} reviewed nearby option${lateFoodCount === 1 ? "" : "s"}; verify tonight's hours.`
        : "No reviewed late-food option is available here yet.",
      actionLabel: "Review food",
    },
    {
      id: "get_home",
      title: "Get home",
      description: leaveByIso
        ? `Live leave-by signal for ${stationName ?? "the nearest station"}.`
        : `Review ${stationName ?? "the nearest transport anchor"} before confirming.`,
      actionLabel: "Review journey",
      recommended: true,
    },
    {
      id: "keep_going",
      title: "Keep going",
      description: extensionCount > 0
        ? `${extensionCount} grounded nearby extension${extensionCount === 1 ? "" : "s"}; hours unverified.`
        : "No grounded nearby extension is available yet.",
      actionLabel: "Review extensions",
    },
  ];
}

export function confirmedEndingForPlan(
  plan: PlanState | null,
  _confirmedChoice: CrawlEnding | null,
): CrawlEnding | null {
  // A local selection is only intent. The result becomes visible after the
  // canonical /complete response returns a persisted ending.
  void _confirmedChoice;
  return plan?.ending ?? null;
}

export default function NightModeCard() {
  const pathname = usePathname();
  const { ref } = useActivePlan();

  // The mobile map already owns the active-plan pill and planner sheet. Keeping
  // this global surface off /map prevents a second fixed sheet from stacking.
  if (pathname === "/map" || pathname.startsWith("/map/")) return null;

  if (!ref) return null;
  return <NightModeSurface key={ref.id} entry={ref} />;
}

function NightModeSurface({ entry }: { entry: ActivePlanRef }) {
  const [expanded, setExpanded] = useState(false);
  const [restoreFocus, setRestoreFocus] = useState(false);
  const open = () => {
    setRestoreFocus(false);
    setExpanded(true);
  };
  const collapse = () => {
    setRestoreFocus(true);
    setExpanded(false);
  };
  if (!expanded) return <NightModePill onOpen={open} restoreFocus={restoreFocus} />;
  // Key by plan id so a plan switch remounts the sheet fresh — React otherwise
  // preserves the prior plan's route/crew/last-train state until refetch lands.
  return <NightModeSheet entry={entry} onCollapse={collapse} />;
}

function NightModePill({ onOpen, restoreFocus }: { onOpen: () => void; restoreFocus: boolean }) {
  return (
    <button
      type="button"
      className="nightPill"
      onClick={onOpen}
      autoFocus={restoreFocus}
      aria-label="Show tonight's plan"
    >
      <MapPin size={15} aria-hidden="true" />
      Tonight
    </button>
  );
}

function NightModeSheet({ entry, onCollapse }: { entry: ActivePlanRef; onCollapse: () => void }) {
  const { id, stopIndex } = entry;
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [report, setReport] = useState<PlanGetInReportDTO | null>(null);
  const [coords, setCoords] = useState<VenueCoord[] | null>(null);
  const [lateFood, setLateFood] = useState<LateFoodTerminal[]>([]);
  const chosenEnding = entry.endingPreview ?? null;
  const [chosenExtension, setChosenExtension] = useState<KeepGoingExtension | null>(null);
  const [endingSaving, setEndingSaving] = useState(false);
  const endingSavingRef = useRef(false);
  const [endingError, setEndingError] = useState("");
  const [recap, setRecap] = useState<PendingPlanRecap | null>(() => readPendingPlanRecap(id));
  const [recapOpen, setRecapOpen] = useState(false);
  const [recapSaving, setRecapSaving] = useState(false);
  const recapSavingRef = useRef(false);
  const [recapMessage, setRecapMessage] = useState("");
  // Store the last-train result tagged with the venue it belongs to, so a result
  // from a previous stop is never rendered against the current one (the tag is
  // checked at read time — cheaper and lint-cleaner than a clear-in-effect).
  const [lastTrain, setLastTrain] = useState<{ venueId: string; data: LastTrainSlim } | null>(null);
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);
  // Track the live drag distance in a ref too: a fast pointer-up can fire before
  // the dragY state commit, so release must read the ref, not stale state.
  const dragYRef = useRef(0);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus({ preventScroll: true });
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCollapse();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onCollapse]);

  // Plan state + get-in report — the two feeds the plan screen already uses.
  useEffect(() => {
    let active = true;
    fetch(`/api/plans/${id}`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: PlanState | null) => {
        if (active && body && Array.isArray(body.stops)) setPlan(body);
      })
      .catch(() => undefined);
    fetch(`/api/plans/${id}/getin`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: PlanGetInReportDTO | null) => {
        if (active && body && Array.isArray(body.stops)) setReport(body);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [id]);

  useEffect(() => subscribePendingPlanRecap(id, () => {
    setRecap(readPendingPlanRecap(id));
  }), [id]);

  useEffect(() => {
    if (plan?.plan.status !== "completed" && !plan?.ending) return;
    const controller = new AbortController();
    void fetch(`/api/plans/${id}/complete`, { cache: "no-store", signal: controller.signal })
      .then(async (response) => response.ok ? response.json() as Promise<{ completion?: PlanCompletionDTO | null }> : null)
      .then((body) => {
        if (controller.signal.aborted || !body?.completion) return;
        const existing = readPendingPlanRecap(id);
        if (!existing || existing.completionId !== body.completion.id) setRecap(ensurePendingPlanRecap(body.completion, plan.plan.title));
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, [id, plan]);

  // Venue coordinates for the last-train lookup — the slim index the app already
  // ships and caches (same file the plan composer reads).
  useEffect(() => {
    let active = true;
    fetch("/data/venues_slim.json")
      .then((r) => (r.ok ? r.json() : null))
      .then((rows: VenueCoord[] | null) => {
        if (active && Array.isArray(rows)) setCoords(rows);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, []);

  const stops = plan?.stops ?? [];
  const cursor = clampStopIndex(stopIndex, stops.length);
  const currentStop = stops[cursor] ?? null;
  const nextStop = stops[cursor + 1] ?? null;
  const signals = useMemo(
    () => new Map((report?.stops ?? []).map((s) => [s.venueId, s])),
    [report],
  );
  const currentSignal = currentStop ? signals.get(currentStop.venueId) ?? null : null;

  const currentCoord = useMemo(() => {
    if (!currentStop || !coords) return null;
    return coords.find((v) => v.id === currentStop.venueId) ?? null;
  }, [currentStop, coords]);

  useEffect(() => {
    const area = plan?.context?.nightArea;
    if (!area) {
      void Promise.resolve().then(() => setLateFood([]));
      return;
    }
    const params = new URLSearchParams({ area, limit: "3", at: new Date().toISOString() });
    if (currentCoord) {
      params.set("fromLat", String(currentCoord.lat));
      params.set("fromLng", String(currentCoord.lng));
    }
    let active = true;
    const controller = new AbortController();
    fetch(`/api/late-food?${params}`, { cache: "no-store", signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: LateFoodApiResponse | null) => {
        if (active) setLateFood(Array.isArray(body?.terminals) ? body.terminals : []);
      })
      .catch(() => {
        if (active) setLateFood([]);
      });
    return () => {
      active = false;
      controller.abort();
    };
  }, [currentCoord, plan?.context?.nightArea]);

  const keepGoingExtensions = useMemo<KeepGoingExtension[]>(() => {
    if (!currentCoord || !coords) return [];
    const routeIds = new Set(stops.map((stop) => stop.venueId));
    return coords
      .filter((venue) => !routeIds.has(venue.id))
      .map((venue) => ({
        ...venue,
        distanceKm: haversineKm([currentCoord.lng, currentCoord.lat], [venue.lng, venue.lat]),
      }))
      .filter((venue) => venue.distanceKm <= 2.5)
      .sort((left, right) => left.distanceKm - right.distanceKm)
      .slice(0, 2);
  }, [coords, currentCoord, stops]);

  // Last-train for the current venue (London last-ride feed) — omitted entirely
  // when we have no coords or the feed can't produce a station.
  useEffect(() => {
    if (!currentCoord) return;
    const venueId = currentCoord.id;
    const url = lastRideFetchUrl("london", currentCoord.lat, currentCoord.lng);
    if (!url) return;
    let active = true;
    const controller = new AbortController();
    fetch(url, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: LastTrainSlim | null) => {
        if (active) setLastTrain(body && body.station ? { venueId, data: body } : null);
      })
      .catch(() => undefined);
    return () => {
      active = false;
      controller.abort();
    };
  }, [currentCoord]);

  // Fire night_mode_active once per plan per mount-session, when the card has a
  // real plan to show (R3 metrics rail — event already typed in lib/analytics).
  useEffect(() => {
    if (!plan) return;
    if (!markNightModeActiveFired(id)) return;
    trackEvent("night_mode_active", { stops: stops.length, crew: plan.crew.length });
  }, [plan, id, stops.length]);

  const arrived = (plan?.crew ?? []).filter((m) => ARRIVED.has(m.status));

  const advance = useCallback(() => {
    setActivePlanStopIndex(clampStopIndex(cursor + 1, stops.length));
  }, [cursor, stops.length]);

  const completeEnding = useCallback(async (ending: CrawlEnding, terminalVenueId: string, endingSelection: EndingSelection) => {
    if (!plan || endingSavingRef.current) return;
    endingSavingRef.current = true;
    setEndingSaving(true);
    setEndingError("");
    try {
      let memberToken = readMemberToken(id);
      if (!memberToken) {
        await restorePlanCapability(id);
        memberToken = readMemberToken(id);
      }
      const expectedRouteRevision = routeRevisionFromPlan(plan);
      if (!memberToken) {
        setEndingError("Join this plan before saving its ending.");
        return;
      }
      if (expectedRouteRevision === null) {
        setEndingError("This route has no active revision. Nothing was completed; refresh the plan and try again.");
        return;
      }
      const response = await fetch(`/api/plans/${id}/complete`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${memberToken}`,
        },
        body: JSON.stringify(completePlanPayload(ending, terminalVenueId, expectedRouteRevision, endingSelection)),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(response.status === 409 || response.status === 412
          ? "This route changed before the ending was saved. Nothing was completed; refresh the plan and try again."
          : body?.error || "Could not save that ending.");
      }
      let canonical = canonicalPlanFromCompleteBody(body);
      if (!canonical) {
        const refreshed = await fetch(`/api/plans/${id}`, { cache: "no-store" });
        canonical = refreshed.ok ? canonicalPlanFromCompleteBody(await refreshed.json()) : null;
      }
      if (!canonical || (!canonical.ending && canonical.plan.status !== "completed")) {
        throw new Error("The ending response was not canonical. Nothing was marked complete in this view.");
      }
      setPlan(canonical);
      const completed = body && typeof body === "object" && "completion" in body
        ? (body as { completion?: PlanCompletionDTO }).completion ?? null
        : null;
      if (completed) {
        setRecap(ensurePendingPlanRecap(completed, canonical.plan.title));
      }
      setActivePlanEndingPreview(id, null);
      trackEvent("planned_night_completed", { ending: canonical.ending ?? ending });
    } catch (caught) {
      setEndingError(caught instanceof Error
        ? `${caught.message} Nothing was completed in this view.`
        : "Could not save that ending. Nothing was completed in this view.");
    } finally {
      endingSavingRef.current = false;
      setEndingSaving(false);
    }
  }, [id, plan]);

  const savePrivateRecap = useCallback(async () => {
    if (!recap || recapSavingRef.current) return;
    recapSavingRef.current = true;
    setRecapSaving(true);
    setRecapMessage("");
    try {
      let memberToken = readMemberToken(id);
      if (!memberToken) {
        await restorePlanCapability(id);
        memberToken = readMemberToken(id);
      }
      if (!memberToken) {
        setRecapMessage("Open the Plan in this browser before saving. Your recap remains private on this device.");
        return;
      }
      const response = await authedFetch(`/api/plans/${id}/recap`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberToken, recap }),
      });
      const body = await response.json().catch(() => ({})) as { memory?: { id: string }; error?: string; code?: string };
      if (!response.ok || !body.memory) {
        throw new Error(response.status === 401
          ? "Sign in to move this local recap into your private Memories."
          : body.error ?? "Could not save this private Memory.");
      }
      resolvePendingPlanRecap(recap, "saved");
      setRecap(null);
      setRecapOpen(false);
      setRecapMessage("Private Memory saved. Nothing was published.");
      trackEvent("night_memory_created", { source: "completed_plan" });
    } catch (caught) {
      setRecapMessage(caught instanceof Error ? caught.message : "Could not save this private Memory. Your local recap is safe.");
    } finally {
      recapSavingRef.current = false;
      setRecapSaving(false);
    }
  }, [id, recap]);

  const chooseEnding = useCallback((ending: RouteEndingId) => {
    if (!plan || endingSaving) return;
    setActivePlanEndingPreview(id, ending);
    setEndingError("");
    trackEvent("planned_night_action", { type: `${ending}_preview` });
  }, [endingSaving, id, plan]);

  // Lightweight swipe-down-to-dismiss on the grabber (Apple sheet idiom) — kept
  // local so we don't couple to the map-only useSheetDrag host.
  const resetDrag = () => {
    dragStart.current = null;
    dragYRef.current = 0;
    setDragY(0);
  };
  const onPointerDown = (e: React.PointerEvent) => {
    dragStart.current = e.clientY;
    dragYRef.current = 0;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (dragStart.current === null) return;
    const dy = Math.max(0, e.clientY - dragStart.current);
    dragYRef.current = dy;
    setDragY(dy);
  };
  const onPointerUp = () => {
    // Read the ref, not dragY state: a fast release can precede the state commit.
    if (dragStart.current !== null && dragYRef.current > SWIPE_DISMISS_PX) onCollapse();
    resetDrag();
  };
  const onPointerCancel = () => resetDrag();

  // Only honour a result that belongs to the CURRENT venue — a reading tagged
  // with a previous stop (or held while we advance to a venue we couldn't
  // locate) is ignored, so nothing stale lingers between venue changes.
  const currentTrain =
    currentCoord && lastTrain?.venueId === currentCoord.id ? lastTrain.data : null;
  const lastTrainLeaveBy = currentTrain?.decision?.leaveByIso ?? null;
  const activeEnding = confirmedEndingForPlan(plan, chosenEnding);
  const recommendedEnding = recommendedEndingForPlan(plan, lateFood.length);
  const endingOptions = endingOptionsForSignals({
    lateFoodCount: lateFood.length,
    stationName: currentTrain?.station?.name ?? null,
    leaveByIso: lastTrainLeaveBy,
    extensionCount: keepGoingExtensions.length,
  });

  return (
    <section
      className="nightCard"
      aria-label="Tonight's plan"
      role="dialog"
      aria-modal="false"
      style={dragY ? ({ "--night-drag-y": `${dragY}px` } as React.CSSProperties) : undefined}
    >
      <div
        className="nightCard__grab"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        aria-hidden="true"
      >
        <span className="nightCard__grabber" />
      </div>

      <div className="nightCard__head">
        <p className="nightCard__eyebrow">On tonight{plan?.plan.title ? ` · ${plan.plan.title}` : ""}</p>
        <button
          ref={closeRef}
          type="button"
          className="nightCard__close"
          onClick={onCollapse}
          aria-label="Hide tonight's plan"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      {currentStop ? (
        <div className="nightCard__stop">
          <span className="nightCard__marker">{cursor + 1}</span>
          <div className="nightCard__stopBody">
            <strong className="nightCard__now">{currentStop.venueName}</strong>
            <NightStopSignal signal={currentSignal} />
          </div>
          <Link
            href={`/map?venue=${encodeURIComponent(currentStop.venueId)}`}
            className="nightCard__logBtn"
          >
            <PlusCircle size={16} aria-hidden="true" />
            Log this pint
          </Link>
        </div>
      ) : (
        <p className="nightCard__loading">Loading tonight&rsquo;s route…</p>
      )}

      {lastTrainLeaveBy ? (
        <LastTrainLine leaveByIso={lastTrainLeaveBy} stationName={currentTrain?.station?.name ?? null} />
      ) : null}

      {nextStop ? (
        <button type="button" className="nightCard__next" onClick={advance}>
          <span className="nightCard__nextLabel">
            Next · <strong>{nextStop.venueName}</strong>
          </span>
          <span className="nightCard__nextAction">
            Here now <ChevronRight size={15} aria-hidden="true" />
          </span>
        </button>
      ) : currentStop ? (
        <div className="nightCard__ending">
          <RouteEndingCard
            className="nightCard__endingCard"
            title="Last stop. What next?"
            description="Choose an ending to review. PUBMAXX changes nothing until you confirm."
            options={endingOptions}
            recommendedId={recommendedEnding}
            onChoose={chooseEnding}
          />
          {endingSaving ? (
            <p className="nightCard__endingStatus" role="status">Saving the ending…</p>
          ) : null}
          {endingError ? (
            <p className="nightCard__endingError" role="alert">{endingError}</p>
          ) : null}
          {chosenEnding === "food" && !activeEnding ? (
            <FoodEndingPicker terminals={lateFood} saving={endingSaving} onChoose={(terminal) => completeEnding("food", currentStop.venueId, foodEndingSelection(terminal))} />
          ) : null}
          {chosenEnding === "get_home" && !activeEnding ? (
            <GetHomeEndingConfirmation
              saving={endingSaving}
              stationName={currentTrain?.station?.name ?? null}
              leaveByIso={lastTrainLeaveBy}
              onConfirm={() => completeEnding("get_home", currentStop.venueId, getHomeEndingSelection(currentTrain?.station?.name ?? null, lastTrainLeaveBy))}
            />
          ) : null}
          {chosenEnding === "keep_going" && !activeEnding ? (
            <KeepGoingPicker
              extensions={keepGoingExtensions}
              saving={endingSaving}
              onChoose={(extension) => {
                setChosenExtension(extension);
                void completeEnding("keep_going", currentStop.venueId, keepGoingEndingSelection(extension));
              }}
            />
          ) : null}
          {activeEnding ? (
            <>
              <NightEndingResult
                ending={activeEnding}
                currentStop={currentStop}
                lateFood={lateFood}
                stationName={currentTrain?.station?.name ?? null}
                leaveByIso={lastTrainLeaveBy}
                keepGoingExtension={chosenExtension}
              />
              {recap ? (
                <div className="nightCard__recapActions">
                  <button type="button" className="nightCard__endingLink" onClick={() => setRecapOpen((open) => !open)} aria-expanded={recapOpen}>
                    <BookOpen size={16} aria-hidden="true" /> Review private recap
                  </button>
                  <button type="button" className="nightCard__quietButton" onClick={() => { resolvePendingPlanRecap(recap, "discarded"); setRecap(null); setRecapOpen(false); }}>
                    <Trash2 size={15} aria-hidden="true" /> Discard local recap
                  </button>
                </div>
              ) : null}
              {recapOpen && recap ? (
                <PlanRecapEditor recap={recap} saving={recapSaving} onChange={(next) => { setRecap(next); writePendingPlanRecap(next); }} onSave={() => void savePrivateRecap()} />
              ) : null}
              {recapMessage ? <p className="nightCard__endingStatus" role="status">{recapMessage} {recapMessage.startsWith("Private Memory saved") ? <Link href="/u/you#night-memories">Open Memories</Link> : null}</p> : null}
            </>
          ) : null}
        </div>
      ) : null}

      {arrived.length > 0 ? (
        <div className="nightCard__crew">
          <span className="nightCard__crewCount">{arrived.length} arriving</span>
          <ul className="nightCard__crewList">
            {arrived.map((m) => (
              <li key={m.id} data-status={m.status}>
                {m.name}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function FoodEndingPicker({
  terminals,
  saving,
  onChoose,
}: {
  terminals: LateFoodTerminal[];
  saving: boolean;
  onChoose: (terminal: LateFoodTerminal) => void;
}) {
  if (terminals.length === 0) {
    return <p className="nightCard__endingHint">Reviewed nearby food recommendations are not available for this route yet.</p>;
  }
  return (
    <div className="nightCard__foodPicker" aria-label="Choose a food ending">
      <strong>Nearby food to review</strong>
      <ul>
        {terminals.slice(0, 3).map((terminal) => (
          <li key={terminal.id}>
            <button
              type="button"
              className="nightCard__endingLink"
              style={{ width: "100%", justifyContent: "space-between", border: 0, font: "inherit", textAlign: "left", cursor: saving ? "wait" : "pointer" }}
              onClick={() => onChoose(terminal)}
              disabled={saving}
              aria-label={`Choose Food ending; ${terminal.name} is a nearby recommendation`}
            >
              <span>{terminal.name}</span>
              <small>{terminal.walkingDetour.minutes === null ? "distance pending" : `${terminal.walkingDetour.minutes} min direct-distance estimate`} · {terminal.confidence} confidence · recommendation only</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GetHomeEndingConfirmation({
  saving,
  stationName,
  leaveByIso,
  onConfirm,
}: {
  saving: boolean;
  stationName: string | null;
  leaveByIso: string | null;
  onConfirm: () => void;
}) {
  return (
    <div className="nightCard__foodPicker" aria-label="Confirm Get home ending">
      <strong>Review the journey signal</strong>
      <p>{leaveByIso ? `A live leave-by signal is available for ${stationName ?? "the nearest station"}.` : `Check live status and your destination from ${stationName ?? "the nearest transport anchor"}.`}</p>
      <button type="button" className="nightCard__endingLink" disabled={saving} onClick={onConfirm}>
        Confirm Get home ending
      </button>
      <a className="nightCard__endingLink" href="https://tfl.gov.uk/plan-a-journey/" target="_blank" rel="noreferrer">Open TfL journey planner</a>
    </div>
  );
}

function KeepGoingPicker({
  extensions,
  saving,
  onChoose,
}: {
  extensions: KeepGoingExtension[];
  saving: boolean;
  onChoose: (extension: KeepGoingExtension) => void;
}) {
  if (extensions.length === 0) {
    return <p className="nightCard__endingHint">No grounded nearby extension is available without widening the route.</p>;
  }
  return (
    <div className="nightCard__foodPicker" aria-label="Choose a Keep going extension">
      <strong>Grounded nearby extensions</strong>
      <ul>
        {extensions.map((extension) => (
          <li key={extension.id}>
            <button type="button" className="nightCard__endingLink" disabled={saving} onClick={() => onChoose(extension)}>
              <span>{extension.name}</span>
              <small>{extension.distanceKm.toFixed(1)} km straight-line · {extension.cheapestPrice === null ? "price unknown" : `about £${extension.cheapestPrice.toFixed(2)} for one recorded pint`} · hours unverified</small>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PlanRecapEditor({
  recap,
  saving,
  onChange,
  onSave,
}: {
  recap: PendingPlanRecap;
  saving: boolean;
  onChange: (recap: PendingPlanRecap) => void;
  onSave: () => void;
}) {
  const updateStopCaption = (position: number, caption: string) => {
    onChange({
      ...recap,
      stops: recap.stops.map((stop) => stop.position === position ? { ...stop, caption } : stop),
    });
  };
  return (
    <form className="nightCard__recap" onSubmit={(event) => { event.preventDefault(); onSave(); }}>
      <div>
        <strong>Private recap preview</strong>
        <p>Only the route and words you approve are saved. Nothing is posted as a Story.</p>
      </div>
      <label>
        <span>Name this Memory</span>
        <input
          value={recap.title}
          maxLength={120}
          required
          onChange={(event) => onChange({ ...recap, title: event.target.value })}
        />
      </label>
      <ol>
        {recap.stops.map((stop) => (
          <li key={stop.venueId}>
            <strong>{stop.venueName}</strong>
            <textarea
              value={stop.caption}
              maxLength={500}
              rows={2}
              placeholder="Add an optional private caption"
              aria-label={`Private caption for ${stop.venueName}`}
              onChange={(event) => updateStopCaption(stop.position, event.target.value)}
            />
          </li>
        ))}
      </ol>
      <button type="submit" className="nightCard__endingLink" disabled={saving || !recap.title.trim()}>
        {saving ? "Saving privately…" : "Save private Memory"}
      </button>
    </form>
  );
}

function NightEndingResult({
  ending,
  currentStop,
  lateFood,
  stationName,
  leaveByIso,
  keepGoingExtension,
}: {
  ending: CrawlEnding;
  currentStop: PlanStopDTO;
  lateFood: LateFoodTerminal[];
  stationName: string | null;
  leaveByIso: string | null;
  keepGoingExtension: KeepGoingExtension | null;
}) {
  if (ending === "food") {
    return (
      <div className="nightCard__endingResult" data-ending="food">
        <strong>Food nearby</strong>
        {lateFood.length > 0 ? (
          <ul className="nightCard__foodList">
            {lateFood.slice(0, 3).map((terminal) => (
              <li key={terminal.id}>
                <span>{terminal.name}</span>
                <small>
                  {terminal.category} · {terminal.walkingDetour.minutes === null ? "distance pending" : `${terminal.walkingDetour.minutes} min direct-distance estimate`} ·{" "}
                  {terminal.confidence} confidence
                </small>
              </li>
            ))}
          </ul>
        ) : (
          <p>Food options for this Night Area still need review. Check the map before walking.</p>
        )}
        <p className="nightCard__endingFineprint">
          Kitchen hours can change; verify tonight before leaving the last pub.
        </p>
      </div>
    );
  }

  if (ending === "keep_going") {
    return (
      <div className="nightCard__endingResult" data-ending="keep_going">
        <strong>Keep it feasible</strong>
        <p>
          {keepGoingExtension ? `${keepGoingExtension.name} is your reviewed extension from ${currentStop.venueName}.` : `Open the map around ${currentStop.venueName} and choose something genuinely nearby.`}
          {" "}PUBMAXX will not reward extra drinking or volume.
        </p>
        <Link
          className="nightCard__endingLink"
          href={`/map?venue=${encodeURIComponent(keepGoingExtension?.id ?? currentStop.venueId)}`}
        >
          {keepGoingExtension ? `Open ${keepGoingExtension.name} on the map` : "Find nearby pubs"}
        </Link>
      </div>
    );
  }

  return (
    <div className="nightCard__endingResult" data-ending="get_home">
      <strong>Get home safe</strong>
      <p>
        {leaveByIso ? "Use the leave-by time above and start moving now." : "Check TfL or your preferred route home before leaving the group."}
        {stationName ? ` Nearest rail signal: ${stationName}.` : ""}
      </p>
    </div>
  );
}

function NightStopSignal({ signal }: { signal: PlanGetInStopDTO | null }) {
  if (!signal?.busyness) return null;
  const closed = signal.busyness.isOpen === false;
  return (
    <span className="nightCard__busy">
      <span className="nightCard__dot" data-level={signal.busyness.level} aria-hidden="true" />
      {closed ? "Likely closed now" : signal.busyness.label}
    </span>
  );
}

function LastTrainLine({ leaveByIso, stationName }: { leaveByIso: string; stationName: string | null }) {
  // Tick a live "minutes left" off the leave-by instant the last-ride feed
  // computed. Honest: we only ever show the leave-by clock the feed gave us.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const leaveBy = Date.parse(leaveByIso);
  if (Number.isNaN(leaveBy)) return null;
  const minsLeft = Math.round((leaveBy - now) / 60_000);
  const clock = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(new Date(leaveBy));

  const urgent = minsLeft <= 20;
  return (
    <div className="nightCard__train" data-urgent={urgent ? "" : undefined}>
      <TrainFront size={15} aria-hidden="true" />
      <span>
        {minsLeft > 0 ? (
          <>
            Leave by <strong>{clock}</strong> · {minsLeft}m left
          </>
        ) : (
          <>Last train window has passed — check TfL</>
        )}
        {stationName ? <span className="nightCard__station"> · {stationName}</span> : null}
      </span>
    </div>
  );
}
