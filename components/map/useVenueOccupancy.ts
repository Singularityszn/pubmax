"use client";

// One occupancy read for any surface. Desk mode can adopt this later.
// The hook never caches: a now answer ages every minute.

import { useCallback, useEffect, useState } from "react";

import { accountBoundFetch, type AccountAuthSnapshot } from "@/lib/accountBoundFetch";
import { trackEvent } from "@/lib/analytics";
import { errorMessageFrom } from "@/lib/apiErrorMessage";
import { discardBody } from "@/lib/responseBody";
import {
  occupancyNowFromReports,
  parseOccupancyLevel,
  type OccupancyLevel,
  type OccupancyNowAnswer,
} from "@/lib/occupancy";

export type OccupancySurface = "venue-sheet" | "pal";

export type VenueOccupancyReading = OccupancyNowAnswer;

function failedReading(): VenueOccupancyReading {
  return occupancyNowFromReports([], Date.now(), { degraded: true });
}

function parseReading(body: unknown): VenueOccupancyReading {
  if (!body || typeof body !== "object") return failedReading();
  const row = body as Record<string, unknown>;
  if (row.degraded === true) return failedReading();
  const now = parseOccupancyLevel(row.now);
  const ageMinutes =
    typeof row.ageMinutes === "number" && Number.isFinite(row.ageMinutes)
      ? Math.max(0, Math.floor(row.ageMinutes))
      : null;
  const reportsLast90 =
    typeof row.reportsLast90 === "number" && Number.isFinite(row.reportsLast90)
      ? Math.max(0, Math.floor(row.reportsLast90))
      : 0;
  const state =
    row.state === "fresh" ||
    row.state === "stale" ||
    row.state === "none" ||
    row.state === "degraded"
      ? row.state
      : now
        ? "fresh"
        : "none";
  return {
    now: now && ageMinutes != null ? now : null,
    ageMinutes: now ? ageMinutes : null,
    reportsLast90,
    degraded: false,
    state,
  };
}

export async function fetchVenueOccupancy(
  venueId: string,
): Promise<VenueOccupancyReading> {
  try {
    const res = await fetch(
      `/api/venues/${encodeURIComponent(venueId)}/occupancy`,
    );
    if (!res.ok) {
      discardBody(res);
      return failedReading();
    }
    return parseReading(await res.json());
  } catch {
    return failedReading();
  }
}

export async function postVenueOccupancy(
  venueId: string,
  level: OccupancyLevel,
  auth: AccountAuthSnapshot,
): Promise<
  | { ok: true; reading: VenueOccupancyReading }
  | { ok: false; error: string }
> {
  try {
    const res = await accountBoundFetch(
      auth,
      `/api/venues/${encodeURIComponent(venueId)}/occupancy`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ level }),
      },
    );
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: unknown };
      return {
        ok: false,
        error: errorMessageFrom(body, "Could not save that crowd report."),
      };
    }
    return { ok: true, reading: parseReading(await res.json()) };
  } catch {
    return { ok: false, error: "Could not save that crowd report." };
  }
}

export async function confirmOccupancyProposal(
  input: { venueId: string; level: OccupancyLevel },
  auth: AccountAuthSnapshot | null,
  surface: OccupancySurface,
): Promise<
  | { ok: true; reading: VenueOccupancyReading }
  | { ok: false; error: string; needsSignIn?: boolean }
> {
  if (!auth) {
    return {
      ok: false,
      error: "Sign in to report how busy it is.",
      needsSignIn: true,
    };
  }
  const result = await postVenueOccupancy(input.venueId, input.level, auth);
  if (!result.ok) return result;
  trackEvent("occupancy_reported", { level: input.level, surface });
  trackEvent("occupancy_read", { state: result.reading.state });
  return result;
}

export function useVenueOccupancy(venueId: string, active = true) {
  const [reading, setReading] = useState<VenueOccupancyReading | null>(null);
  const [reporting, setReporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const next = await fetchVenueOccupancy(venueId);
    setReading(next);
    return next;
  }, [venueId]);

  useEffect(() => {
    if (!active || !venueId) return;
    let cancelled = false;
    void fetchVenueOccupancy(venueId).then((next) => {
      if (!cancelled) setReading(next);
    });
    return () => {
      cancelled = true;
    };
  }, [active, venueId]);

  const report = useCallback(
    async (level: OccupancyLevel, auth: AccountAuthSnapshot) => {
      setReporting(true);
      setError(null);
      const result = await postVenueOccupancy(venueId, level, auth);
      setReporting(false);
      if (!result.ok) {
        setError(result.error);
        return result;
      }
      setReading(result.reading);
      return result;
    },
    [venueId],
  );

  return { reading, report, reporting, error, reload };
}
