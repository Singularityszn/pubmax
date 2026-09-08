import "server-only";

import { admin } from "@/lib/storeBackend";

/** Operator-supplied, reviewed specification. No account classification is inferred. */
export type PlanGroupExclusions = {
  specification: string;
  excludedUserIds: readonly string[];
};

export type PlanGroupOutcomeWeek = {
  weekStart: string;
  status: "ready" | "partial" | "cohort_unresolved";
  groupsCompleted: number | null;
  groupsRepeated: number | null;
  repeatRate: number | null;
  unresolvedCompletions: number;
  captureStartedAt: string;
};

export type PlanGroupOutcomeRead =
  | { status: "available"; weeks: PlanGroupOutcomeWeek[] }
  | { status: "unavailable" };

function count(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readWeek(value: unknown): PlanGroupOutcomeWeek | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Record<string, unknown>;
  if (typeof row.week_start !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(row.week_start) ||
    typeof row.capture_started_at !== "string" || !Number.isFinite(Date.parse(row.capture_started_at)) ||
    !count(row.unresolved_completions)) return null;
  const { status, groups_completed: completed, groups_repeated: repeated, repeat_rate: rate } = row;
  if (status !== "ready" && status !== "partial" && status !== "cohort_unresolved") return null;
  if (status === "ready" && row.unresolved_completions !== 0) return null;
  if (status === "cohort_unresolved") {
    if (completed !== null || repeated !== null || rate !== null) return null;
  } else {
    if (!count(completed) || !count(repeated) || repeated > completed) return null;
    if (status === "partial" || completed === 0) {
      if (rate !== null) return null;
    } else if (typeof rate !== "number" || !Number.isFinite(rate) || Math.abs(rate - repeated / completed) > 1e-12) {
      return null;
    }
  }
  // Project only aggregate fields. Never forward arbitrary RPC columns.
  return {
    weekStart: row.week_start,
    status,
    groupsCompleted: completed as number | null,
    groupsRepeated: repeated as number | null,
    repeatRate: rate as number | null,
    unresolvedCompletions: row.unresolved_completions,
    captureStartedAt: row.capture_started_at,
  };
}

/** Private store read. Production deployments can contain production test accounts. */
export async function readPlanGroupOutcomes(
  from: string,
  until: string,
  exclusions?: PlanGroupExclusions,
): Promise<PlanGroupOutcomeRead> {
  if (!Number.isFinite(Date.parse(from)) || !Number.isFinite(Date.parse(until)) || Date.parse(from) >= Date.parse(until)) {
    return { status: "unavailable" };
  }
  try {
    const { data, error } = await admin().rpc("read_plan_group_outcomes", {
      p_from: from,
      p_until: until,
      p_excluded_user_ids: exclusions?.excludedUserIds ?? null,
      p_exclusion_specification: exclusions?.specification ?? null,
    });
    if (error || !Array.isArray(data) || data.length === 0) return { status: "unavailable" };
    const weeks = data.map(readWeek);
    if (weeks.some(week => week === null)) return { status: "unavailable" };
    if (!exclusions?.specification.trim() && weeks.some(week => week?.status !== "cohort_unresolved")) {
      return { status: "unavailable" };
    }
    return { status: "available", weeks: weeks as PlanGroupOutcomeWeek[] };
  } catch {
    return { status: "unavailable" };
  }
}
