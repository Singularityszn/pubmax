"use client";

// The Get home line's answer. It keeps the RAW /api/last-train answer and
// words it against the live clock on every render, so "Leave in 10 min" turns
// into "Leave-by time has passed" when the deadline does, rather than staying
// as the sentence written when the answer arrived. Service status moves during
// a night, so the answer itself is asked for again every few minutes while the
// panel is open.
//
// The read is the same one the location block's strip makes, with the same
// coarsened point (about 110 m), so the two share one cached answer.

import { useEffect, useMemo, useState } from "react";

import { coarsenViewerPoint } from "@/lib/geo";
import { loadSurfaceJson } from "@/lib/surfaceDataCache";
import type { LastTrainResult } from "@/lib/tfl";
import { summariseGetHome, type GetHomeSummary } from "@/lib/tonightGetHome";

/** How often a held train answer is asked for again while the panel is open. */
export const GET_HOME_REFRESH_MS = 3 * 60_000;

export type GetHome =
  | { status: "no-location" }
  | { status: "loading" }
  | { status: "none" }
  | { status: "ready"; summary: GetHomeSummary };

type Held = { key: string; result: LastTrainResult | null };

export function useLastOrdersGetHome(
  origin: { lat: number; lng: number } | null,
  now: Date | null,
): GetHome {
  const [held, setHeld] = useState<Held | null>(null);
  const [round, setRound] = useState(0);
  const key = origin ? `${origin.lat},${origin.lng}` : "";
  const lat = origin?.lat ?? null;
  const lng = origin?.lng ?? null;

  useEffect(() => {
    if (lat === null || lng === null) return;
    const timer = window.setInterval(() => setRound((count) => count + 1), GET_HOME_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [lat, lng]);

  useEffect(() => {
    if (lat === null || lng === null) return;
    const controller = new AbortController();
    const point = coarsenViewerPoint({ lat, lng });
    const answerKey = `${lat},${lng}`;
    void loadSurfaceJson<LastTrainResult>(
      `/api/last-train?lat=${point.lat}&lng=${point.lng}`,
      {
        signal: controller.signal,
        // A held answer older than one refresh is not shown as current.
        maxAgeMs: GET_HOME_REFRESH_MS,
        validate: (body) => Boolean(body && typeof body === "object" && "station" in body && "trains" in body),
      },
      (body) => setHeld({ key: answerKey, result: body }),
    ).then((outcome) => {
      // A failed refresh keeps no stale answer: it says there is none.
      if (outcome === "failed" && !controller.signal.aborted) setHeld({ key: answerKey, result: null });
    });
    return () => controller.abort();
  }, [lat, lng, round]);

  return useMemo<GetHome>(() => {
    if (!origin) return { status: "no-location" };
    if (held?.key !== key || !now) return { status: "loading" };
    const summary = held.result ? summariseGetHome(held.result, now) : null;
    return summary ? { status: "ready", summary } : { status: "none" };
  }, [origin, held, key, now]);
}
