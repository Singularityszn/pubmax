// Structured OSM kind evidence is independent of a row's price observation.
export function stampedOsmId(row) {
  return /(?:^|\|)osm_overpass\|([^|]+)/.exec(String(row.data_quality_notes ?? ""))?.[1] ?? null;
}

export function resolveSourceVenueKind(rows) {
  const evidence = rows.filter((row) =>
    [row.venue_kind, row.venue_kind_osm_id, row.venue_kind_observed_at].some((value) => value !== undefined),
  );
  if (!evidence.length) return { status: "unknown" };
  const valid = evidence.every((row) => {
    const day = row.venue_kind_observed_at;
    return (row.venue_kind === "pub" || row.venue_kind === "bar") &&
      /^(?:node|way|relation)\/\d+$/.test(row.venue_kind_osm_id ?? "") &&
      row.venue_kind_osm_id === stampedOsmId(row) &&
      typeof day === "string" && /^\d{4}-\d{2}-\d{2}T/.test(day) &&
      Number.isFinite(Date.parse(day)) && new Date(day).toISOString().slice(0, 10) === day.slice(0, 10);
  });
  const kinds = new Set(evidence.map((row) => row.venue_kind));
  if (valid && kinds.size === 1) return { status: "stated", kind: evidence[0].venue_kind };
  const details = evidence.map((row) => JSON.stringify({
    row: row.app_price_id, kind: row.venue_kind, osmId: row.venue_kind_osm_id,
    observedAt: row.venue_kind_observed_at,
  })).sort();
  return { status: "conflict", diagnostic: `source venue kind refused: ${details.join("; ")}` };
}

// Same canonical identity used by the compact publisher and groupVenuePrices.
export function assertSourceVenueKinds(rows) {
  const groups = new Map();
  for (const row of rows) {
    const key = [row.pub_name, row.address].map((value) => String(value).trim().toLowerCase().replace(/\s+/g, " "))
      .concat([Number(row.latitude).toFixed(5), Number(row.longitude).toFixed(5)]).join("|");
    const group = groups.get(key) ?? [];
    group.push(row);
    groups.set(key, group);
  }
  const errors = [...groups.entries()].flatMap(([key, group]) => {
    const result = resolveSourceVenueKind(group);
    return result.status === "conflict" ? [`${key}: ${result.diagnostic}`] : [];
  }).sort();
  if (errors.length) throw new Error(errors.join("\n"));
}
