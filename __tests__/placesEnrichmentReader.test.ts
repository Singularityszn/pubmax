import { expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: async (...args: Parameters<typeof actual.readFile>) => {
    if (String(args[0]).endsWith("/data/places_enrichment.json")) return JSON.stringify({ version: 1, venues: [
      { venueId: "venue-osm-n123", googlePlaceId: "ChIJVerified0001", formattedAddress: { value: "1 Test Street", source: "google_places", observedAt: "2026-10-04T00:00:00Z" } },
      { venueId: "venue-osm-w456", googlePlaceId: "ChIJVerified0002" },
    ] });
    return actual.readFile(...args);
  } };
});

import { placesRecordForVenue } from "@/lib/placesEnrichment.server";

it("serves exactly matched OSM identity to curated and base readers; conflicting identities remain unknown", async () => {
  expect(await placesRecordForVenue("venue-uk-n123")).toMatchObject({ venueId: "venue-osm-n123", formattedAddress: { value: "1 Test Street" } });
  expect(await placesRecordForVenue("venue-canonical", ["node/123"])).toMatchObject({ googlePlaceId: "ChIJVerified0001" });
  expect(await placesRecordForVenue("venue-canonical", ["node/123", "way/456"])).toBeNull();
  expect(await placesRecordForVenue("venue-uk-n999")).toBeNull();
  expect(await placesRecordForVenue("venue-canonical", ["Node/0123"])).toMatchObject({ googlePlaceId: "ChIJVerified0001" });
  expect(await placesRecordForVenue("venue-osm-W0456")).toMatchObject({ googlePlaceId: "ChIJVerified0002" });
});
