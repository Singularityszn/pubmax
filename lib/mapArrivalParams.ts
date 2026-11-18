export const CRAWL_ARRIVAL_PARAMS = [
  "pubs", "sel", "style", "mode", "q", "area", "drink", "cocktails", "landmark", "band", "food",
  "garden", "max", "alt", "log", "crawl", "experience", "mapNotice",
] as const;
export const TRUSTED_HANDOFF_ARRIVAL_PARAMS = ["plan", "accept", "src"] as const;
export const PLAN_DESCRIBE_PARAM = "describe";
export const PLAN_OCCASION_PARAM = "occasion";
export const PLAN_QUERY_PARAM = "query";
export const PLAN_HANDOFF_PARAMS = [PLAN_QUERY_PARAM, PLAN_OCCASION_PARAM, PLAN_DESCRIBE_PARAM] as const;

export function searchHasArrivalParam(search: string, keys: readonly string[]): boolean {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const key of keys) if (params.has(key)) return true;
  return false;
}
