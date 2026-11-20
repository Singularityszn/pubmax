import "server-only";
import { readFile } from "node:fs/promises";
import type { PaydayStation, PaydayVenue } from "@/lib/paydayPint";

export async function paydayStations(): Promise<PaydayStation[]> {
  const data = JSON.parse(await readFile("data/tfl_station_zones.json", "utf8")) as { stations: PaydayStation[] };
  return data.stations;
}
export async function paydayVenues(): Promise<PaydayVenue[]> {
  const data = JSON.parse(await readFile("public/data/venues_slim.json", "utf8")) as { rows: PaydayVenue[] };
  return data.rows;
}
