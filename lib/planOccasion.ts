import { DESCRIBE_FIRST_CHIPS } from "@/lib/describeFirstChips";
import { cleanText } from "@/lib/textClean";

/** Closed occasion ids for soft-social plan deep links. */
export const SOFT_PLAN_OCCASION_IDS = ["quiet", "af", "coffee", "chill"] as const;
export type SoftPlanOccasionId = (typeof SOFT_PLAN_OCCASION_IDS)[number];

/**
 * Each id maps to a shipped describe-first chip so the composer prefills a
 * query that already generates keyless and parses honestly.
 */
export const SOFT_PLAN_OCCASIONS: Record<SoftPlanOccasionId, string> = {
  quiet: "Quiet in Clapham for 4, not pricey",
  af: "alcohol-free drinks in Camden for 3",
  coffee: "coffee and a catch-up in Clapham for 2",
  chill: "chill Wetherspoons in Clapham for 3",
};

/** Extra soft outings on Tonight that are not one of the seven vibe chips. */
export const TONIGHT_SOFT_PLAN_CHIPS: ReadonlyArray<{
  id: Exclude<SoftPlanOccasionId, "quiet">;
  label: string;
}> = [
  { id: "coffee", label: "Coffee catch-up" },
  { id: "af", label: "Alcohol-free outing" },
  { id: "chill", label: "Chill afternoon" },
];

export const PLAN_DESCRIBE_PARAM = "describe";
export const PLAN_OCCASION_PARAM = "occasion";

export function isSoftPlanOccasionId(value: unknown): value is SoftPlanOccasionId {
  return typeof value === "string" && (SOFT_PLAN_OCCASION_IDS as readonly string[]).includes(value);
}

export function resolveSoftPlanOccasionQuery(id: SoftPlanOccasionId): string {
  return SOFT_PLAN_OCCASIONS[id];
}

function isShippedDescribeChip(value: string): boolean {
  return (DESCRIBE_FIRST_CHIPS as readonly string[]).includes(value);
}

/**
 * Read a pre-approved describe string from a plan URL search string.
 * `occasion` wins over `describe`; only closed ids or shipped chip text pass.
 */
export function parsePlanDescribeFromSearch(search: string): string | null {
  let params: URLSearchParams;
  try {
    params = new URLSearchParams(search);
  } catch {
    return null;
  }

  const occasion = params.get(PLAN_OCCASION_PARAM);
  if (isSoftPlanOccasionId(occasion)) {
    return resolveSoftPlanOccasionQuery(occasion);
  }

  const describe = params.get(PLAN_DESCRIBE_PARAM);
  if (!describe) return null;
  const trimmed = cleanText(describe, 500);
  if (!trimmed || !isShippedDescribeChip(trimmed)) return null;
  return trimmed;
}

/** Deep link into /plan with a soft occasion or shipped chip query. */
export function planOccasionHref(
  target: SoftPlanOccasionId | (typeof DESCRIBE_FIRST_CHIPS)[number],
  options?: { src?: string },
): string {
  const params = new URLSearchParams();
  if (isSoftPlanOccasionId(target)) {
    params.set(PLAN_OCCASION_PARAM, target);
  } else {
    params.set(PLAN_DESCRIBE_PARAM, target);
  }
  if (options?.src) params.set("src", options.src);
  const qs = params.toString();
  return qs ? `/plan?${qs}` : "/plan";
}
