const MAX_MATCH_DISTANCE_M = 25;

function compactOsmRef(osmId) {
  const [type, id] = String(osmId ?? "").split("/");
  if (!id) return "";
  if (type === "node") return `n${id}`;
  if (type === "way") return `w${id}`;
  if (type === "relation") return `r${id}`;
  return "";
}

function normalizedName(value) {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function distanceMeters(left, right) {
  const radians = Math.PI / 180;
  const meanLat = ((Number(left.lat) + Number(right.lat)) / 2) * radians;
  const x = (Number(right.lng) - Number(left.lng)) * radians * Math.cos(meanLat);
  const y = (Number(right.lat) - Number(left.lat)) * radians;
  return Math.hypot(x, y) * 6_371_000;
}

function promotedVenueId(pub, curatedRowsBySource) {
  const source = String(pub?.curatedRef?.source ?? "");
  const rows = curatedRowsBySource.get(source) ?? [];
  const recordedId = String(pub?.curatedRef?.id ?? "");
  if (recordedId.startsWith("venue-") && rows.some((row) => row.id === recordedId)) {
    return recordedId;
  }
  const name = normalizedName(pub?.name);
  if (!name || !Number.isFinite(pub?.lat) || !Number.isFinite(pub?.lng)) return "";
  const candidates = rows
    .filter(
      (row) =>
        normalizedName(row?.name) === name &&
        typeof row?.id === "string" &&
        row.id.startsWith("venue-") &&
        Number.isFinite(row?.lat) &&
        Number.isFinite(row?.lng),
    )
    .map((row) => ({ id: row.id, distanceM: distanceMeters(pub, row) }))
    .sort((left, right) => left.distanceM - right.distanceM || left.id.localeCompare(right.id));
  const nearest = candidates[0];
  return nearest && nearest.distanceM <= MAX_MATCH_DISTANCE_M ? nearest.id : "";
}

export function buildUkBasePromotionPlan(pubs, curatedRowsBySource) {
  const aliases = {};
  const promotedOsmIds = new Set();
  for (const pub of pubs) {
    if (!pub?.curatedRef) continue;
    const canonicalId = promotedVenueId(pub, curatedRowsBySource);
    const compactRef = compactOsmRef(pub.osmId);
    if (!canonicalId || !compactRef) continue;
    aliases[`venue-uk-${compactRef}`] = canonicalId;
    promotedOsmIds.add(pub.osmId);
  }
  return { aliases, promotedOsmIds };
}
