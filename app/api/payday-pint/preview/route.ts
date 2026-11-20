import { publicApiError } from "@/lib/apiError";
import { renderPaydayPint, selectPaydayPints } from "@/lib/paydayPint";
import { paydayStations, paydayVenues } from "@/lib/paydayPintData.server";

export async function GET(request: Request) {
  if (process.env.PAYDAY_PINT_PREVIEW !== "1") return publicApiError("Not found.", "not_found", 404);
  const name = new URL(request.url).searchParams.get("station");
  const stations = await paydayStations();
  const station = stations.find((item) => item.name === name);
  if (!station) return publicApiError("Station not found.", "not_found", 404);
  const venues = await paydayVenues();
  return new Response(renderPaydayPint(station, selectPaydayPints(station, venues)), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
