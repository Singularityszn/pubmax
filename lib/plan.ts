import type { CrewMemberDTO } from "@/lib/crew";
import { cleanText } from "@/lib/textClean";

export const PLAN_TITLE_MAX = 80;
export const PLAN_STOP_MAX = 8;
export const PLAN_VENUE_ID_MAX = 80;
export const PLAN_VENUE_NAME_MAX = 120;

export type PlanDTO = {
  id: string;
  title: string;
  startTime: string;
  createdAt: string;
};

export type PlanStopDTO = {
  venueId: string;
  venueName: string;
  position: number;
};

export type PlanState = {
  plan: PlanDTO;
  stops: PlanStopDTO[];
  crew: CrewMemberDTO[];
};

export type CreatePlanInput = {
  title?: unknown;
  startTime?: unknown;
  creatorName?: unknown;
  stops?: unknown;
};

export type CleanPlanInput = {
  title: string;
  startTime: string;
  creatorName: string;
  stops: Array<{ venueId: string; venueName: string }>;
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isPlanId(value: unknown): value is string {
  return typeof value === "string" && UUID_RE.test(value);
}

export function cleanCreatePlan(input: CreatePlanInput): CleanPlanInput | null {
  const creatorName = cleanText(input.creatorName, 40);
  if (!creatorName || typeof input.startTime !== "string" || !Array.isArray(input.stops)) return null;
  const startMs = Date.parse(input.startTime);
  if (!Number.isFinite(startMs)) return null;
  if (input.stops.length < 1 || input.stops.length > PLAN_STOP_MAX) return null;
  const stops = input.stops.map((raw) => {
    const row = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return {
      venueId: cleanText(row.venueId, PLAN_VENUE_ID_MAX),
      venueName: cleanText(row.venueName, PLAN_VENUE_NAME_MAX),
    };
  });
  if (stops.some((stop) => !stop.venueId || !stop.venueName)) return null;
  if (new Set(stops.map((stop) => stop.venueId)).size !== stops.length) return null;
  return {
    title: cleanText(input.title, PLAN_TITLE_MAX) || "Tonight's Plan",
    startTime: new Date(startMs).toISOString(),
    creatorName,
    stops,
  };
}
