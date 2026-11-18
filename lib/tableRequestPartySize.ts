/** A crew of six or more: below that, a pub does not need asking. */
export const TABLE_REQUEST_MIN_PARTY = 6;
/** A pub crawl crew, not a function room. Bigger than this is a private hire. */
export const TABLE_REQUEST_MAX_PARTY = 20;

export function parseTableRequestPartySize(raw: unknown): number | null {
  const value = typeof raw === "string" && raw.trim() ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  return value >= TABLE_REQUEST_MIN_PARTY && value <= TABLE_REQUEST_MAX_PARTY ? value : null;
}
