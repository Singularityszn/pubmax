"use client";

// Selected venue → viewer travel summary. Walking is instant and city-agnostic;
// TfL is London-only, abortable, and fail-soft.

import { useEffect, useMemo, useState } from "react";

import { formatJourneySummary } from "@/lib/formatJourney";
import { walkLabel as formatWalkLabel, walkMinutes as estimateWalkMinutes } from "@/lib/tonight";
import {
  optimalJourney,
  type JourneyPoint,
  type VenueJourney,
  type VenueJourneyLeg,
} from "@/lib/venueJourney";

export type VenueJourneyStatus = "idle" | "loading" | "ready" | "empty" | "error";

export type VenueJourneyResult = {
  walkMinutes: number | null;
  walkLabel: string | null;
  journeys: VenueJourney[];
  status: VenueJourneyStatus;
  bestSummary: string | null;
};

type FetchState = {
  key: string;
  journeys: VenueJourney[];
  status: VenueJourneyStatus;
};

const EMPTY_JOURNEYS: VenueJourney[] = [];
const INITIAL_STATE: FetchState = {
  key: "",
  journeys: EMPTY_JOURNEYS,
  status: "idle",
};

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseLeg(value: unknown): VenueJourneyLeg | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const mode = optionalString(raw.mode);
  if (!mode) return null;

  const leg: VenueJourneyLeg = { mode };
  const summary = optionalString(raw.summary);
  const durationMinutes = optionalNumber(raw.durationMinutes);
  const departureTime = optionalString(raw.departureTime);
  const arrivalTime = optionalString(raw.arrivalTime);
  if (summary) leg.summary = summary;
  if (durationMinutes !== undefined) leg.durationMinutes = durationMinutes;
  if (departureTime) leg.departureTime = departureTime;
  if (arrivalTime) leg.arrivalTime = arrivalTime;
  return leg;
}

function parseJourneys(value: unknown): VenueJourney[] {
  if (!Array.isArray(value)) return EMPTY_JOURNEYS;

  const journeys: VenueJourney[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const durationMinutes = optionalNumber(raw.durationMinutes);
    if (durationMinutes === undefined || durationMinutes < 0 || !Array.isArray(raw.legs)) {
      continue;
    }
    const legs = raw.legs
      .map(parseLeg)
      .filter((leg): leg is VenueJourneyLeg => leg !== null);
    if (legs.length === 0) continue;

    const journey: VenueJourney = { durationMinutes, legs };
    const departureTime = optionalString(raw.departureTime);
    const arrivalTime = optionalString(raw.arrivalTime);
    if (departureTime) journey.departureTime = departureTime;
    if (arrivalTime) journey.arrivalTime = arrivalTime;
    journeys.push(journey);
  }
  return journeys;
}

function requestKey(
  user: JourneyPoint | null,
  venue: JourneyPoint | null,
  enabled: boolean,
): string {
  if (
    !enabled ||
    !user ||
    !venue ||
    !Number.isFinite(user.lat) ||
    !Number.isFinite(user.lng) ||
    !Number.isFinite(venue.lat) ||
    !Number.isFinite(venue.lng)
  ) {
    return "";
  }
  return `${user.lat},${user.lng}:${venue.lat},${venue.lng}`;
}

export function useVenueJourney(
  user: JourneyPoint | null,
  venue: JourneyPoint | null,
  enabled: boolean,
): VenueJourneyResult {
  const userLat = user?.lat;
  const userLng = user?.lng;
  const venueLat = venue?.lat;
  const venueLng = venue?.lng;
  const estimatedMinutes = useMemo(
    () => estimateWalkMinutes(user, venue),
    [user, venue],
  );
  const estimatedLabel = formatWalkLabel(estimatedMinutes);
  const key = requestKey(user, venue, enabled);
  const [fetchState, setFetchState] = useState<FetchState>(INITIAL_STATE);

  useEffect(() => {
    const controller = new AbortController();
    const defer = (update: () => void) => {
      void Promise.resolve().then(() => {
        if (!controller.signal.aborted) update();
      });
    };

    if (
      !key ||
      userLat === undefined ||
      userLng === undefined ||
      venueLat === undefined ||
      venueLng === undefined
    ) {
      defer(() => setFetchState(INITIAL_STATE));
      return () => controller.abort();
    }

    defer(() =>
      setFetchState({
        key,
        journeys: EMPTY_JOURNEYS,
        status: "loading",
      }),
    );

    const params = new URLSearchParams({
      fromLat: String(userLat),
      fromLng: String(userLng),
      toLat: String(venueLat),
      toLng: String(venueLng),
      limit: "3",
    });

    void fetch(`/api/citymcp/journey?${params}`, {
      signal: controller.signal,
      headers: { accept: "application/json" },
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Journey request failed (${response.status})`);
        return (await response.json()) as unknown;
      })
      .then((body) => {
        if (controller.signal.aborted) return;
        const record =
          body && typeof body === "object" ? (body as Record<string, unknown>) : null;
        const journeys = parseJourneys(record?.journeys);
        const hasError = typeof record?.error === "string" && record.error.trim().length > 0;
        defer(() =>
          setFetchState({
            key,
            journeys,
            status: journeys.length > 0 ? "ready" : hasError ? "error" : "empty",
          }),
        );
      })
      .catch(() => {
        if (controller.signal.aborted) return;
        defer(() =>
          setFetchState({
            key,
            journeys: EMPTY_JOURNEYS,
            status: "error",
          }),
        );
      });

    return () => controller.abort();
  }, [key, userLat, userLng, venueLat, venueLng]);

  const currentState =
    key.length === 0
      ? INITIAL_STATE
      : fetchState.key === key
        ? fetchState
        : { key, journeys: EMPTY_JOURNEYS, status: "loading" as const };
  const best = optimalJourney(currentState.journeys);

  return {
    walkMinutes: estimatedMinutes,
    walkLabel: estimatedLabel,
    journeys: currentState.journeys,
    status: currentState.status,
    bestSummary: best ? formatJourneySummary(best) : null,
  };
}
