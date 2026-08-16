// Browser-safe helpers for the price-evidence mission read.
// The request carries Venue IDs only. The DTO is the same closed shape the
// route writes: venue, reason, optional category, optional observation date.

import { isDrinkCategory } from "@/lib/drinks";
import { discardBody } from "@/lib/responseBody";
import {
  isPriceEvidenceMissionReason,
  MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS,
  parsePriceEvidenceMissionVenueIds,
  type PriceEvidenceMission,
} from "@/lib/priceEvidenceMissions";

export type PriceEvidenceMissionRead =
  | { status: "ready"; mission: PriceEvidenceMission | null }
  | { status: "degraded"; mission: PriceEvidenceMission | null };

export type PriceEvidenceMissionRequest = {
  promise: Promise<PriceEvidenceMissionRead>;
  signal: AbortSignal;
  abort: () => void;
};

export function buildPriceEvidenceMissionUrl(
  venueIds: readonly string[],
): string | null {
  const parsed = parsePriceEvidenceMissionVenueIds(
    venueIds.slice(0, MAX_PRICE_EVIDENCE_MISSION_VENUE_IDS),
  );
  if (!parsed.ok) return null;
  const params = new URLSearchParams();
  for (const venueId of parsed.venueIds) params.append("venueId", venueId);
  return `/api/price-missions?${params.toString()}`;
}

function isPriceEvidenceMission(value: unknown): value is PriceEvidenceMission {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.some((key) => !["venueId", "reason", "drinkCategory", "observedAt"].includes(key))) {
    return false;
  }
  if (typeof candidate.venueId !== "string" || candidate.venueId.length === 0) {
    return false;
  }
  if (!isPriceEvidenceMissionReason(candidate.reason)) return false;
  if (
    candidate.drinkCategory !== undefined &&
    !isDrinkCategory(candidate.drinkCategory)
  ) {
    return false;
  }
  if (
    candidate.observedAt !== undefined &&
    (typeof candidate.observedAt !== "number" || !Number.isFinite(candidate.observedAt))
  ) {
    return false;
  }
  return true;
}

export function parsePriceEvidenceMissionResponse(
  value: unknown,
): PriceEvidenceMissionRead | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate);
  if (keys.length !== 2 || !keys.includes("status") || !keys.includes("mission")) {
    return null;
  }
  if (candidate.status !== "ready" && candidate.status !== "degraded") return null;
  if (candidate.mission !== null && !isPriceEvidenceMission(candidate.mission)) {
    return null;
  }
  return {
    status: candidate.status,
    mission: candidate.mission,
  };
}

export function startPriceEvidenceMissionRequest(
  requestUrl: string,
  fetcher: typeof fetch = fetch,
): PriceEvidenceMissionRequest {
  const controller = new AbortController();
  const promise = fetcher(requestUrl, {
    cache: "no-store",
    credentials: "same-origin",
    signal: controller.signal,
  }).then(async (response) => {
    if (!response.ok) {
      discardBody(response);
      throw new Error("price evidence mission read failed");
    }
    const body: unknown = await response.json();
    const parsed = parsePriceEvidenceMissionResponse(body);
    if (!parsed) throw new Error("price evidence mission response invalid");
    return parsed;
  });
  return {
    promise,
    signal: controller.signal,
    abort: () => controller.abort(),
  };
}

export function dismissedVenueIds(keys: ReadonlySet<string>): Set<string> {
  const ids = new Set<string>();
  for (const key of keys) {
    const venueId = key.split("\u0000")[0];
    if (venueId) ids.add(venueId);
  }
  return ids;
}
