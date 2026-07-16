import type { CrewMemberDTO } from "@/lib/crew";
import { cleanText } from "@/lib/textClean";
import type { NightContext } from "@/lib/nightPlanning";

export const PLAN_TITLE_MAX = 80;
export const PLAN_STOP_MAX = 8;
export const PLAN_VENUE_ID_MAX = 80;
export const PLAN_VENUE_NAME_MAX = 120;

export type PlanDTO = {
  id: string;
  title: string;
  startTime: string;
  createdAt: string;
  /** Incremented only when the canonical ordered Crawl Route is replaced. Legacy records read as revision 1. */
  routeRevision?: number | string;
  /** Defaults to draft for legacy Plan records created before Planned Night lifecycle metadata. */
  status?: PlannedNightStatus;
};

export const PLANNED_NIGHT_STATUSES = ["draft", "ready", "active", "ending", "completed", "abandoned"] as const;
export type PlannedNightStatus = (typeof PLANNED_NIGHT_STATUSES)[number];
export type CrawlEnding = "food" | "get_home" | "keep_going";
export type PlanMemberRole = "host" | "guest";
export type PlanActionDTO = { id: string; type: "arrived" | "skipped" | "swapped" | "ending"; stopPosition: number | null; ending: CrawlEnding | null; createdAt: string };

const PLAN_TRANSITIONS: Record<PlannedNightStatus, readonly PlannedNightStatus[]> = {
  draft: ["ready", "abandoned"], ready: ["draft", "active", "abandoned"], active: ["ending", "completed", "abandoned"],
  ending: ["active", "completed", "abandoned"], completed: [], abandoned: [],
};

export function canTransitionPlannedNight(from: PlannedNightStatus, to: PlannedNightStatus): boolean {
  return from === to || PLAN_TRANSITIONS[from].includes(to);
}

export type PlanStopDTO = {
  venueId: string;
  venueName: string;
  position: number;
};

export type PlanState = {
  plan: PlanDTO;
  stops: PlanStopDTO[];
  crew: CrewMemberDTO[];
  context?: NightContext | null;
  actions?: PlanActionDTO[];
  ending?: CrawlEnding | null;
};

/** A share-safe completed Planned Night record. Member identifiers stay server-only. */
export type PlanQualifyingArrivalDTO = {
  actionId: string;
  stopPosition: number;
  arrivedAt: string;
};

export type PlanCompletionDTO = {
  id: string;
  planId: string;
  ending: CrawlEnding;
  terminalVenueId: string | null;
  finalPintDropId: string | null;
  routeRevision: number;
  routeSnapshot: PlanStopDTO[];
  /** Null only for legacy completion rows created before the v1 arrival gate. */
  qualifyingArrival: PlanQualifyingArrivalDTO | null;
  completedAt: string;
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
