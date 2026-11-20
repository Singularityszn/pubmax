"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { isUrgentTubeStatus } from "@/lib/mapChromeTiers";
import { loadSurfaceJson, SURFACE_JUST_READ_MS } from "@/lib/surfaceDataCache";
import { useReconnectRecovery } from "@/lib/useReconnectRecovery";
import type { CityId } from "@/lib/cities";

export type Signal = { headline?: string; detail?: string; kind?: string; severity?: string; timeWindow?: string; areas?: string[]; sourceUrl?: string };
type TubeLine = { line?: string; status?: string; disruption?: string };
type TflPayload = { asOf?: string | null; signals?: Signal[]; tubeLines?: TubeLine[]; error?: string };
export type MobileTflStatus = { payload: TflPayload | null; failed: boolean; issueCount: number; urgentCount: number };

const TFL_STATUS_SURFACE_KEY = "/api/citymcp/status";
const TFL_STATUS_MAX_AGE_MS = 60_000;

export function useMobileTflStatus(cityId: CityId): MobileTflStatus {
  const isLondon = cityId === "london";
  const [payload, setPayload] = useState<TflPayload | null>(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!isLondon) return;
    const controller = new AbortController();
    void loadSurfaceJson<TflPayload>(
      TFL_STATUS_SURFACE_KEY,
      {
        signal: controller.signal,
        init: { headers: { accept: "application/json" } },
        maxAgeMs: TFL_STATUS_MAX_AGE_MS,
        validate: (value) => Boolean(value && typeof value === "object"),
        freshForMs: SURFACE_JUST_READ_MS,
      },
      (value) => {
        setPayload(value);
        setFailed(false);
      },
    ).then((outcome) => {
      if (outcome === "failed" && !controller.signal.aborted) setFailed(true);
    });
    return () => controller.abort();
  }, [attempt, isLondon]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((value) => value + 1);
  }, []);

  useReconnectRecovery(isLondon && failed, retry);

  const issueCount = useMemo(
    () => (payload?.signals?.length ?? 0) + (payload?.tubeLines?.filter((line) => line.status?.toLowerCase() !== "good service").length ?? 0),
    [payload],
  );
  const urgentCount = useMemo(
    () => payload?.tubeLines?.filter((line) => isUrgentTubeStatus(line.status)).length ?? 0,
    [payload],
  );
  return isLondon
    ? { payload, failed, issueCount, urgentCount }
    : { payload: null, failed: false, issueCount: 0, urgentCount: 0 };
}
