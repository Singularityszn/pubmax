// The London Pint Index (Wave S3.3) — the pure, React-free core that turns the
// tracked pint dataset into a borough league table and its downloadable CSV.
// Shared by app/pint-index/page.tsx (the visible table + Dataset JSON-LD) and
// app/pint-index/data.csv/route.ts (the CSV export) so the page and the file can
// never disagree.
//
// Provenance: every figure is DERIVED from the same per-borough stats the
// borough pages show (lib/pintFacts.pintFactStats over validated
// lib/boroughs.canonicalBorough buckets — real boroughs only, never
// neighbourhood labels). Nothing invented; boroughs with no priced pub are
// still listed with null figures so coverage is honest, and sort them last.

import type { Venue } from "@/lib/venues";
import { canonicalBorough, slugifyBorough } from "@/lib/boroughs";
import { pintFactStats, type PintFactStats } from "@/lib/pintFacts";

export type LeagueRow = {
  slug: string;
  name: string;
  pubCount: number;
  totalPubCount: number;
  averageGbp: number | null;
  minGbp: number | null;
  minPubName: string | null;
  maxGbp: number | null;
};

// Group venues by borough (via the canonical venueArea fallback), compute the
// per-borough pint stats, and return them sorted cheapest-average-first. This is
// the "sortable statically by avg" default the PRD asks for — a server-rendered,
// pre-sorted table needing zero client JS. Boroughs with no priced pub (null
// average) sort to the end, name-tiebroken, so they're listed but never claim a
// price they don't have.
export function buildLeagueTable(venues: Venue[]): LeagueRow[] {
  const byBorough = new Map<string, Venue[]>();
  const displayName = new Map<string, string>();
  for (const venue of venues) {
    // Only real boroughs (validated primaryBorough) may appear as league rows;
    // venues carrying a neighbourhood label (Soho, Mayfair) or nothing are
    // excluded rather than presented as boroughs. See lib/boroughs.ts.
    const name = canonicalBorough(venue);
    if (!name) continue;
    const slug = slugifyBorough(name);
    if (!byBorough.has(slug)) {
      byBorough.set(slug, []);
      displayName.set(slug, name);
    }
    byBorough.get(slug)!.push(venue);
  }

  const rows: LeagueRow[] = [];
  for (const [slug, group] of byBorough) {
    const stats: PintFactStats = pintFactStats(group, displayName.get(slug)!, slug);
    rows.push({
      slug,
      name: stats.name,
      pubCount: stats.pubCount,
      totalPubCount: stats.totalPubCount,
      averageGbp: stats.averageGbp,
      minGbp: stats.minGbp,
      minPubName: stats.minPubName,
      maxGbp: stats.maxGbp,
    });
  }

  return rows.sort((a, b) => {
    // Priced boroughs first, cheapest average leading; unpriced sort last.
    if (a.averageGbp === null && b.averageGbp === null) {
      return a.name.localeCompare(b.name);
    }
    if (a.averageGbp === null) return 1;
    if (b.averageGbp === null) return -1;
    return a.averageGbp - b.averageGbp || a.name.localeCompare(b.name);
  });
}

// A single CSV text field: RFC-4180 quoting so a pub name containing a comma,
// quote or newline can never break the column layout.
function csvField(value: string | null): string {
  if (value === null) return "";
  if (/[",\n\r]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

/** A GBP price CSV cell: pence-precision, or empty for a missing price. */
function csvPrice(value: number | null): string {
  return value === null ? "" : value.toFixed(2);
}

export const LEAGUE_CSV_HEADER = [
  "borough",
  "tracked_pubs",
  "mapped_pubs",
  "average_pint_gbp",
  "cheapest_pint_gbp",
  "cheapest_pint_pub",
  "dearest_pint_gbp",
] as const;

// Serialise the league table to CSV text (header + one row per borough). CRLF
// line endings per RFC-4180 so the file opens cleanly in Excel/Sheets.
export function leagueTableToCsv(rows: LeagueRow[]): string {
  const lines = [LEAGUE_CSV_HEADER.join(",")];
  for (const row of rows) {
    lines.push(
      [
        csvField(row.name),
        String(row.pubCount),
        String(row.totalPubCount),
        csvPrice(row.averageGbp),
        csvPrice(row.minGbp),
        csvField(row.minPubName),
        csvPrice(row.maxGbp),
      ].join(","),
    );
  }
  return lines.join("\r\n") + "\r\n";
}

// City-wide rollup across every priced borough — the headline figures for the
// index intro. Pure reduction over the league rows.
export type IndexSummary = {
  boroughCount: number; // boroughs with at least one priced pub
  pubCount: number; // tracked (priced) pubs across all boroughs
  averageGbp: number | null; // mean of priced-pub cheapest pints, city-wide
  cheapestBorough: LeagueRow | null;
  dearestBorough: LeagueRow | null;
};

export function indexSummary(rows: LeagueRow[]): IndexSummary {
  const priced = rows.filter((row) => row.averageGbp !== null);
  if (priced.length === 0) {
    return {
      boroughCount: 0,
      pubCount: 0,
      averageGbp: null,
      cheapestBorough: null,
      dearestBorough: null,
    };
  }
  // City-wide average is pub-weighted (average of every tracked pub's cheapest
  // pint), not an average of borough averages — the latter over-weights thinly
  // tracked boroughs. We reconstruct the weighted mean from each borough's
  // average * pubCount.
  const totalPubs = priced.reduce((sum, row) => sum + row.pubCount, 0);
  const weightedSum = priced.reduce(
    (sum, row) => sum + (row.averageGbp as number) * row.pubCount,
    0,
  );
  const cheapest = priced.reduce((best, row) =>
    (row.averageGbp as number) < (best.averageGbp as number) ? row : best,
  );
  const dearest = priced.reduce((worst, row) =>
    (row.averageGbp as number) > (worst.averageGbp as number) ? row : worst,
  );
  return {
    boroughCount: priced.length,
    pubCount: totalPubs,
    averageGbp: totalPubs > 0 ? Math.round((weightedSum / totalPubs) * 100) / 100 : null,
    cheapestBorough: cheapest,
    dearestBorough: dearest,
  };
}
