import { promises as fs } from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { getVenueIndex } = vi.hoisted(() => ({
  getVenueIndex: vi.fn(),
}));

vi.mock("server-only", () => ({}));
vi.mock("@/lib/venueIndex", () => ({ getVenueIndex }));

import {
  loadFeedSightings,
  resetFeedSightingsForTests,
} from "@/app/feed/feedSightings.server";

const MIXED_CITY_OVERLAY = {
  version: 1,
  generatedAt: "2026-07-26T07:13:02.882Z",
  updates: [
    {
      venueKey: "bundobust|6, mill hill, leeds, ls1 5dq|53.79548|-1.54556",
      drinkName: "NIMBU PANI RADLER",
      category: "beer",
      priceGbp: 3.25,
      source: {
        label: "Bundobust menu",
        url: "https://bundobust.com/menu",
        licence: "Attributed use only.",
      },
      observedAt: "2026-07-26T07:12:24.229Z",
    },
    {
      venueKey: "prospect of whitby|57 wapping wall, e1w 3sh|51.50710|-0.05113",
      drinkName: "Lucky Saint 0.5%",
      category: "beer",
      priceGbp: 4.6,
      source: {
        label: "Prospect of Whitby menu",
        url: "https://www.greeneking.co.uk/pubs/london/prospect-of-whitby",
        licence: "Attributed use only.",
      },
      observedAt: "2026-07-25T12:00:00.000Z",
    },
  ],
};

describe("feed sightings server boundary", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    resetFeedSightingsForTests();
  });

  it("drops an out-of-city observation while retaining a resolved London venue", async () => {
    vi.spyOn(fs, "readFile").mockResolvedValue(JSON.stringify(MIXED_CITY_OVERLAY));
    getVenueIndex.mockResolvedValue(
      new Map([
        [
          "venue-16pnwmm",
          {
            id: "venue-16pnwmm",
            name: "Prospect of Whitby",
            borough: "Tower Hamlets",
            lat: 51.5071,
            lng: -0.05113,
          },
        ],
      ]),
    );

    const sightings = await loadFeedSightings();

    expect(sightings).toHaveLength(1);
    expect(sightings[0]).toMatchObject({
      venueId: "venue-16pnwmm",
      venueName: "Prospect of Whitby",
      venueMapUrl: "/map?sel=venue-16pnwmm",
      drink: "Lucky Saint 0.5%",
      priceLabel: "£4.60",
    });
    expect(sightings.some((sighting) => sighting.venueId === "venue-fla5g9")).toBe(false);
  });
});
