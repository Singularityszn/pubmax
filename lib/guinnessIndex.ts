import { median, MIN_PRICED_VENUES } from "@/lib/zones";
import type { PricedLandingPublisher } from "@/lib/pricedLanding";

export type GuinnessIndexRow = {
  venueId: string;
  venueName: string;
  borough: string;
  priceGbp: number;
  publisher: PricedLandingPublisher;
  observedAt: string;
};

function evidence(rows: readonly GuinnessIndexRow[]) {
  const dates = rows.map((row) => row.observedAt.slice(0, 10)).sort();
  return {
    sources: [...new Set(rows.map((row) => row.publisher.label))].sort(),
    oldest: dates[0] ?? null,
    newest: dates.at(-1) ?? null,
  };
}

export function buildGuinnessIndex(input: readonly GuinnessIndexRow[]) {
  const rows = [...input].sort((a, b) => a.priceGbp - b.priceGbp || a.venueId.localeCompare(b.venueId));
  // Preserve the cheapest observation when a venue occurs more than once.
  const byVenue = new Map<string, GuinnessIndexRow>();
  for (const row of rows) if (!byVenue.has(row.venueId)) byVenue.set(row.venueId, row);
  const selected = [...byVenue.values()];
  const names = [...new Set(selected.map((row) => row.borough.trim()).filter(Boolean))].sort();
  return {
    count: selected.length,
    medianGbp: selected.length >= MIN_PRICED_VENUES ? median(selected.map((row) => row.priceGbp)) : null,
    cheapest: selected[0] ?? null,
    dearest: selected.at(-1) ?? null,
    ...evidence(selected),
    boroughs: names.map((name) => {
      const group = selected.filter((row) => row.borough.trim() === name);
      return { name, count: group.length, medianGbp: group.length >= MIN_PRICED_VENUES ? median(group.map((row) => row.priceGbp)) : null, ...evidence(group) };
    }),
  };
}
