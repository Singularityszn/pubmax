import { describe, expect, it, vi } from "vitest";

import { GET as LIST } from "@/app/api/night-areas/route";
import { GET } from "@/app/api/night-areas/[slug]/route";

describe("GET /api/night-areas", () => {
  it("lists the reviewed London catalogue without authentication", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-13T12:00:00.000Z"));
    try {
      const response = await LIST(new Request("http://localhost/api/night-areas?city=london"));
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");

      const body = await response.json();
      expect(body).toMatchObject({ cityId: "london" });
      expect(body.areas).toHaveLength(20);
      expect(body.areas).toEqual(expect.arrayContaining([
        expect.objectContaining({
          slug: "clapham",
          coverageStatus: "route_ready",
          coverageScore: expect.any(Number),
          routeReadyReasons: expect.any(Array),
          missingEvidence: [],
          gate: expect.objectContaining({ version: 1, passed: true }),
          routeReady: true,
          lastReviewedAt: expect.any(String),
          reviewExpiresAt: expect.any(String),
        }),
        expect.objectContaining({
          slug: "barnes",
          coverageStatus: "reviewed",
          missingEvidence: expect.arrayContaining(["opening_hours"]),
          routeReady: false,
        }),
        expect.objectContaining({ slug: "camden", demandWave: 1 }),
      ]));
    } finally {
      vi.useRealTimers();
    }
  });

  it("rejects cities without a reviewed Night Area catalogue", async () => {
    const response = await LIST(new Request("http://localhost/api/night-areas?city=manchester"));
    expect(response.status).toBe(404);
  });

  it("rejects an unknown city rather than silently falling back to London", async () => {
    const response = await LIST(new Request("http://localhost/api/night-areas?city=unknown-city"));

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "city is required and must be valid.",
      code: "CITY_INVALID",
      retryable: false,
    });
  });
});

describe("GET /api/night-areas/:slug", () => {
  it("returns a pilot Night Area with coverage and daypart guidance", async () => {
    const response = await GET(new Request("http://localhost/api/night-areas/clapham"), {
      params: Promise.resolve({ slug: "clapham" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      slug: "clapham",
      name: "Clapham",
      transportAnchors: expect.any(Array),
      daypartGuidance: { after_work: expect.any(String), late_night: expect.any(String) },
      recentSignals: [],
      coverageStatus: "route_ready",
      gate: expect.objectContaining({ version: 1, passed: true }),
      routeReady: true,
    });
  });

  it("returns reviewed expansion areas while keeping their route gate visible", async () => {
    const response = await GET(new Request("http://localhost/api/night-areas/camden"), {
      params: Promise.resolve({ slug: "camden" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      slug: "camden",
      coverageStatus: "captured",
      gate: expect.objectContaining({ passed: false }),
      routeReady: false,
    });
  });

  it("returns a not-found response for an unknown Night Area slug", async () => {
    const response = await GET(new Request("http://localhost/api/night-areas/not-a-night-area"), {
      params: Promise.resolve({ slug: "not-a-night-area" }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "Night Area not found.",
      code: "NIGHT_AREA_NOT_FOUND",
      retryable: false,
    });
  });
});
