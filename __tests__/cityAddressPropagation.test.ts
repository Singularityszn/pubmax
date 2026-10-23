import { readFileSync } from "node:fs";

import { afterEach, expect, it, vi } from "vitest";

import { buildCitySlim } from "../scripts/build_city_slim_index.mjs";
import { CITIES as BUILD_CITIES } from "../scripts/fetch_city_osm_pubs.mjs";
import { defined } from "@/__tests__/helpers/defined";
import { getCity } from "@/lib/cities";
import { pinsToSlimVenues, slimVenueToPin } from "@/lib/slimPins";
import { readCityVenueIndex, resetVenueIndexForTests } from "@/lib/venueIndex";
import { loadSlimVenuesFromPath, type SlimVenue } from "@/lib/venuesSlim";

function seed(city: string, name: string) {
  const pack = JSON.parse(readFileSync(`data/cities/${city}/osm_pubs.json`, "utf8"));
  return pack.pubs.find((pub: { name: string }) => pub.name === name);
}

afterEach(() => {
  vi.unstubAllGlobals();
  resetVenueIndexForTests();
});

it.each([
  ["bath", "The Raven", "6-7, Queen Street, Bath, BA1 1HE"],
  ["birmingham", "The Indie Lounge", ""],
])("carries the sourced %s address through the builder and public pin loader", async (city, name, address) => {
  const { slim } = buildCitySlim(defined(BUILD_CITIES[city]), { pubs: [seed(city, name)] });
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ rows: slim }))));
  const rows = await loadSlimVenuesFromPath(`/test-city-address-${city}.json`, { bypassInFlight: true });
  expect(rows).toHaveLength(1);
  expect(rows[0]).toHaveProperty("address", address);
  expect(slimVenueToPin(rows[0]!).address).toBe(address);
  expect(pinsToSlimVenues([slimVenueToPin(rows[0]!)])[0]).toHaveProperty("address", address);
});

it("serves Raven's sourced address through the server index", async () => {
  const index = await readCityVenueIndex(getCity("bath"));
  const raven = index?.get("venue-bat-1vw6eb2")?.slimVenue;
  expect(raven).toBeDefined();
  expect(slimVenueToPin(raven!).address).toBe("6-7, Queen Street, Bath, BA1 1HE");
});

it("does not turn an old city search blob into an address", () => {
  const row = JSON.parse(readFileSync("public/data/cities/bath/venues_slim.json", "utf8")).rows.find((venue: SlimVenue) => venue.id === "venue-bat-1vw6eb2");
  delete row.address;
  expect(slimVenueToPin(row).address).toBe("");
});
