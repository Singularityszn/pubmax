/** Published directory entries, separate from open-status and price coverage. */
export type UkDirectoryCoverage = Readonly<{
  pubListings: number;
  barListings: number;
}>;

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Count the active published pack, including pubs which have no recorded name. */
export function ukDirectoryCoverage(manifest: unknown): UkDirectoryCoverage | null {
  if (!manifest || typeof manifest !== "object") return null;
  const source = (manifest as { generatedFrom?: unknown }).generatedFrom;
  if (!source || typeof source !== "object") return null;
  const { pubs, unnamed, bars, count } = source as Record<string, unknown>;
  if (!isCount(pubs) || !isCount(unnamed) || !isCount(bars) || !isCount(count)) return null;
  const pubListings = pubs + unnamed;
  if (!isCount(pubListings) || pubListings + bars !== count || count === 0) return null;
  return { pubListings, barListings: bars };
}
