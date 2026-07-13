import { describe, expect, it } from "vitest";

import { GET } from "@/app/api/late-food/route";
import {
  LATE_FOOD_TERMINALS,
  getLateFoodForArea,
  normalizeLateFoodArea,
  type LateFoodApiErrorResponse,
  type LateFoodApiSuccessResponse,
} from "@/lib/lateFood";

describe("late-food terminal catalogue", () => {
  it("filters curated endings by London Night Area", () => {
    const terminals = getLateFoodForArea("clapham");

    expect(terminals).toHaveLength(2);
    expect(terminals.every((terminal) => terminal.area === "clapham")).toBe(true);
    expect(terminals.map((terminal) => terminal.name)).toEqual([
      "Kebab Corner",
      "Joe Public",
    ]);
  });

  it("keeps late-food terminals separate from pint-price venues", () => {
    const terminal = LATE_FOOD_TERMINALS[0];

    expect(terminal).toMatchObject({
      provenance: expect.objectContaining({ kind: "editorial" }),
      confidence: "medium",
      hours: expect.objectContaining({ service: expect.any(String) }),
      dietary: expect.any(Array),
      walkingDetour: expect.objectContaining({ minutes: expect.any(Number) }),
    });
    expect(terminal).not.toHaveProperty("prices");
    expect(terminal).not.toHaveProperty("cheapestPint");
    expect(terminal).not.toHaveProperty("amenities");
  });

  it("normalizes familiar Soho and Piccadilly aliases to the canonical Night Area", () => {
    expect(normalizeLateFoodArea("soho")).toBe("piccadilly-soho");
    expect(normalizeLateFoodArea(" PICCADILLY ")).toBe("piccadilly-soho");
    expect(normalizeLateFoodArea("shoreditch")).toBeNull();
    expect(normalizeLateFoodArea("constructor")).toBeNull();
  });
});

describe("GET /api/late-food", () => {
  it("returns only the requested area and honours a limit", async () => {
    const response = await GET(new Request("http://localhost/api/late-food?near=canary-wharf&limit=1"));
    const body: LateFoodApiSuccessResponse = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      area: "canary-wharf",
      terminals: [expect.objectContaining({ area: "canary-wharf" })],
      rankingSignals: expect.arrayContaining(["walking_detour"]),
      missingEvidence: expect.arrayContaining(["live_opening_hours"]),
    });
  });

  it.each(["soho", "piccadilly"])("normalizes the %s alias in the mobile response", async (alias) => {
    const response = await GET(new Request(`http://localhost/api/late-food?near=${alias}`));
    const body: LateFoodApiSuccessResponse = await response.json();

    expect(response.status).toBe(200);
    expect(body.area).toBe("piccadilly-soho");
    expect(body.terminals).toHaveLength(2);
    expect(body.terminals.every((terminal) => terminal.area === "piccadilly-soho")).toBe(true);
  });

  it("rejects an unsupported area with an explicit empty terminal list", async () => {
    const response = await GET(new Request("http://localhost/api/late-food?near=shoreditch"));
    const body: LateFoodApiErrorResponse = await response.json();

    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(body).toEqual({
      error: "near must be one of clapham, victoria, piccadilly-soho, canary-wharf, barnes, chiswick.",
      terminals: [],
    });
  });

  it("exposes explicit verify-tonight guidance and editorial provenance", async () => {
    const response = await GET(new Request("http://localhost/api/late-food?near=clapham&limit=1"));
    const body: LateFoodApiSuccessResponse = await response.json();

    expect(response.status).toBe(200);
    expect(body.terminals[0]).toMatchObject({
      hours: {
        service: expect.any(String),
        verifyOnNight: true,
      },
      provenance: {
        kind: "editorial",
        source: "PubMax London Capture static curation",
        reviewedAt: "2026-07-13",
      },
    });
  });

  it("filters by category or dietary tags before returning terminal suggestions", async () => {
    const response = await GET(new Request("http://localhost/api/late-food?near=piccadilly&tags=vegan&limit=3"));
    const body: LateFoodApiSuccessResponse = await response.json();

    expect(response.status).toBe(200);
    expect(body.terminals).toEqual([
      expect.objectContaining({ id: "late-food-piccadilly-soho-balans", dietary: expect.arrayContaining(["vegan"]) }),
    ]);
  });
});
