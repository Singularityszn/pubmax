"use client";

import { useEffect, useState } from "react";

import {
  isPlanActiveNow,
  readActivePlan,
  subscribeActivePlan,
} from "@/lib/activePlan";
import type { PlanState, PlanStopDTO } from "@/lib/plan";

// C2 — the map's view of "is a plan on tonight, and what are its stops". Reuses
// the SAME client pointer (lib/activePlan) that drives the Night Mode shell card:
// when a plan is inside its active window we pull its ordered stops so the map
// can draw them through the existing crawl route paint. No active plan (or a
// pointer that's aged out of its window) → empty stops → no overlay. This hook
// carries data only; PubMap resolves the stops to venues against its live venue
// index and hands them to the existing `route` prop — one paint path, no second
// route renderer.

// Re-check the active-time window on this cadence so a plan that ages out of its
// span (start + POST) retires the map overlay without a navigation, mirroring
// useActivePlan's own WINDOW_TICK_MS. The window edges are hours wide, so 60s is
// plenty and stays off the paint/RAF hot path.
const WINDOW_TICK_MS = 60_000;

/**
 * Ordered stops of the plan that's on tonight, or [] when nothing is live.
 * SSR-safe: returns [] on the server / first paint (the active-plan pointer is
 * client-only), then upgrades after mount — no hydration mismatch.
 */
export function useActivePlanRoute(): PlanStopDTO[] {
  const [stops, setStops] = useState<PlanStopDTO[]>([]);

  useEffect(() => {
    let active = true;
    // The plan whose stops are currently loaded, so a window re-tick or an
    // unrelated active-plan event (stopIndex bump, focus) doesn't refetch the
    // same plan. Cleared when no plan is live so a plan that re-enters its
    // window later refetches cleanly.
    let loadedId = "";
    const controller = new AbortController();

    const load = () => {
      const ref = readActivePlan();
      if (!ref || !isPlanActiveNow(ref, Date.now())) {
        loadedId = "";
        if (active) setStops([]);
        return;
      }
      if (ref.id === loadedId) return; // already have this plan's stops
      loadedId = ref.id;
      fetch(`/api/plans/${ref.id}`, { cache: "no-store", signal: controller.signal })
        .then((res) => (res.ok ? res.json() : null))
        .then((body: PlanState | null) => {
          if (!active) return;
          setStops(body && Array.isArray(body.stops) ? body.stops : []);
        })
        .catch(() => {
          // Network / abort / bad JSON — honest-empty, never a stale overlay.
          if (active) {
            // Allow a later event to retry (the fetch didn't land).
            if (loadedId === ref.id) loadedId = "";
            setStops([]);
          }
        });
    };

    load();
    const unsub = subscribeActivePlan(load);
    const timer = window.setInterval(load, WINDOW_TICK_MS);
    return () => {
      active = false;
      controller.abort();
      unsub();
      window.clearInterval(timer);
    };
  }, []);

  return stops;
}
