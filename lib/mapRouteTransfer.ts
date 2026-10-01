import { PLANNING_INTENT_SOURCES, type PlanningIntentSource } from "@/lib/planningIntent";
import { isPlanStopCount } from "@/lib/planStopCount";
import { cleanSelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";
import {
  writePlanRouteDraftEnvelope,
  type ParsedPlanRouteDraft,
  type PlanRouteDraftOrigin,
  type PlanRouteDraftStorage,
} from "@/lib/planRouteDraft";

/**
 * L12 Map-to-Plan transfer seam. Maps a /api/plans/generate response into a
 * PlanRouteDraft V2 (origin "map-generated") so the Plan composer hydrates the
 * exact same Route — same Stops, order, anchor, and proof — without issuing a
 * second generation request. It only ever writes storage; it never fetches.
 * A malformed or incomplete Route maps to null and nothing is written. The
 * Map CTA keeps the current route visible when its transfer cannot be saved.
 */

type RawStop = {
  venueId?: unknown;
  venueName?: unknown;
  reason?: unknown;
  selectedDrinkPriceEvidence?: unknown;
  alternatives?: Array<{
    venueId?: unknown;
    venueName?: unknown;
    selectedDrinkPriceEvidence?: unknown;
  }>;
};

export type MapGeneratedRouteResponse = {
  outcome?: unknown;
  anchored?: unknown;
  anchorVenueId?: unknown;
  anchorSource?: unknown;
  groundingProof?: unknown;
  operationKey?: unknown;
  routeRevision?: unknown;
  stops?: RawStop[];
  inferredContext?: unknown;
  routeTotals?: unknown;
  planningConfidence?: unknown;
};

export type DisplayedMapRoute = readonly { id: string; name: string }[];

type RouteDraftValue = ParsedPlanRouteDraft["value"];
type RouteDraftAlternative = RouteDraftValue["stops"][number]["alternatives"][number];

function text(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function cleanAlternatives(raw: RawStop["alternatives"]): RouteDraftAlternative[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((alt): RouteDraftAlternative | null => {
      const venueId = text(alt?.venueId);
      const venueName = text(alt?.venueName);
      const price = cleanSelectedDrinkPriceEvidence(alt?.selectedDrinkPriceEvidence);
      return venueId && venueName
        ? { venueId, venueName, ...(price ? { selectedDrinkPriceEvidence: price } : {}) }
        : null;
    })
    .filter((alt): alt is RouteDraftAlternative => alt !== null);
}

/**
 * Build the route-draft value from a generation response, or null when the
 * Stops are missing or malformed. Downstream `writePlanRouteDraftEnvelope`
 * re-validates every field, so partial or inconsistent data still fails closed.
 */
export function mapGeneratedRouteDraftValue(
  body: MapGeneratedRouteResponse | null | undefined,
): RouteDraftValue | null {
  if (!body || typeof body !== "object" || !Array.isArray(body.stops) || body.stops.length < 1) return null;

  const stops = body.stops.map((raw, index) => {
    const venueId = text(raw?.venueId);
    const venueName = text(raw?.venueName);
    if (!venueId || !venueName) return null;
    const reason = text(raw?.reason);
    const price = cleanSelectedDrinkPriceEvidence(raw?.selectedDrinkPriceEvidence);
    return {
      key: index + 1,
      venueId,
      venueName,
      ...(reason ? { reason } : {}),
      ...(price ? { selectedDrinkPriceEvidence: price } : {}),
      alternatives: cleanAlternatives(raw?.alternatives),
    };
  });
  if (stops.some((stop) => stop === null)) return null;

  const anchoredOutcome = body.outcome === "route" || body.outcome === "anchor-only";
  const outcome = anchoredOutcome ? (body.outcome as "route" | "anchor-only") : "unanchored";
  const anchorVenueId = anchoredOutcome ? text(body.anchorVenueId) : null;
  const anchorSource = anchoredOutcome
    && typeof body.anchorSource === "string"
    && (PLANNING_INTENT_SOURCES as readonly string[]).includes(body.anchorSource)
    ? (body.anchorSource as PlanningIntentSource)
    : null;

  const confidence = body.planningConfidence as { warnings?: unknown } | null | undefined;
  const warnings = Array.isArray(confidence?.warnings)
    ? confidence.warnings.filter((warning): warning is string => typeof warning === "string")
    : [];
  const routeTotals = body.routeTotals as { distanceBasis?: unknown } | null | undefined;
  const transportBasis = routeTotals?.distanceBasis === "routed"
    ? "routed"
    : routeTotals
      ? "straight-line"
      : null;

  return {
    anchorVenueId,
    anchorSource,
    outcome,
    stops: stops as RouteDraftValue["stops"],
    alternatives: [],
    nightContext: (body.inferredContext ?? null) as RouteDraftValue["nightContext"],
    routeTotals: (body.routeTotals ?? null) as RouteDraftValue["routeTotals"],
    transportBasis,
    planningConfidence: (body.planningConfidence ?? null) as RouteDraftValue["planningConfidence"],
    warnings,
    groundingProof: text(body.groundingProof),
    operationKey: text(body.operationKey),
    routeRevision: typeof body.routeRevision === "number" || typeof body.routeRevision === "string"
      ? body.routeRevision
      : null,
    routeStale: false,
  };
}

/** Carry the route actually shown; client inspection never authenticates a proof. */
export function mapCurrentRouteDraftValue(
  body: MapGeneratedRouteResponse | null | undefined,
  displayedRoute: DisplayedMapRoute,
  releaseAnchor = false,
): RouteDraftValue | null {
  const original = mapGeneratedRouteDraftValue(body);
  const count = displayedRoute.length;
  if (!original || !isPlanStopCount(count)) return null;
  const ids = displayedRoute.map((venue) => text(venue.id));
  if (ids.some((id) => !id) || new Set(ids).size !== ids.length
    || displayedRoute.some((venue) => !text(venue.name))) return null;
  const originalIds = original.stops.map((stop) => stop.venueId);
  if (new Set(originalIds).size !== originalIds.length) return null;
  const unchanged = originalIds.length === ids.length && ids.every((id, index) => id === originalIds[index]);
  if (unchanged) return original;
  const movedAnchor = original.anchorVenueId !== null && ids[0] !== original.anchorVenueId;
  if (movedAnchor && !releaseAnchor) return null;
  const sameSet = originalIds.length === ids.length && ids.every((id) => originalIds.includes(id!));
  const keepCandidateProof = original.outcome === "unanchored" && sameSet;
  const routeIds = new Set(ids);
  const stops = displayedRoute.map((venue, index) => {
    const id = ids[index]!;
    const previous = keepCandidateProof ? original.stops.find((stop) => stop.venueId === id) : undefined;
    return previous ? {
      ...previous, key: index + 1,
      alternatives: previous.alternatives.filter((alternative) => !routeIds.has(alternative.venueId)),
    } : { key: index + 1, venueId: id, venueName: venue.name.trim(), alternatives: [] };
  });
  return {
    ...original,
    ...(movedAnchor ? { anchorVenueId: null, anchorSource: null, outcome: "unanchored" as const } : {}),
    stops,
    alternatives: [],
    nightContext: original.nightContext ? { ...original.nightContext, stopCount: count } : null,
    groundingProof: keepCandidateProof ? original.groundingProof : null,
    operationKey: keepCandidateProof ? original.operationKey : null,
    routeRevision: null,
    routeStale: !keepCandidateProof || !original.groundingProof || original.routeStale,
    routeTotals: null,
    transportBasis: null,
    planningConfidence: null,
    warnings: keepCandidateProof ? [] : ["You changed this route. Review a refreshed route before locking it in."],
  };
}

/**
 * Transfer a generate response into the Plan route draft. Returns true only
 * when the canonical V2 envelope was written. Storage exceptions and malformed
 * Routes are non-destructive and simply return false.
 */
export function transferGeneratedRouteToDraft(
  body: MapGeneratedRouteResponse | null | undefined,
  storage: PlanRouteDraftStorage | null,
  origin: PlanRouteDraftOrigin = "plan-generated",
  now = Date.now(),
): boolean {
  const value = mapGeneratedRouteDraftValue(body);
  if (!value || !storage) return false;
  return writePlanRouteDraftEnvelope(value, origin, storage, now).v2;
}

/**
 * Transfer a Map-generated Route into the Plan route draft. Returns true only
 * when the canonical V2 envelope was written. Storage exceptions and malformed
 * Routes are non-destructive and simply return false.
 */
export function transferMapRouteToDraft(
  body: MapGeneratedRouteResponse | null | undefined,
  storage: PlanRouteDraftStorage | null,
  now = Date.now(),
  displayedRoute?: DisplayedMapRoute,
  releaseAnchor = false,
): boolean {
  if (!displayedRoute) return transferGeneratedRouteToDraft(body, storage, "map-generated", now);
  const value = mapCurrentRouteDraftValue(body, displayedRoute, releaseAnchor);
  return Boolean(value && storage && writePlanRouteDraftEnvelope(value, "map-generated", storage, now).v2);
}
