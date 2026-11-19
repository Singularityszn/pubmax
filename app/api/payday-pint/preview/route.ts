import { readFile } from "node:fs/promises";
import { publicApiError } from "@/lib/apiError";
import { renderPaydayPint, selectPaydayPints, type PaydayStation, type PaydayVenue } from "@/lib/paydayPint";

export async function GET(request: Request) {
  if (process.env.PAYDAY_PINT_PREVIEW !== "1") return publicApiError("Not found.", "not_found", 404);
  const name = new URL(request.url).searchParams.get("station") ?? "Oxford Circus";
  const stations = JSON.parse(await readFile("data/tfl_station_zones.json", "utf8")) as { stations: PaydayStation[] };
  const station = stations.stations.find((item) => item.name.toLowerCase() === name.toLowerCase());
  if (!station) return publicApiError("Station not found.", "not_found", 404);
  const venues = JSON.parse(await readFile("public/data/venues_slim.json", "utf8")) as { rows: PaydayVenue[] };
  return new Response(renderPaydayPint(station, selectPaydayPints(station, venues.rows)), {
    headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" },
  });
}
