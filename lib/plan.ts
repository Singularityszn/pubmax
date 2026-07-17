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

export type EndingEvidenceSnapshot = {
  label: string;
  confidence: "high" | "medium" | "low" | "unknown";
  source?: string;
  observedAt?: string;
  warnings?: string[];
};

/**
 * The exact option a host confirmed at the end of a Plan. `terminalVenueId`
 * remains the final canonical pub for compatibility; this additive snapshot
 * preserves the selected food, transport, or extension instead of replacing
 * it with that pub id.
 */
type EndingSelectionBase = {
  optionId: string;
  evidenceSnapshot: EndingEvidenceSnapshot;
};

export type EndingSelection =
  | (EndingSelectionBase & { kind: "food"; externalPlaceId: string })
  | (EndingSelectionBase & { kind: "get_home" })
  | (EndingSelectionBase & { kind: "keep_going"; venueId: string });

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
  endingSelection?: EndingSelection | null;
  finalPintDropId: string | null;
  routeRevision: number;
  routeSnapshot: PlanStopDTO[];
  /** Null only for legacy completion rows created before the v1 arrival gate. */
  qualifyingArrival: PlanQualifyingArrivalDTO | null;
  completedAt: string;
};

const ENDING_CONFIDENCE = ["high", "medium", "low", "unknown"] as const;

export function cleanEndingSelection(value: unknown, ending?: CrawlEnding): EndingSelection | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  const kind = row.kind === "food" || row.kind === "get_home" || row.kind === "keep_going" ? row.kind : null;
  if (!kind || (ending && kind !== ending)) return null;
  const optionId = cleanText(row.optionId, 120);
  const venueId = cleanText(row.venueId, PLAN_VENUE_ID_MAX);
  const externalPlaceId = cleanText(row.externalPlaceId, 120);
  const evidence = row.evidenceSnapshot && typeof row.evidenceSnapshot === "object" && !Array.isArray(row.evidenceSnapshot)
    ? row.evidenceSnapshot as Record<string, unknown>
    : null;
  const label = cleanText(evidence?.label, 160);
  const confidence = ENDING_CONFIDENCE.includes(evidence?.confidence as (typeof ENDING_CONFIDENCE)[number])
    ? evidence?.confidence as EndingEvidenceSnapshot["confidence"]
    : null;
  if (!optionId || !label || !confidence) return null;
  const source = cleanText(evidence?.source, 240);
  const observedAt = typeof evidence?.observedAt === "string" && Number.isFinite(Date.parse(evidence.observedAt))
    ? new Date(evidence.observedAt).toISOString()
    : undefined;
  const warnings = Array.isArray(evidence?.warnings)
    ? evidence.warnings.map((warning) => cleanText(warning, 200)).filter(Boolean).slice(0, 6)
    : [];
  const evidenceSnapshot: EndingEvidenceSnapshot = {
      label,
      confidence,
      ...(source ? { source } : {}),
      ...(observedAt ? { observedAt } : {}),
      ...(warnings.length ? { warnings } : {}),
  };
  if (kind === "food") return externalPlaceId ? { kind, optionId, externalPlaceId, evidenceSnapshot } : null;
  if (kind === "keep_going") return venueId ? { kind, optionId, venueId, evidenceSnapshot } : null;
  return { kind, optionId, evidenceSnapshot };
}

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
