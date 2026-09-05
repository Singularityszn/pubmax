// The moderator door onto the enrichment checkpoint.
//
// It exists for two reasons the audit named: a partial run has to be
// inspectable, and a terminal failure has to be recorded WITH a way back.
// Nothing here touches a provider.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GET, POST } from "@/app/api/admin/city-enrichment/route";
import {
  cityEnrichmentCheckpointStore,
  resetCityEnrichmentCheckpointMemory,
} from "@/lib/cityEnrichmentCheckpointStore.server";
import {
  MAX_VENUE_ATTEMPTS,
  emptyCityEnrichmentCheckpoint,
  recordVenueFailure,
} from "@/lib/cityEnrichmentCheckpoint";

const NOW = Date.parse("2026-09-05T03:15:13.000Z");
const REFUSED_OSM_ID = "node/1367337816";

function req(body?: unknown, token = "the-real-token"): Request {
  return new Request("https://pubmaxxing.com/api/admin/city-enrichment", {
    method: body === undefined ? "GET" : "POST",
    headers: {
      ...(token ? { "x-admin-token": token } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function seedRefusedVenue(): Promise<void> {
  let checkpoint = emptyCityEnrichmentCheckpoint("birmingham", 106, NOW);
  for (let attempt = 0; attempt < MAX_VENUE_ATTEMPTS; attempt += 1) {
    checkpoint = recordVenueFailure(checkpoint, {
      osmId: REFUSED_OSM_ID,
      error: "Search request timed out after 12000ms.",
      now: NOW,
    }).checkpoint;
  }
  await cityEnrichmentCheckpointStore().save(checkpoint);
}

beforeEach(() => {
  resetCityEnrichmentCheckpointMemory();
  vi.stubEnv("ADMIN_TOKEN", "the-real-token");
  vi.useFakeTimers();
  vi.setSystemTime(new Date(NOW));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("GET /api/admin/city-enrichment", () => {
  it("refuses without the moderator credential", async () => {
    expect((await GET(req(undefined, ""))).status).toBe(403);
  });

  it("shows how far each city has got and what it owes", async () => {
    await seedRefusedVenue();

    const response = await GET(req());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.maxVenueAttempts).toBe(MAX_VENUE_ATTEMPTS);
    const birmingham = body.cities.find((city: { city: string }) => city.city === "birmingham");
    expect(birmingham.terminal).toBe(1);
    expect(birmingham.venuesRefused[0]).toMatchObject({
      osmId: REFUSED_OSM_ID,
      attempts: MAX_VENUE_ATTEMPTS,
    });
    // A city nobody has run yet answers its empty shape rather than going
    // missing, so "not started" and "could not read" stay apart.
    expect(body.cities.map((city: { city: string }) => city.city)).toContain("london");
  });
});

describe("POST /api/admin/city-enrichment", () => {
  it("refuses without the moderator credential", async () => {
    expect((await POST(req({ action: "requeue", city: "birmingham" }, ""))).status).toBe(403);
  });

  it("refuses an unknown action and an unknown city", async () => {
    expect((await POST(req({ action: "delete", city: "birmingham" }))).status).toBe(400);
    expect((await POST(req({ action: "requeue", city: "atlantis" }))).status).toBe(400);
  });

  it("puts a refused venue back in the retry queue", async () => {
    await seedRefusedVenue();

    const response = await POST(req({ action: "requeue", city: "birmingham" }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, city: "birmingham", requeued: [REFUSED_OSM_ID] });

    const after = await cityEnrichmentCheckpointStore().read("birmingham", 106, NOW);
    expect(after!.terminal).toEqual([]);
    expect(after!.deferred.map((entry) => entry.osmId)).toEqual([REFUSED_OSM_ID]);
  });

  it("is a no-op, not an error, when a city has refused nothing", async () => {
    const response = await POST(req({ action: "requeue", city: "leeds" }));
    expect(response.status).toBe(200);
    expect((await response.json()).requeued).toEqual([]);
  });
});
