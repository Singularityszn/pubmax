import type { PlanState, PlanStopDTO } from "@/lib/plan";
import { cleanSelectedDrinkPriceEvidence } from "@/lib/planSelectedDrinkPriceEvidence";
import { isPlanStopCount } from "@/lib/planStopCount";
import { haversineKm } from "@/lib/haversine";

export type SlidingDoorsKind = "original" | "shorter-walk" | "plot-twist";
export type SlidingDoorsOption = {
  kind: SlidingDoorsKind;
  stops: PlanStopDTO[];
  groundingProof?: string;
  operationKey?: string;
  straightLineKm: number | null;
};

export type SlidingDoorsPoints = ReadonlyMap<string, readonly [number, number]>;

/** A proposal must leave the accepted pub and the actioned prefix in place. */
export function proposalPreservesNight(state: PlanState, stops: readonly PlanStopDTO[]): boolean {
  const original = [...state.stops].sort((a, b) => a.position - b.position);
  const proposed = [...stops].sort((a, b) => a.position - b.position);
  if (state.plan.anchorVenueId && proposed[0]?.venueId !== state.plan.anchorVenueId) return false;
  const actioned = new Set((state.actions ?? [])
    .filter((action) => action.type === "arrived" || action.type === "skipped")
    .map((action) => action.stopPosition));
  const through = original.reduce((last, stop, index) => actioned.has(stop.position) ? index : last, -1);
  return original.slice(0, through + 1).every((stop, index) => proposed[index]?.venueId === stop.venueId);
}

function distance(stops: readonly PlanStopDTO[], points: SlidingDoorsPoints): number | null {
  const coords = stops.map((stop) => points.get(stop.venueId));
  if (coords.some((point) => !point)) return null;
  return coords.reduce((sum, point, index) => index === 0 ? sum : sum + haversineKm([...coords[index - 1]!], [...point!]), 0);
}

function stopsFrom(value: unknown): PlanStopDTO[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, position) => {
    if (!item || typeof item !== "object") return [];
    const row = item as Record<string, unknown>;
    if (typeof row.venueId !== "string" || !row.venueId.trim() || typeof row.venueName !== "string" || !row.venueName.trim()) return [];
    const evidence = cleanSelectedDrinkPriceEvidence(row.selectedDrinkPriceEvidence);
    return [{ venueId: row.venueId, venueName: row.venueName, position, ...(evidence ? { selectedDrinkPriceEvidence: evidence } : {}) }];
  });
}

export function slidingDoorsOptions(
  state: PlanState,
  generated: readonly { kind: Exclude<SlidingDoorsKind, "original">; body: unknown }[],
  points: SlidingDoorsPoints = new Map(),
): SlidingDoorsOption[] {
  const original = [...state.stops].sort((a, b) => a.position - b.position).map((stop) => ({ ...stop }));
  const originalKm = distance(original, points);
  const options: SlidingDoorsOption[] = [{ kind: "original", stops: original, straightLineKm: originalKm }];
  const routeKey = (stops: readonly PlanStopDTO[]) => JSON.stringify(stops.map((stop) => stop.venueId));
  const seen = new Set([routeKey(original)]);
  for (const candidate of generated) {
    if (!candidate.body || typeof candidate.body !== "object") continue;
    const body = candidate.body as Record<string, unknown>;
    const stops = stopsFrom(body.stops);
    if ((body.outcome !== "route" && body.grounded !== true) || body.outcome === "anchor-only" || !isPlanStopCount(stops.length) || stops.length !== original.length
      || new Set(stops.map((stop) => stop.venueId)).size !== stops.length || !proposalPreservesNight(state, stops)
      || typeof body.groundingProof !== "string" || !body.groundingProof || typeof body.operationKey !== "string" || body.operationKey.length < 8
      || seen.has(routeKey(stops)) || options.some((option) => option.kind === candidate.kind)) continue;
    const km = distance(stops, points);
    if (candidate.kind === "shorter-walk" && (km === null || originalKm === null || km >= originalKm - 0.05)) continue;
    seen.add(routeKey(stops));
    options.push({ kind: candidate.kind, stops, straightLineKm: km,
      groundingProof: body.groundingProof,
      operationKey: body.operationKey,
    });
  }
  return options;
}
