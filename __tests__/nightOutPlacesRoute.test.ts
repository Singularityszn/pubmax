import { describe, expect, it } from "vitest";

import { createNightOutPlacesHandler } from "@/app/api/night-out-places/route";
import type {
  NightOutPlace,
  NightOutPlaceSnapshot,
} from "@/lib/nightOutPlaces";

const NOW = new Date("2026-07-20T12:00:00.000Z");

const PLACE: NightOutPlace = {
  id: "night-place-restaurant-test",
  category: "restaurant",
  job: "near_pub_food",
  name: "The Test Kitchen",
  description: "A neighbourhood restaurant serving a short seasonal menu from an open kitchen.",
  address: "1 Test Street, Soho, W1D 3QF",
  area: "Soho",
  location: { lat: 51.513, lng: -0.131 },
  sourceUrl: "https://example.com/london/test-kitchen",
  sourceName: "example.com",
  observedAt: "2026-07-20T10:00:00.000Z",
  expiresAt: "2026-08-19T10:00:00.000Z",
  discoveredVia: "exa",
  extractedVia: "firecrawl",
};

function snapshot(places: NightOutPlace[]): NightOutPlaceSnapshot {
  return {
    version: 1,
    generatedAt: NOW.toISOString(),
    status: places.length > 0 ? "published" : "empty",
    provenanceRegistryVersion: 1,
    places,
  };
}

function handler(places: NightOutPlace[] = []) {
  return createNightOutPlacesHandler({
    now: () => NOW,
    loadSnapshot: () => snapshot(places),
  });
}

describe("GET /api/night-out-places", () => {
  it("requires an explicit night-out job and a London anchor", async () => {
    const GET = handler();
    const missing = await GET(new Request("http://localhost/api/night-out-places"));
    expect(missing.status).toBe(400);
    await expect(missing.json()).resolves.toMatchObject({
      code: "INVALID_NIGHT_OUT_JOB",
      retryable: false,
    });

    const outside = await GET(
      new Request(
        "http://localhost/api/night-out-places?job=near_pub_food&lat=53.48&lng=-2.24",
      ),
    );
    expect(outside.status).toBe(400);
    await expect(outside.json()).resolves.toMatchObject({
      code: "INVALID_LONDON_ANCHOR",
    });
  });

  it("returns a fixed honest empty snapshot without inventing fallback rows", async () => {
    const GET = handler();
    const response = await GET(
      new Request(
        "http://localhost/api/night-out-places?job=near_pub_food&lat=51.513&lng=-0.131",
      ),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "empty",
      job: "near_pub_food",
      places: [],
      message: "No sourced spots have cleared our checks near here yet.",
      observedThrough: NOW.toISOString(),
    });
  });

  it("returns current rows from a fixed populated snapshot", async () => {
    const response = await handler([PLACE])(
      new Request(
        "http://localhost/api/night-out-places?job=near_pub_food&lat=51.513&lng=-0.131",
      ),
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ready",
      job: "near_pub_food",
      observedThrough: NOW.toISOString(),
      places: [PLACE],
    });
  });
});
