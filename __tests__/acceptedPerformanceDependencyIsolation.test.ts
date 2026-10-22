import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@/lib/profiles");
  vi.doUnmock("@/lib/nightAreas");
  vi.doUnmock("@/lib/pintIndex");
  vi.doUnmock("@/lib/plan");
  vi.doUnmock("@/lib/mapFirstVisitArrival");
  vi.resetModules();
});

// Existing public callers must work without loading unrelated data models.
// A throwing model double detects its accidental eager import. No missing new
// leaf is imported by this before-run packet; behavior uses current callers.
describe("accepted performance dependency isolation", () => {
  it("renders normalized public handles without loading the profile model", async () => {
    vi.resetModules();
    vi.doMock("@/lib/profiles", () => { throw new Error("handle display loaded profile model"); });
    const { displayHandle, handleOnly } = await import("@/lib/handleDisplay");
    expect(displayHandle("@@ALICE")).toBe("@alice");
    expect(handleOnly("@@ALICE")).toBe("alice");
    expect(displayHandle(null)).toBe("@anon");
  });

  it("sanitizes known area and borough events without loading their data models", async () => {
    vi.resetModules();
    vi.doMock("@/lib/nightAreas", () => { throw new Error("analytics loaded night area model"); });
    vi.doMock("@/lib/pintIndex", () => { throw new Error("analytics loaded Pint Index model"); });
    const { sanitizeEvent } = await import("@/lib/analyticsEvents");
    expect(sanitizeEvent("night_description_submitted", { area: "clapham" }))
      .toEqual({ name: "night_description_submitted", props: { area: "clapham" } });
    expect(sanitizeEvent("pint_index_area_opened", { area: "westminster", surface: "index" }))
      .toEqual({ name: "pint_index_area_opened", props: { area: "westminster", surface: "index" } });
    expect(sanitizeEvent("night_description_submitted", {
      area: "reader@example.com", coordinates: "51.5,-0.1",
    })).toEqual({ name: "night_description_submitted", props: {} });
  });

  it("validates active plan pointers without loading the planning model", async () => {
    vi.resetModules();
    vi.doMock("@/lib/plan", () => { throw new Error("active pointer loaded planning model"); });
    const { parseActivePlan } = await import("@/lib/activePlan");
    const id = "123e4567-e89b-12d3-a456-426614174000";
    expect(parseActivePlan(JSON.stringify({ version: 1, id, startTime: "2026-10-01T19:00:00.000Z" })))
      .toMatchObject({ id });
    expect(parseActivePlan(JSON.stringify({ version: 1, id: "invalid", startTime: "2026-10-01T19:00:00.000Z" })))
      .toBeNull();
  });

  it("checks prompt eligibility without loading map arrival URL policy", async () => {
    vi.resetModules();
    vi.doMock("@/lib/mapFirstVisitArrival", () => { throw new Error("prompt loaded map URL policy"); });
    const { locationAllowsInterruptivePrompt } = await import("@/lib/promptBudget");
    expect(locationAllowsInterruptivePrompt()).toBe(true);
  });
});
