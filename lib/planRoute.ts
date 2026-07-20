import { readFile } from "node:fs/promises";
import path from "node:path";

import { CITIES, type CityId } from "@/lib/cities";
import { loadConciergeVenues } from "@/lib/concierge/venues.server";
import { haversineKm } from "@/lib/haversine";
import type { PlanStopDTO } from "@/lib/plan";
import {
  PLAN_ACCESSIBILITY_NEEDS,
  PLAN_BUDGET_OPTIONS,
  PLAN_INTAKE_STEPS,
  PLAN_INTAKE_VERSION,
  PLAN_TIME_WINDOWS,
  londonDateTimeInputFromIso,
  londonDateTimeInputToIso,
  nightAreaForPlanIntakePatch,
  type PlanAccessibilityNeed,
  type PlanIntakeHandoff,
  type PlanIntakeStep,
  type PlanTimeWindowId,
} from "@/lib/planIntake";
import { NIGHT_PATCHES, type NightPatchId } from "@/lib/nightPatches";
import type { Budget, NightAreaSlug } from "@/lib/nightPlanning";
import type { VenueAccessibility } from "@/lib/venueAccessibility";
import { getVenueAccessibility } from "@/lib/venueAccessibilitySeeds";
import type { WetherspoonsPub } from "@/lib/wetherspoonsDirectory";

const LONDON_TIME_ZONE = "Europe/London";

/** A crawl uses three 50-minute stops with ten minutes to move between them. */
export const PLAN_STOP_MINUTES = 50;
export const PLAN_TRANSFER_MINUTES = 10;
export const PLAN_ROUTE_MINUTES = PLAN_STOP_MINUTES * 3 + PLAN_TRANSFER_MINUTES * 2;

/**
 * A deterministic walking-feasibility fence. These remain direct-distance
 * estimates, never a claim about a pavement route or a live transport service.
 */
export const MAX_PLAN_ROUTE_SEGMENT_KM = 1.6;
export const MAX_PLAN_ROUTE_WALKING_KM = 3;

export type PlanIntakeParseFailure = {
  ok: false;
  code: "INTAKE_VERSION_UNSUPPORTED" | "PLAN_INTAKE_MALFORMED" | "INTAKE_START_NOT_FUTURE";
  message: string;
};

export type ParsedPlanGenerationIntake = {
  handoff: PlanIntakeHandoff;
  exactNightArea: NightAreaSlug | null;
  unsupportedPatch: NightPatchId | null;
  exactStartIso: string | null;
  windowEndIso: string | null;
};

export type PlanIntakeParseResult =
  | { ok: true; value: ParsedPlanGenerationIntake }
  | PlanIntakeParseFailure;

export type PlanVisitWindow = { startsAt: string; endsAt: string };

export type PlanConstraintCode =
  | "safety"
  | "exclusions"
  | "exact_area"
  | "accessibility"
  | "budget_ceiling"
  | "opening_hours"
  | "transport_feasibility";

export type PlanConstraintDisclosure = {
  code: PlanConstraintCode;
  status: "satisfied" | "flagged";
  message: string;
};

export type PlanSoftRelaxation = {
  code: "group_fit_unverified" | "value_price_evidence_incomplete";
  message: string;
};

export type PlanConstraintReport = {
  version: 1;
  source: "plan-intake-v1";
  hardConstraints: PlanConstraintDisclosure[];
  softRelaxations: PlanSoftRelaxation[];
};

export type PlanStopConstraintFlag = {
  code: "opening_hours_unconfirmed";
  message: string;
};

export type PlanOpeningEvidence = {
  openAtVisit: readonly [boolean | null, boolean | null, boolean | null];
  source: { label: string; url: string; observedAt: string } | null;
};

export type GroundedPlanRouteCandidate<T> = {
  value: T;
  venueId: string;
  venueName: string;
  score: number;
  lat: number;
  lng: number;
  pricePence: number | null;
  promoted: boolean;
  avoidedByReviewedSignal: boolean;
  accessibility: VenueAccessibility | undefined;
  opening: PlanOpeningEvidence;
};

export type GroundedPlanRouteConstraints = {
  exactArea: NightAreaSlug | null;
  accessibilityNeeds: readonly PlanAccessibilityNeed[];
  budgetLimitPence: number | null;
  budgetTier: Budget | null;
  groupSize: number | null;
  transportConstraints: readonly string[];
  visitWindows: readonly PlanVisitWindow[];
};

export type SelectedGroundedPlanStop<T> = GroundedPlanRouteCandidate<T> & {
  position: number;
  constraintFlags: PlanStopConstraintFlag[];
};

export type GroundedPlanRouteSelection<T> =
  | {
      ok: true;
      stops: readonly [SelectedGroundedPlanStop<T>, SelectedGroundedPlanStop<T>, SelectedGroundedPlanStop<T>];
      alternatives: readonly [
        readonly GroundedPlanRouteCandidate<T>[],
        readonly GroundedPlanRouteCandidate<T>[],
        readonly GroundedPlanRouteCandidate<T>[],
      ];
      constraintReport: PlanConstraintReport;
    }
  | {
      ok: false;
      eligibleCandidateCount: number;
      rejected: {
        safety: number;
        exclusions: number;
        accessibility: number;
        budgetEvidence: number;
        budgetCeiling: number;
      };
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNightPatchId(value: unknown): value is NightPatchId {
  return typeof value === "string" && NIGHT_PATCHES.some((patch) => patch.id === value);
}

function isPlanIntakeStep(value: unknown): value is PlanIntakeStep {
  return typeof value === "string" && (PLAN_INTAKE_STEPS as readonly string[]).includes(value);
}

function londonClockMinutes(iso: string): number | null {
  const input = londonDateTimeInputFromIso(iso);
  if (!input) return null;
  const match = /T(\d{2}):(\d{2})$/.exec(input);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function presetContainsExactStart(windowId: PlanTimeWindowId, iso: string): boolean {
  const option = PLAN_TIME_WINDOWS.find((candidate) => candidate.id === windowId);
  const minute = londonClockMinutes(iso);
  if (!option || minute === null) return false;
  const [startHour, startMinute] = option.start.split(":").map(Number);
  const start = startHour * 60 + startMinute;
  if (option.end === null) return minute >= start || minute < 4 * 60;
  const [endHour, endMinute] = option.end.split(":").map(Number);
  const end = endHour * 60 + endMinute;
  return minute >= start && minute < end;
}

function exactWindowEndIso(windowId: PlanTimeWindowId, exactStartIso: string): string | null {
  const option = PLAN_TIME_WINDOWS.find((candidate) => candidate.id === windowId);
  if (!option) return null;
  if (option.end === null) {
    return new Date(Date.parse(exactStartIso) + PLAN_ROUTE_MINUTES * 60_000).toISOString();
  }
  const local = londonDateTimeInputFromIso(exactStartIso);
  if (!local) return null;
  return londonDateTimeInputToIso(`${local.slice(0, 10)}T${option.end}`, new Date(Date.parse(exactStartIso) - 1));
}

/**
 * Strictly parse the versioned client handoff. If `intake` is present the
 * server never falls back to a partial/older interpretation of malformed data.
 */
export function parsePlanGenerationIntake(raw: unknown, now = new Date()): PlanIntakeParseResult {
  if (!isRecord(raw)) {
    return { ok: false, code: "PLAN_INTAKE_MALFORMED", message: "Plan intake is malformed." };
  }
  if (raw.version !== PLAN_INTAKE_VERSION) {
    return { ok: false, code: "INTAKE_VERSION_UNSUPPORTED", message: "This Plan intake version is not supported." };
  }

  let area: PlanIntakeHandoff["area"] = null;
  if (raw.area !== null) {
    if (!isRecord(raw.area) || raw.area.kind !== "night-patch" || !isNightPatchId(raw.area.id)) {
      return { ok: false, code: "PLAN_INTAKE_MALFORMED", message: "Plan intake area is invalid." };
    }
    area = { kind: "night-patch", id: raw.area.id };
  }

  let timeWindow: PlanIntakeHandoff["timeWindow"] = null;
  let windowEndIso: string | null = null;
  if (raw.timeWindow !== null) {
    if (!isRecord(raw.timeWindow)) {
      return { ok: false, code: "PLAN_INTAKE_MALFORMED", message: "Plan intake time window is invalid." };
    }
    const timeRow = raw.timeWindow;
    const option = PLAN_TIME_WINDOWS.find((candidate) => candidate.id === timeRow.id);
    const timestamp = typeof timeRow.exactStartIso === "string"
      ? Date.parse(timeRow.exactStartIso)
      : Number.NaN;
    if (
      !option
      || timeRow.start !== option.start
      || timeRow.end !== option.end
      || !Number.isFinite(timestamp)
      || new Date(timestamp).toISOString() !== timeRow.exactStartIso
      || !presetContainsExactStart(option.id, timeRow.exactStartIso as string)
    ) {
      return { ok: false, code: "PLAN_INTAKE_MALFORMED", message: "Plan intake time window is invalid." };
    }
    if (timestamp <= now.getTime()) {
      return { ok: false, code: "INTAKE_START_NOT_FUTURE", message: "Choose a future start time." };
    }
    windowEndIso = exactWindowEndIso(option.id, timeRow.exactStartIso as string);
    if (!windowEndIso || Date.parse(windowEndIso) <= timestamp) {
      return { ok: false, code: "PLAN_INTAKE_MALFORMED", message: "Plan intake time window is invalid." };
    }
    timeWindow = {
      id: option.id,
      start: option.start,
      end: option.end,
      exactStartIso: new Date(timestamp).toISOString(),
    };
  }

  const groupSize = raw.groupSize === null
    ? null
    : typeof raw.groupSize === "number" && Number.isInteger(raw.groupSize) && raw.groupSize >= 1 && raw.groupSize <= 30
      ? raw.groupSize
      : undefined;
  if (groupSize === undefined) {
    return { ok: false, code: "PLAN_INTAKE_MALFORMED", message: "Plan intake group size is invalid." };
  }

  let budget: PlanIntakeHandoff["budget"] = null;
  if (raw.budget !== null) {
    if (!isRecord(raw.budget)) {
      return { ok: false, code: "PLAN_INTAKE_MALFORMED", message: "Plan intake budget is invalid." };
    }
    const budgetRow = raw.budget;
    if (!PLAN_BUDGET_OPTIONS.some((option) => option.budget === budgetRow.tier)) {
      return { ok: false, code: "PLAN_INTAKE_MALFORMED", message: "Plan intake budget is invalid." };
    }
    const limitPence = budgetRow.limitPence === null
      ? null
      : typeof budgetRow.limitPence === "number"
        && Number.isInteger(budgetRow.limitPence)
        && budgetRow.limitPence >= 500
        && budgetRow.limitPence <= 50_000
          ? budgetRow.limitPence
          : undefined;
    if (limitPence === undefined) {
      return { ok: false, code: "PLAN_INTAKE_MALFORMED", message: "Plan intake budget is invalid." };
    }
    budget = { tier: budgetRow.tier as NonNullable<PlanIntakeHandoff["budget"]>["tier"], limitPence };
  }

  if (
    !Array.isArray(raw.accessibilityNeeds)
    || !raw.accessibilityNeeds.every((need) =>
      typeof need === "string" && PLAN_ACCESSIBILITY_NEEDS.some((option) => option.id === need))
    || new Set(raw.accessibilityNeeds).size !== raw.accessibilityNeeds.length
  ) {
    return { ok: false, code: "PLAN_INTAKE_MALFORMED", message: "Plan intake accessibility needs are invalid." };
  }
  if (
    !Array.isArray(raw.skipped)
    || !raw.skipped.every(isPlanIntakeStep)
    || new Set(raw.skipped).size !== raw.skipped.length
  ) {
    return { ok: false, code: "PLAN_INTAKE_MALFORMED", message: "Plan intake skipped steps are invalid." };
  }

  const handoff: PlanIntakeHandoff = {
    version: PLAN_INTAKE_VERSION,
    area,
    timeWindow,
    groupSize,
    budget,
    accessibilityNeeds: [...raw.accessibilityNeeds] as PlanAccessibilityNeed[],
    skipped: [...raw.skipped] as PlanIntakeStep[],
  };
  const exactNightArea = area ? nightAreaForPlanIntakePatch(area.id) : null;
  return {
    ok: true,
    value: {
      handoff,
      exactNightArea,
      unsupportedPatch: area && !exactNightArea ? area.id : null,
      exactStartIso: timeWindow?.exactStartIso ?? null,
      windowEndIso,
    },
  };
}

export function planVisitWindows(intake: ParsedPlanGenerationIntake): readonly PlanVisitWindow[] | null {
  if (!intake.exactStartIso || !intake.windowEndIso) return [];
  const routeStart = Date.parse(intake.exactStartIso);
  const routeEnd = routeStart + PLAN_ROUTE_MINUTES * 60_000;
  if (routeEnd > Date.parse(intake.windowEndIso)) return null;
  return [0, 1, 2].map((position) => {
    const startsAt = routeStart + position * (PLAN_STOP_MINUTES + PLAN_TRANSFER_MINUTES) * 60_000;
    return {
      startsAt: new Date(startsAt).toISOString(),
      endsAt: new Date(startsAt + PLAN_STOP_MINUTES * 60_000).toISOString(),
    };
  });
}

/** Authoritative intake fields replace inference; skipped/null fields do not. */
export function parsedPlanIntakeContextPatch(
  intake: ParsedPlanGenerationIntake,
): Partial<{
  nightArea: NightAreaSlug;
  daypart: (typeof PLAN_TIME_WINDOWS)[number]["daypart"];
  groupSize: number;
  budget: Budget;
  budgetLimitPence: number | null;
  accessibility: PlanAccessibilityNeed[];
}> {
  const time = intake.handoff.timeWindow
    ? PLAN_TIME_WINDOWS.find((option) => option.id === intake.handoff.timeWindow?.id)
    : null;
  return {
    ...(intake.exactNightArea ? { nightArea: intake.exactNightArea } : {}),
    ...(time ? { daypart: time.daypart } : {}),
    ...(intake.handoff.groupSize !== null ? { groupSize: intake.handoff.groupSize } : {}),
    ...(intake.handoff.budget ? {
      budget: intake.handoff.budget.tier,
      budgetLimitPence: intake.handoff.budget.limitPence,
    } : {}),
    ...(intake.handoff.accessibilityNeeds.length > 0
      ? { accessibility: [...intake.handoff.accessibilityNeeds] }
      : {}),
  };
}

function accessibilityNeedSatisfied(
  accessibility: VenueAccessibility | undefined,
  need: PlanAccessibilityNeed,
): boolean {
  switch (need) {
    case "step-free": return accessibility?.stepFree === true;
    case "accessible-toilet": return accessibility?.accessibleToilet === true;
    case "seating": return accessibility?.seatedService === true;
    case "low-noise": return Boolean(accessibility?.quietHours?.trim());
  }
}

function walkingDistanceKm<T>(
  left: GroundedPlanRouteCandidate<T>,
  right: GroundedPlanRouteCandidate<T>,
): number {
  return haversineKm([left.lng, left.lat], [right.lng, right.lat]);
}

function routeWalkingFeasible<T>(route: readonly GroundedPlanRouteCandidate<T>[]): boolean {
  const first = walkingDistanceKm(route[0], route[1]);
  const second = walkingDistanceKm(route[1], route[2]);
  return first <= MAX_PLAN_ROUTE_SEGMENT_KM
    && second <= MAX_PLAN_ROUTE_SEGMENT_KM
    && first + second <= MAX_PLAN_ROUTE_WALKING_KM;
}

function routeOpeningFeasible<T>(route: readonly GroundedPlanRouteCandidate<T>[], hasWindow: boolean): boolean {
  return !hasWindow || route.every((candidate, position) => candidate.opening.openAtVisit[position] !== false);
}

function candidateFlags<T>(candidate: GroundedPlanRouteCandidate<T>, position: number, hasWindow: boolean): PlanStopConstraintFlag[] {
  return hasWindow && candidate.opening.openAtVisit[position] === null
    ? [{
        code: "opening_hours_unconfirmed",
        message: "Opening at this dated visit time is not confirmed. Check with the venue before relying on this stop.",
      }]
    : [];
}

function buildConstraintReport<T>(
  route: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
): PlanConstraintReport {
  const hasWindow = constraints.visitWindows.length === 3;
  const openingUnknown = hasWindow && route.some((candidate, position) => candidate.opening.openAtVisit[position] === null);
  const perVenueTransportUnknown = constraints.transportConstraints.length > 0;
  const hardConstraints: PlanConstraintDisclosure[] = [
    { code: "safety", status: "satisfied", message: "Stops with an active reviewed avoid signal were excluded." },
    { code: "exclusions", status: "satisfied", message: "Excluded and promoted venues were not eligible." },
    {
      code: "transport_feasibility",
      status: perVenueTransportUnknown ? "flagged" : "satisfied",
      message: perVenueTransportUnknown
        ? "The route passed compact direct-distance walking limits, but requested per-venue transport evidence is unavailable."
        : "The route passed compact direct-distance walking limits; pavement routing is not claimed.",
    },
    ...(constraints.exactArea ? [{
      code: "exact_area" as const,
      status: "satisfied" as const,
      message: "Every stop is inside the exact selected Night Patch generation area.",
    }] : []),
    ...(constraints.accessibilityNeeds.length ? [{
      code: "accessibility" as const,
      status: "satisfied" as const,
      message: "Every stop has confirmed evidence for every required accessibility need.",
    }] : []),
    ...(constraints.budgetLimitPence !== null ? [{
      code: "budget_ceiling" as const,
      status: "satisfied" as const,
      message: "The recorded one-pint-per-stop total is within the per-person ceiling.",
    }] : []),
    ...(hasWindow ? [{
      code: "opening_hours" as const,
      status: openingUnknown ? "flagged" as const : "satisfied" as const,
      message: openingUnknown
        ? "No stop is known closed, but one or more dated opening checks lack venue-level evidence."
        : "Every stop has venue-level opening evidence for its dated visit time.",
    }] : []),
  ];
  const softRelaxations: PlanSoftRelaxation[] = [
    ...((constraints.groupSize ?? 0) >= 6 ? [{
      code: "group_fit_unverified" as const,
      message: "Group size shaped ranking, but venue capacity is not evidenced in the dataset.",
    }] : []),
    ...(constraints.budgetTier === "value"
      && constraints.budgetLimitPence === null
      && route.some((candidate) => candidate.pricePence === null) ? [{
        code: "value_price_evidence_incomplete" as const,
        message: "The value preference was applied, but at least one selected stop has no recorded pint price.",
      }] : []),
  ];
  return { version: 1, source: "plan-intake-v1", hardConstraints, softRelaxations };
}

/**
 * Choose the highest-scoring feasible three-stop combination. Required access
 * and explicit ceilings fail closed on unknown evidence; known opening failure,
 * reviewed avoid signals and exclusions can never enter the result.
 */
export function selectGroundedPlanRoute<T>(
  candidates: readonly GroundedPlanRouteCandidate<T>[],
  constraints: GroundedPlanRouteConstraints,
): GroundedPlanRouteSelection<T> {
  const rejected = { safety: 0, exclusions: 0, accessibility: 0, budgetEvidence: 0, budgetCeiling: 0 };
  const eligible = candidates.filter((candidate) => {
    if (candidate.promoted) {
      rejected.exclusions += 1;
      return false;
    }
    if (candidate.avoidedByReviewedSignal) {
      rejected.safety += 1;
      return false;
    }
    if (!constraints.accessibilityNeeds.every((need) => accessibilityNeedSatisfied(candidate.accessibility, need))) {
      rejected.accessibility += 1;
      return false;
    }
    if (constraints.budgetLimitPence !== null && candidate.pricePence === null) {
      rejected.budgetEvidence += 1;
      return false;
    }
    if (constraints.budgetLimitPence !== null && candidate.pricePence! > constraints.budgetLimitPence) {
      rejected.budgetCeiling += 1;
      return false;
    }
    return true;
  }).sort((left, right) => right.score - left.score || left.venueId.localeCompare(right.venueId, "en-GB"));

  const hasWindow = constraints.visitWindows.length === 3;
  let best: readonly [GroundedPlanRouteCandidate<T>, GroundedPlanRouteCandidate<T>, GroundedPlanRouteCandidate<T>] | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  let bestKey = "";
  for (let first = 0; first < eligible.length - 2; first += 1) {
    for (let second = first + 1; second < eligible.length - 1; second += 1) {
      for (let third = second + 1; third < eligible.length; third += 1) {
        const route = [eligible[first], eligible[second], eligible[third]] as const;
        const priceTotal = route.reduce((total, candidate) => total + (candidate.pricePence ?? 0), 0);
        if (constraints.budgetLimitPence !== null && priceTotal > constraints.budgetLimitPence) continue;
        if (!routeOpeningFeasible(route, hasWindow) || !routeWalkingFeasible(route)) continue;
        const score = route.reduce((total, candidate) => total + candidate.score, 0);
        const key = route.map((candidate) => candidate.venueId).join("|");
        if (score > bestScore || (score === bestScore && (!bestKey || key.localeCompare(bestKey, "en-GB") < 0))) {
          best = route;
          bestScore = score;
          bestKey = key;
        }
      }
    }
  }

  if (!best) return { ok: false, eligibleCandidateCount: eligible.length, rejected };
  const stops = best.map((candidate, position) => ({
    ...candidate,
    position,
    constraintFlags: candidateFlags(candidate, position, hasWindow),
  })) as unknown as readonly [
    SelectedGroundedPlanStop<T>,
    SelectedGroundedPlanStop<T>,
    SelectedGroundedPlanStop<T>,
  ];
  const selectedIds = new Set(best.map((candidate) => candidate.venueId));
  const alternatives = best.map((_, position) => eligible.filter((candidate) => {
    if (selectedIds.has(candidate.venueId)) return false;
    const replacement = [...best] as GroundedPlanRouteCandidate<T>[];
    replacement[position] = candidate;
    const priceTotal = replacement.reduce((total, item) => total + (item.pricePence ?? 0), 0);
    return (constraints.budgetLimitPence === null || priceTotal <= constraints.budgetLimitPence)
      && routeOpeningFeasible(replacement, hasWindow)
      && routeWalkingFeasible(replacement);
  })) as unknown as readonly [
    readonly GroundedPlanRouteCandidate<T>[],
    readonly GroundedPlanRouteCandidate<T>[],
    readonly GroundedPlanRouteCandidate<T>[],
  ];
  return {
    ok: true,
    stops,
    alternatives,
    constraintReport: buildConstraintReport(best, constraints),
  };
}

type WetherspoonsSnapshot = { pubs?: unknown; generatedAt?: unknown };
let wetherspoonsEvidence: Promise<{ pubs: WetherspoonsPub[]; generatedAt: string } | null> | null = null;

async function loadWetherspoonsEvidence(): Promise<{ pubs: WetherspoonsPub[]; generatedAt: string } | null> {
  wetherspoonsEvidence ??= (async () => {
    try {
      const raw = JSON.parse(await readFile(path.join(process.cwd(), "public/data/wetherspoons/pubs.json"), "utf8")) as WetherspoonsSnapshot;
      if (!Array.isArray(raw.pubs) || typeof raw.generatedAt !== "string" || !Number.isFinite(Date.parse(raw.generatedAt))) return null;
      return { pubs: raw.pubs as WetherspoonsPub[], generatedAt: new Date(raw.generatedAt).toISOString() };
    } catch {
      return null;
    }
  })();
  return wetherspoonsEvidence;
}

function normalizedVenueName(value: string): string {
  return value
    .toLocaleLowerCase("en-GB")
    .normalize("NFKD")
    .replace(/[’']/g, "")
    .replace(/\([^)]*\)/g, " ")
    .replace(/\bjd wetherspoons?\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/^the\s+/, "");
}

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

function londonClock(iso: string): { weekday: string; minutes: number } | null {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return null;
  const formatter = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON_TIME_ZONE,
    weekday: "long",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  });
  const parts = formatter.formatToParts(new Date(timestamp));
  const weekday = parts.find((part) => part.type === "weekday")?.value;
  const hour = Number(parts.find((part) => part.type === "hour")?.value);
  const minute = Number(parts.find((part) => part.type === "minute")?.value);
  return weekday && Number.isFinite(hour) && Number.isFinite(minute)
    ? { weekday, minutes: hour * 60 + minute }
    : null;
}

function parseOpeningMinute(value: unknown): number | null {
  if (typeof value !== "string") return null;
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  return hour <= 29 && minute <= 59 ? hour * 60 + minute : null;
}

function openAt(pub: WetherspoonsPub, iso: string): boolean | null {
  if (Array.isArray(pub.statuses) && pub.statuses.length > 0 && !pub.statuses.includes("Open")) return false;
  const clock = londonClock(iso);
  if (!clock || !Array.isArray(pub.regularOpeningTimes) || pub.regularOpeningTimes.length === 0) return null;
  const weekdayIndex = WEEKDAY_NAMES.indexOf(clock.weekday as typeof WEEKDAY_NAMES[number]);
  if (weekdayIndex < 0) return null;
  for (const offset of [0, -1]) {
    const day = WEEKDAY_NAMES[(weekdayIndex + offset + 7) % 7];
    const rows = pub.regularOpeningTimes.filter((row) => row.day_of_the_week === day);
    for (const row of rows) {
      const opens = parseOpeningMinute(row.opening_time);
      const closes = parseOpeningMinute(row.closing_time);
      if (opens === null || closes === null) continue;
      const adjustedClose = closes <= opens ? closes + 24 * 60 : closes;
      const minute = offset === -1 ? clock.minutes + 24 * 60 : clock.minutes;
      if (minute >= opens && minute < adjustedClose) return true;
    }
  }
  return false;
}

function openingStateForVisit(pub: WetherspoonsPub, visit: PlanVisitWindow): boolean | null {
  const atStart = openAt(pub, visit.startsAt);
  const justBeforeEnd = openAt(pub, new Date(Date.parse(visit.endsAt) - 60_000).toISOString());
  if (atStart === false || justBeforeEnd === false) return false;
  return atStart === true && justBeforeEnd === true ? true : null;
}

/** First-party, snapshot-backed opening evidence; absence stays explicitly unknown. */
export async function planOpeningEvidenceForVenues(
  venues: readonly { id: string; name: string; area: string; lat: number; lng: number }[],
  visits: readonly PlanVisitWindow[],
): Promise<Map<string, PlanOpeningEvidence>> {
  const result = new Map<string, PlanOpeningEvidence>();
  const snapshot = visits.length === 3 ? await loadWetherspoonsEvidence() : null;
  for (const venue of venues) {
    let evidence: PlanOpeningEvidence = { openAtVisit: [null, null, null], source: null };
    if (snapshot) {
      const matching = snapshot.pubs
        .filter((pub) => normalizedVenueName(pub.name) === normalizedVenueName(venue.name))
        .filter((pub) => typeof pub.latitude === "number" && typeof pub.longitude === "number")
        .map((pub) => ({
          pub,
          distance: haversineKm([venue.lng, venue.lat], [pub.longitude!, pub.latitude!]),
        }))
        .filter(({ distance }) => distance <= 0.25)
        .sort((left, right) => left.distance - right.distance)[0]?.pub;
      if (matching) {
        evidence = {
          openAtVisit: visits.map((visit) => openingStateForVisit(matching, visit)) as [boolean | null, boolean | null, boolean | null],
          source: {
            label: matching.source.label,
            url: matching.source.url,
            observedAt: Number.isFinite(Date.parse(matching.observedAt))
              ? new Date(matching.observedAt).toISOString()
              : snapshot.generatedAt,
          },
        };
      }
    }
    result.set(venue.id, evidence);
  }
  return result;
}

export function planCandidateAccessibility(venueName: string, area: string): VenueAccessibility | undefined {
  return getVenueAccessibility(venueName, area);
}

/**
 * Rebuild a proposed route from the server-owned Venue Dataset. A Plan does not
 * persist a city yet, so replacement accepts only ids that occur in a shipped
 * city dataset and always returns its canonical display names.
 */
export async function canonicalPlanRoute(raw: unknown): Promise<PlanStopDTO[] | null> {
  if (!Array.isArray(raw) || raw.length !== 3) return null;
  const ids = raw.map((value) => value && typeof value === "object"
    ? (value as Record<string, unknown>).venueId
    : null);
  if (ids.some((id) => typeof id !== "string" || !id)) return null;
  const uniqueIds = ids as string[];
  if (new Set(uniqueIds).size !== uniqueIds.length) return null;
  const cities = Object.keys(CITIES) as CityId[];
  const venueLists = await Promise.all(cities.map((cityId) => loadConciergeVenues(cityId)));
  const byId = new Map(venueLists.flat().map((venue) => [venue.id, venue]));
  const stops = uniqueIds.map((venueId, position) => {
    const venue = byId.get(venueId);
    return venue ? { venueId: venue.id, venueName: venue.name, position } : null;
  });
  return stops.some((stop) => stop === null) ? null : stops as PlanStopDTO[];
}
