import type { PlanState, PlanStopDTO } from "@/lib/plan";
import { planScheduledEndMs } from "@/lib/inviteExpiry";
import { cleanText } from "@/lib/textClean";

export const PLAN_BEACON_SYMBOLS = [
  { id: "star", label: "Star", glyph: "★" },
  { id: "moon", label: "Moon", glyph: "☾" },
  { id: "diamond", label: "Diamond", glyph: "◆" },
  { id: "circle", label: "Circle", glyph: "●" },
] as const;
export type PlanBeaconSymbol = (typeof PLAN_BEACON_SYMBOLS)[number]["id"];
export const PLAN_BEACON_NOTE_MAX = 160;
const PLAN_BEACON_TTL_MS = 2 * 60 * 60 * 1000;

type BeaconStop = Pick<PlanStopDTO, "venueId" | "venueName" | "position">;
export type PlanBeacon = {
  symbol: PlanBeaconSymbol;
  note: string;
  expiresAt: string;
};
export type PlanBeaconView = {
  visibility: "member";
  canEdit: boolean;
  routeRevision: number;
  arrivalId: string | null;
  current: BeaconStop | null;
  next: BeaconStop | null;
  beacon: PlanBeacon | null;
};
export type PlanBeaconInput = {
  symbol?: unknown;
  note?: unknown;
  expectedRouteRevision?: unknown;
  expectedArrivalId?: unknown;
};

export function cleanPlanBeacon(input: PlanBeaconInput): { symbol: PlanBeaconSymbol; note: string } | null {
  const symbol = PLAN_BEACON_SYMBOLS.find((candidate) => candidate.id === input.symbol)?.id;
  if (!symbol || typeof input.note !== "string" || [...input.note].length > PLAN_BEACON_NOTE_MAX) return null;
  return { symbol, note: cleanText(input.note, PLAN_BEACON_NOTE_MAX) };
}

/** A recorded arrival names the pub. The device's next-stop cursor does not. */
export function planBeaconLocation(state: PlanState, now: Date): Omit<PlanBeaconView, "visibility" | "canEdit" | "beacon"> {
  const routeRevision = Number(state.plan.routeRevision ?? 1);
  const empty = { routeRevision, arrivalId: null, current: null, next: null };
  const end = planScheduledEndMs(state.plan.startTime);
  if (!Number.isInteger(routeRevision) || routeRevision < 1 || end === null || now.getTime() >= end
    || state.plan.status === "completed" || state.plan.status === "abandoned" || state.plan.status === "ending") return empty;
  const latest = state.actions?.at(-1);
  if (!latest || latest.type !== "arrived" || latest.stopPosition === null
    || !("routeRevision" in latest) || latest.routeRevision !== routeRevision) return empty;
  if (state.actions?.filter((action) => action.createdAt === latest.createdAt).length !== 1) return empty;
  const stops = [...state.stops].sort((a, b) => a.position - b.position);
  const index = stops.findIndex((stop) => stop.position === latest.stopPosition);
  const current = stops[index];
  if (!current || latest.venueId !== current.venueId) return empty;
  return { routeRevision, arrivalId: latest.id, current: stopView(current), next: stops[index + 1] ? stopView(stops[index + 1]!) : null };
}

function stopView(stop: PlanStopDTO): BeaconStop {
  return { venueId: stop.venueId, venueName: stop.venueName, position: stop.position };
}

export function planBeaconExpiry(startTime: string, now: Date): string | null {
  const end = planScheduledEndMs(startTime);
  return end === null || end <= now.getTime() ? null : new Date(Math.min(now.getTime() + PLAN_BEACON_TTL_MS, end)).toISOString();
}
