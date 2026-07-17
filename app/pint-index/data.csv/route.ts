import { leagueTableToCsv } from "@/lib/pintIndex";
import { loadPublicPintIndexSnapshot } from "@/lib/pintIndexSnapshot.server";

export async function GET(): Promise<Response> {
  const snapshot = await loadPublicPintIndexSnapshot();
  const csv = snapshot
    ? leagueTableToCsv(snapshot)
    : "borough_code,borough,tracked_pubs,average_pint_gbp,cheapest_pint_gbp,cheapest_pint_pub,dearest_pint_gbp,observation_start,observation_end,snapshot_id\r\n";
  return new Response(csv, {
    status: 200,
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": 'attachment; filename="london-pint-index.csv"',
      "cache-control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
