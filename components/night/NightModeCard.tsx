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
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronRight, MapPin, PlusCircle, TrainFront, X } from "lucide-react";

import {
  dismissNightMode,
  restoreNightMode,
  setActivePlanStopIndex,
  clampStopIndex,
  markNightModeActiveFired,
  type ActivePlanRef,
} from "@/lib/activePlan";
import { trackEvent } from "@/lib/analytics";
import type { PlanGetInReportDTO, PlanGetInStopDTO } from "@/lib/planGetIn";
import type { CrawlEnding, PlanState, PlanStopDTO } from "@/lib/plan";
import type { CrewMemberDTO } from "@/lib/crew";
import { lastRideFetchUrl } from "@/lib/lastRide";
import type { LateFoodApiResponse, LateFoodTerminal } from "@/lib/lateFood";
import RouteEndingCard, { type RouteEndingId } from "@/components/night/RouteEndingCard";
import { useActivePlan } from "@/components/night/useActivePlan";
import "./nightMode.css";

type VenueCoord = { id: string; lat: number; lng: number };

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
  if (typeof window === "undefined") return "";
  try {
    return window.sessionStorage.getItem(`pubmax-plan-member:${planId}`) ?? "";
  } catch {
    return "";
  }
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

export function confirmedEndingForPlan(
  plan: PlanState | null,
  confirmedChoice: CrawlEnding | null,
): CrawlEnding | null {
  return plan?.ending ?? confirmedChoice;
}

export default function NightModeCard() {
  const { ref, visible, dismissed } = useActivePlan();

  if (dismissed && ref) return <NightModePill id={ref.id} />;
  if (!visible || !ref) return null;
  // Key by plan id so a plan switch remounts the sheet fresh — React otherwise
  // preserves the prior plan's route/crew/last-train state until refetch lands.
  return <NightModeSheet key={ref.id} entry={ref} />;
}

function NightModePill({ id }: { id: string }) {
  return (
    <button
      type="button"
      className="nightPill"
      onClick={() => restoreNightMode(id)}
      aria-label="Show tonight's plan"
    >
      <MapPin size={15} aria-hidden="true" />
      Tonight
    </button>
  );
}

function NightModeSheet({ entry }: { entry: ActivePlanRef }) {
  const { id, stopIndex } = entry;
  const [plan, setPlan] = useState<PlanState | null>(null);
  const [report, setReport] = useState<PlanGetInReportDTO | null>(null);
  const [coords, setCoords] = useState<VenueCoord[] | null>(null);
  const [lateFood, setLateFood] = useState<LateFoodTerminal[]>([]);
  const [chosenEnding, setChosenEnding] = useState<CrawlEnding | null>(null);
  const [endingSaving, setEndingSaving] = useState(false);
  const [endingError, setEndingError] = useState("");
  // Store the last-train result tagged with the venue it belongs to, so a result
  // from a previous stop is never rendered against the current one (the tag is
  // checked at read time — cheaper and lint-cleaner than a clear-in-effect).
  const [lastTrain, setLastTrain] = useState<{ venueId: string; data: LastTrainSlim } | null>(null);
  const [dragY, setDragY] = useState(0);
  const dragStart = useRef<number | null>(null);
  // Track the live drag distance in a ref too: a fast pointer-up can fire before
  // the dragY state commit, so release must read the ref, not stale state.
  const dragYRef = useRef(0);

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

  useEffect(() => {
    const area = plan?.context?.nightArea;
    if (!area) {
      void Promise.resolve().then(() => setLateFood([]));
      return;
    }
    let active = true;
    fetch(`/api/late-food?area=${encodeURIComponent(area)}&limit=3`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((body: LateFoodApiResponse | null) => {
        if (active) setLateFood(Array.isArray(body?.terminals) ? body.terminals : []);
      })
      .catch(() => {
        if (active) setLateFood([]);
      });
    return () => {
      active = false;
    };
  }, [plan?.context?.nightArea]);

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

  const chooseEnding = useCallback(async (ending: RouteEndingId) => {
    if (!plan || endingSaving) return;
    if (ending === "food") {
      setChosenEnding("food");
      setEndingError("Food is a reviewed suggestion list for now. Pick a place, then choose Get home or Keep going to complete the plan.");
      trackEvent("planned_night_action", { type: "food_preview" });
      return;
    }
    const memberToken = readMemberToken(id);
    setEndingSaving(true);
    setEndingError("");
    try {
      const response = await fetch(`/api/plans/${id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ memberToken, type: "ending", ending }),
      });
      const body = response.ok ? (await response.json() as PlanState) : null;
      if (!response.ok || !body?.plan) throw new Error("Could not save that ending.");
      setPlan(body);
      setChosenEnding(ending);
      trackEvent("planned_night_completed", { ending });
    } catch {
      setEndingError("Could not save that ending. Nothing was completed yet — try again when the connection settles.");
    } finally {
      setEndingSaving(false);
    }
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
    if (dragStart.current !== null && dragYRef.current > SWIPE_DISMISS_PX) dismissNightMode(id);
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

  return (
    <section
      className="nightCard"
      aria-label="Tonight's plan"
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
          type="button"
          className="nightCard__close"
          onClick={() => dismissNightMode(id)}
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
            description="Choose the ending that fits the group. PubMax saves the choice only after you tap."
            recommendedId={recommendedEnding}
            onChoose={chooseEnding}
          />
          {endingSaving ? (
            <p className="nightCard__endingStatus" role="status">Saving the ending…</p>
          ) : null}
          {endingError ? (
            <p className="nightCard__endingError" role="alert">{endingError}</p>
          ) : null}
          {activeEnding ? (
            <NightEndingResult
              ending={activeEnding}
              currentStop={currentStop}
              lateFood={lateFood}
              stationName={currentTrain?.station?.name ?? null}
              leaveByIso={lastTrainLeaveBy}
            />
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

function NightEndingResult({
  ending,
  currentStop,
  lateFood,
  stationName,
  leaveByIso,
}: {
  ending: CrawlEnding;
  currentStop: PlanStopDTO;
  lateFood: LateFoodTerminal[];
  stationName: string | null;
  leaveByIso: string | null;
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
                  {terminal.category} · {terminal.walkingDetour.minutes} min detour ·{" "}
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
          Open the map around {currentStop.venueName} and choose something genuinely nearby.
          PubMax will not reward extra drinking or volume.
        </p>
        <Link
          className="nightCard__endingLink"
          href={`/map?venue=${encodeURIComponent(currentStop.venueId)}`}
        >
          Find nearby pubs
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
