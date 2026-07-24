import type { CityId } from "@/lib/cities";
import type { PlanningIntentArea } from "@/lib/planningIntent";

/**
 * Shared, client-safe contract for the canonical planning anchor. The server
 * resolver (`planningAnchor.server.ts`) owns the actual venue lookup; this file
 * only holds the vocabulary both sides agree on so a client can render the
 * privacy-safe display and read a machine-readable conflict.
 */

export const ANCHOR_CONFLICT_CODES = [
  "ANCHOR_VENUE_INVALID",
  "ANCHOR_CITY_MISMATCH",
  "ANCHOR_AREA_CONFLICT",
  "ANCHOR_PROMOTED",
  "ANCHOR_SAFETY_EXCLUDED",
  "ANCHOR_OPENING_CONFLICT",
  "ANCHOR_BUDGET_CONFLICT",
  "ANCHOR_ACCESS_CONFLICT",
  "ANCHOR_ROUTE_CONFLICT",
] as const;

export type AnchorConflictCode = (typeof ANCHOR_CONFLICT_CODES)[number];

/** Honest freshness of the recomputed price evidence, mirroring Tonight's split. */
export type PlanningAnchorFreshnessKind =
  | "provider-observed"
  | "dataset-generated"
  | "unknown";

export type PlanningAnchorPriceEvidence = {
  kind: "price" | "whats-on" | "directory";
  label: string;
  observedAt: string | null;
  freshnessKind: PlanningAnchorFreshnessKind;
};

/**
 * Privacy-safe projection of the person's own accepted Venue. It carries no
 * server-internal scoring, no alternative venues, and no Route — only what the
 * acceptance surface needs to confirm "same Venue, same context".
 */
export type PlanningAnchorDisplayDTO = {
  venueId: string;
  venueName: string;
  areaName: string | null;
  startLabel: string | null;
  priceEvidence: PlanningAnchorPriceEvidence | null;
  routeWindowOk: boolean;
  budgetCompatible: boolean;
  accessibilityCompatible: boolean;
};

/**
 * Canonical machine context fed verbatim into anchored generation. Server-owned
 * in practice, but the type is shared so the generation seam cannot drift.
 */
export type PlanningAnchorCanonical = {
  cityId: CityId;
  venueId: string;
  nightAreaSlug: string | null;
  acceptedArea: PlanningIntentArea;
  coordinates: { lat: number; lng: number } | null;
  startsAt: string | null;
  priceObservedAt: string | null;
  priceFreshnessKind: PlanningAnchorFreshnessKind;
};

export type PlanningAnchorResolved = {
  status: "resolved";
  display: PlanningAnchorDisplayDTO;
  canonical: PlanningAnchorCanonical;
};

export type PlanningAnchorConflict = {
  status: "conflict";
  code: AnchorConflictCode;
  message: string;
};

export type PlanningAnchorResult = PlanningAnchorResolved | PlanningAnchorConflict;

const ANCHOR_CONFLICT_MESSAGES: Record<AnchorConflictCode, string> = {
  ANCHOR_VENUE_INVALID: "We could not find that Venue. Choose a Venue to build your Plan around.",
  ANCHOR_CITY_MISMATCH: "That Venue is not in this city. Pick a Venue in the same city as your night.",
  ANCHOR_AREA_CONFLICT: "That Venue sits outside your accepted area. Keep the area or accept a Venue inside it.",
  ANCHOR_PROMOTED: "That Venue cannot anchor a Plan. Choose a Venue you accepted from real results.",
  ANCHOR_SAFETY_EXCLUDED: "That Venue is currently excluded. Choose another Venue to anchor your Plan.",
  ANCHOR_OPENING_CONFLICT: "That Venue is not open for your chosen time. Adjust the time or accept another Venue.",
  ANCHOR_BUDGET_CONFLICT: "That Venue does not fit your budget. Raise the budget or accept another Venue.",
  ANCHOR_ACCESS_CONFLICT: "That Venue does not meet your access needs. Accept a Venue that does.",
  ANCHOR_ROUTE_CONFLICT: "We could not build a Route from that Venue right now. Try a different anchor.",
};

export function isAnchorConflictCode(value: unknown): value is AnchorConflictCode {
  return typeof value === "string" && (ANCHOR_CONFLICT_CODES as readonly string[]).includes(value);
}

/** Build a canonical conflict with a privacy-safe message (never names the Venue). */
export function planningAnchorConflict(code: AnchorConflictCode): PlanningAnchorConflict {
  return { status: "conflict", code, message: ANCHOR_CONFLICT_MESSAGES[code] };
}
