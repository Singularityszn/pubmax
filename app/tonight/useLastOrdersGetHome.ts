"use client";

// The Get home line's answer. It keeps the RAW /api/last-train answer and
// words it against the live clock on every render, so "Leave in 10 min" turns
// into "Leave-by time has passed" when the deadline does, rather than staying
// as the sentence written when the answer arrived. Service status moves during
// a night, so the answer itself is asked for again every few minutes while the
// panel is open.
//
// AN ANSWER HAS AN AGE. Its age is read from the answer's own `generatedAt`
// stamp (when the server composed it), or, when that stamp is missing or
// unreadable, from the moment a NETWORK reply arrived here. A copy from the
// tab's cache with no readable stamp has no age we can stand behind, so it is
// stale. Past GET_HOME_MAX_AGE_MS the line says the time is out of date and
// names none. That holds whether the next refresh hangs, fails, or answers
// with the same old cached copy (loadSurfaceJson can hand back a snapshot
// after a failed network read).
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

/** Past this age a held answer is out of date: two refreshes have been missed. */
export const GET_HOME_MAX_AGE_MS = 2 * GET_HOME_REFRESH_MS;

export type GetHome =
  | { status: "no-location" }
  | { status: "loading" }
  | { status: "none" }
  /** We hold an answer, but it is older than GET_HOME_MAX_AGE_MS. */
  | { status: "stale" }
  | { status: "ready"; summary: GetHomeSummary };

type Held = {
  key: string;
  result: LastTrainResult | null;
  /** When the answer was composed, in ms, or null when nothing says so. */
  observedAt: number | null;
};

/** The age stamp a held answer can stand behind, or null when it has none. */
export function getHomeObservedAt(
  result: Pick<LastTrainResult, "generatedAt"> | null,
  source: "snapshot" | "network",
  receivedAt: number,
): number | null {
  const stamped = result ? Date.parse(result.generatedAt) : Number.NaN;
  if (Number.isFinite(stamped)) return stamped;
  return source === "network" ? receivedAt : null;
}

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
      (body, source) =>
        setHeld({ key: answerKey, result: body, observedAt: getHomeObservedAt(body, source, Date.now()) }),
    ).then((outcome) => {
      // A failed read with nothing held says there is no answer. A failed read
      // that fell back to a cached copy keeps that copy, and its age decides.
      if (outcome === "failed" && !controller.signal.aborted) {
        setHeld({ key: answerKey, result: null, observedAt: null });
      }
    });
    return () => controller.abort();
  }, [lat, lng, round]);

  return useMemo<GetHome>(() => {
    if (!origin) return { status: "no-location" };
    if (held?.key !== key || !now) return { status: "loading" };
    const summary = held.result ? summariseGetHome(held.result, now) : null;
    if (!summary) return { status: "none" };
    if (held.observedAt === null || now.getTime() - held.observedAt > GET_HOME_MAX_AGE_MS) {
      return { status: "stale" };
    }
    return { status: "ready", summary };
  }, [origin, held, key, now]);
}
