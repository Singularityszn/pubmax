import { loadGroupedVenues } from "@/lib/venueDataset";
import { buildLeagueTable, leagueTableToCsv } from "@/lib/pintIndex";

// GET /pint-index/data.csv — the downloadable London Pint Index (Wave S3.3).
// A route handler (rather than a static file) so the CSV is generated from the
// SAME league-table computation the page renders — the file and the page can
// never disagree, and it stays fresh with the bundled dataset. Pure derivation
// from observed prices; no invented figures.
//
// Served as an attachment so a browser download saves a sensibly-named file.
// Cacheable on the CDN for a short window like the app's other data GETs — the
// dataset moves slowly.
export async function GET(): Promise<Response> {
  const venues = await loadGroupedVenues();
  const rows = buildLeagueTable(venues);
  const csv = leagueTableToCsv(rows);

  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="london-pint-index.csv"',
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
