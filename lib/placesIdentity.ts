import { canonicalOsmId } from "./harvestFold";

export function unambiguousPlacesRecords<T extends { venueId: string; googlePlaceId: string }>(
  records: readonly T[],
  rejections: readonly { venueId: string; googlePlaceId: string }[] = [],
): T[] {
  const rejected = new Set(rejections.map((row) => `${canonicalOsmId(row.venueId)}:${row.googlePlaceId}`));
  const candidates = records.filter((row) => !rejected.has(`${canonicalOsmId(row.venueId)}:${row.googlePlaceId}`));
  const owners = new Map<string, Set<string>>();
  for (const record of candidates) {
    const id = canonicalOsmId(record.venueId);
    if (!id) continue;
    const keys = owners.get(record.googlePlaceId) ?? new Set<string>();
    keys.add(id);
    owners.set(record.googlePlaceId, keys);
  }
  return candidates.filter((record) => owners.get(record.googlePlaceId)?.size === 1);
}
