"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { INTERCEPT_ETA_OPTIONS, recommendCrawlIntercept } from "@/lib/crawlIntercept";
import type { PlanState } from "@/lib/plan";

const POLL_INTERVAL_MS = 20_000;
const STATUS_LIFETIME_MS = 2_800;
const DEFAULT_ETA = INTERCEPT_ETA_OPTIONS[1];
const inMemoryEta = new Map<string, (typeof INTERCEPT_ETA_OPTIONS)[number]>();

function etaStorageKey(planId: string): string {
  return `pubmax:join-in-motion-eta:${planId}`;
}

function etaStorageEvent(planId: string): string {
  return `pubmax:join-in-motion-eta-change:${planId}`;
}

function readStoredEta(planId: string): (typeof INTERCEPT_ETA_OPTIONS)[number] {
  if (typeof window === "undefined") return DEFAULT_ETA;
  try {
    const raw = window.sessionStorage.getItem(etaStorageKey(planId));
    if (raw === null) return inMemoryEta.get(planId) ?? DEFAULT_ETA;
    const stored = Number(raw);
    return INTERCEPT_ETA_OPTIONS.includes(stored as (typeof INTERCEPT_ETA_OPTIONS)[number])
      ? stored as (typeof INTERCEPT_ETA_OPTIONS)[number]
      : inMemoryEta.get(planId) ?? DEFAULT_ETA;
  } catch {
    return inMemoryEta.get(planId) ?? DEFAULT_ETA;
  }
}

function isPlanState(value: unknown): value is PlanState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PlanState>;
  return Boolean(candidate.plan && Array.isArray(candidate.stops) && Array.isArray(candidate.crew));
}

function etaLabel(minutes: number): string {
  return minutes === 0 ? "Leaving now" : `${minutes} min`;
}

function recommendationNote(kind: "current" | "ahead" | "final", hasProgress: boolean): string {
  if (!hasProgress && kind === "current") return "No check-in yet, so the first pub is the honest place to start.";
  if (!hasProgress && kind === "final") return "No check-in yet. For this ETA, the final pub is the safest place to aim.";
  if (!hasProgress) return "No check-in yet. This is an ETA estimate from the crawl's first stop.";
  if (kind === "current") return "Crew check-ins still point here. Head for this stop now.";
  if (kind === "final") return "The crawl may reach its final stop before you do. Aim there and message the crew.";
  return "Crew check-ins put the night here around the time you arrive.";
}

export default function JoinInMotion({ planId, initialState }: { planId: string; initialState: PlanState }) {
  const [plan, setPlan] = useState(initialState);
  const [shareStatus, setShareStatus] = useState("");
  const statusTimerRef = useRef<number | null>(null);
  const etaMinutes = useSyncExternalStore(
    (onChange) => {
      const event = etaStorageEvent(planId);
      window.addEventListener("storage", onChange);
      window.addEventListener(event, onChange);
      return () => {
        window.removeEventListener("storage", onChange);
        window.removeEventListener(event, onChange);
      };
    },
    () => readStoredEta(planId),
    () => DEFAULT_ETA,
  );

  useEffect(() => {
    let intervalId: number | null = null;
    let controller: AbortController | null = null;
    let mounted = true;

    const refresh = async () => {
      controller?.abort();
      controller = new AbortController();
      try {
        const response = await fetch(`/api/plans/${planId}`, {
          cache: "no-store",
          signal: controller.signal,
        });
        if (!response.ok) return;
        const body: unknown = await response.json();
        if (mounted && isPlanState(body)) setPlan(body);
      } catch {
        // A catch-up recommendation is still useful from the last confirmed state.
      }
    };

    const stopPolling = () => {
      if (intervalId !== null) window.clearInterval(intervalId);
      intervalId = null;
      controller?.abort();
      controller = null;
    };

    const startPolling = () => {
      stopPolling();
      if (document.visibilityState !== "visible") return;
      void refresh();
      intervalId = window.setInterval(() => {
        if (document.visibilityState === "visible") void refresh();
      }, POLL_INTERVAL_MS);
    };

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") startPolling();
      else stopPolling();
    };

    startPolling();
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      mounted = false;
      stopPolling();
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [planId]);

  useEffect(() => () => {
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
  }, []);

  const recommendation = useMemo(
    () => recommendCrawlIntercept(plan, etaMinutes),
    [etaMinutes, plan],
  );
  const hasProgress = Boolean(plan.actions?.some(
    (action) => action.stopPosition !== null && (action.type === "arrived" || action.type === "skipped"),
  ));

  const chooseEta = useCallback((minutes: (typeof INTERCEPT_ETA_OPTIONS)[number]) => {
    inMemoryEta.set(planId, minutes);
    try {
      window.sessionStorage.setItem(etaStorageKey(planId), String(minutes));
    } catch {
      // Storage-restricted sessions still keep the selection for this render.
    }
    window.dispatchEvent(new Event(etaStorageEvent(planId)));
  }, [planId]);

  const announceShare = useCallback((message: string) => {
    setShareStatus(message);
    if (statusTimerRef.current !== null) window.clearTimeout(statusTimerRef.current);
    statusTimerRef.current = window.setTimeout(() => {
      setShareStatus("");
      statusTimerRef.current = null;
    }, STATUS_LIFETIME_MS);
  }, []);

  const tellCrew = useCallback(async () => {
    if (!recommendation) return;
    const stopNumber = recommendation.targetIndex + 1;
    const text = `I’m aiming for stop ${stopNumber}, ${recommendation.stop.venueName}. See you there.`;
    const url = window.location.href;

    if (typeof navigator.share === "function") {
      try {
        await navigator.share({ title: "Catch the PUBMAXX crawl", text, url });
        announceShare("Catch-up note shared.");
        return;
      } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") return;
      }
    }

    try {
      await navigator.clipboard.writeText(`${text} ${url}`);
      announceShare("Catch-up note copied.");
    } catch {
      announceShare("Could not copy the note. Share this Plan link instead.");
    }
  }, [announceShare, recommendation]);

  const directionsUrl = recommendation
    ? `https://www.google.com/maps/dir/?api=1&travelmode=walking&destination=${encodeURIComponent(`${recommendation.stop.venueName}, London`)}`
    : null;

  return (
    <section className="joinInMotion" aria-labelledby="join-in-motion-title">
      <div className="joinInMotion__heading">
        <p className="joinInMotion__eyebrow">JOIN IN MOTION</p>
        <h2 id="join-in-motion-title">Running late? Catch the crawl, not the group chat.</h2>
        <p className="joinInMotion__intro">
          Pick when you can leave. Crew check-ins choose the stop. Your location stays yours.
        </p>
      </div>

      <fieldset className="joinInMotion__eta">
        <legend>When are you setting off?</legend>
        <div className="joinInMotion__etaOptions">
          {INTERCEPT_ETA_OPTIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              className="joinInMotion__etaChip"
              aria-pressed={etaMinutes === minutes}
              onClick={() => chooseEta(minutes)}
            >
              {etaLabel(minutes)}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="joinInMotion__result" aria-live="polite" aria-atomic="true">
        {recommendation ? (
          <>
            <div className="joinInMotion__stopMarker" aria-hidden="true">
              <span>{recommendation.targetIndex + 1}</span>
            </div>
            <div className="joinInMotion__resultCopy">
              <p className="joinInMotion__aim">Aim for stop {recommendation.targetIndex + 1}</p>
              <h3>{recommendation.stop.venueName}</h3>
              <p className="joinInMotion__note">{recommendationNote(recommendation.kind, hasProgress)}</p>
            </div>
          </>
        ) : (
          <div className="joinInMotion__resultCopy joinInMotion__resultCopy--empty">
            <p className="joinInMotion__aim">No honest intercept yet</p>
            <h3>Ask the crew before setting off.</h3>
            <p className="joinInMotion__note">A crew check-in will give us enough signal to choose a stop.</p>
          </div>
        )}
      </div>
      <p className="joinInMotion__method">Estimate allows about 35 minutes per pub and updates from confirmed crew check-ins.</p>

      {recommendation && directionsUrl ? (
        <div className="joinInMotion__actions">
          <a href={directionsUrl} target="_blank" rel="noreferrer">
            Find walking directions
            <span aria-hidden="true">↗</span>
          </a>
          <button type="button" onClick={() => void tellCrew()}>
            Tell the crew
          </button>
        </div>
      ) : null}

      <p className="joinInMotion__status" role="status" aria-live="polite">
        {shareStatus}
      </p>
    </section>
  );
}
