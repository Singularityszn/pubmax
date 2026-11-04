import { describe, expect, it } from "vitest";

import { walkableDraftAround, walkableDraftRoute } from "@/lib/palPlanDraft";
import { straightLineWalkableKm } from "@/lib/planRouteOptimizer";
import { runAskTool } from "@/lib/ask/tools";

// Real coordinates from the committed venue pack. The Pal's old Clapham draft
// was the top three ranked pubs as they came: two by Clapham Junction and The
// Pheonix 2.8 km away, a crawl Plan's own walking rule refuses.
const LSW = { id: "lsw", lat: 51.464, lng: -0.167474 };
const JUNCTION = { id: "junction", lat: 51.4633, lng: -0.169754 };
const PHEONIX = { id: "pheonix", lat: 51.4688, lng: -0.127133 };
const NEAR_JUNCTION = { id: "near-junction", lat: 51.4612, lng: -0.1641 };

const ranked = (rows: { id: string; lat: number; lng: number }[]) =>
  rows.map((row, index) => ({ value: row.id, lat: row.lat, lng: row.lng, score: 100 - index }));

describe("walkableDraftRoute: the Pal proposes only a crawl Plan can walk", () => {
  it("drops a high-ranked pub that would break the walking rule", () => {
    const route = walkableDraftRoute(ranked([LSW, JUNCTION, PHEONIX, NEAR_JUNCTION]), 3);
    expect(route).not.toBeNull();
    expect(route).not.toContain("pheonix");
    expect(route?.[0]).toBe("lsw");
    expect(new Set(route)).toEqual(new Set(["lsw", "junction", "near-junction"]));
  });

  it("refuses rather than proposes when no three pubs make one walk", () => {
    expect(walkableDraftRoute(ranked([LSW, PHEONIX, { id: "far", lat: 51.52, lng: -0.08 }]), 3)).toBeNull();
    expect(walkableDraftRoute(ranked([LSW, JUNCTION]), 3)).toBeNull();
  });

  it("starts at the best-ranked pub that can start a walkable crawl", () => {
    // PHEONIX ranks first but has no walkable companions here, so LSW starts.
    const route = walkableDraftRoute(ranked([PHEONIX, LSW, JUNCTION, NEAR_JUNCTION]), 3);
    expect(route?.[0]).toBe("lsw");
  });

  it("orders the companions for the shorter walk", () => {
    const route = walkableDraftRoute(ranked([LSW, NEAR_JUNCTION, JUNCTION]), 3)!;
    const points = route.map((id) => [LSW, JUNCTION, NEAR_JUNCTION].find((row) => row.id === id)!);
    const reversed = [points[0]!, points[2]!, points[1]!];
    expect(straightLineWalkableKm(points)!).toBeLessThanOrEqual(straightLineWalkableKm(reversed) ?? Infinity);
  });

  it("the walking rule is Plan's own: 1.6 km a leg, 3 km a route", () => {
    expect(straightLineWalkableKm([LSW, JUNCTION, NEAR_JUNCTION])).not.toBeNull();
    expect(straightLineWalkableKm([LSW, PHEONIX])).toBeNull();
  });
});

describe("propose_plan drafts a walkable crawl from the real pack", () => {
  it.each([
    "Plan a crawl in Clapham for 4, not pricey",
    "Plan a crawl in Soho for 4",
  ])("%s", async (query) => {
    const result = await runAskTool("propose_plan", { query }, { cityId: "london", query, skipModel: true });
    expect(result.ok).toBe(true);
    const stops = (result.data as { stops: { lat: number; lng: number }[] }).stops;
    expect(stops).toHaveLength(3);
    expect(straightLineWalkableKm(stops)).not.toBeNull();
    const draft = result.proposals.find((proposal) => proposal.kind === "draft_plan");
    expect(draft).toBeDefined();
    expect(result.answerHint).toContain("Open in Plan to keep these pubs.");
  });
});

describe("walkableDraftAround: a spread-out ranking still drafts one walk", () => {
  it("starts at the best seed that has walkable companions nearby", () => {
    const far = { id: "far", lat: 51.52, lng: -0.08 };
    const nearFar = [{ id: "near-far-1", lat: 51.5205, lng: -0.081 }, { id: "near-far-2", lat: 51.5195, lng: -0.0785 }];
    const seeds = ranked([PHEONIX, far]);
    const route = walkableDraftAround(seeds, (seed) =>
      seed.value === "far" ? ranked(nearFar) : [], 3);
    expect(route).toEqual(expect.arrayContaining(["far", "near-far-1", "near-far-2"]));
    expect(route?.[0]).toBe("far");
  });

  it("is null when no seed has walkable companions", () => {
    expect(walkableDraftAround(ranked([LSW, PHEONIX]), () => [], 3)).toBeNull();
  });
});

describe("propose_plan with no area named still drafts a walkable crawl", () => {
  it.each([
    "Plan a big night for four of us, with cheap pints and a lively route",
    "Plan a crawl for 4",
  ])("%s", async (query) => {
    const result = await runAskTool("propose_plan", { query }, { cityId: "london", query, skipModel: true });
    expect(result.ok).toBe(true);
    const stops = (result.data as { stops: { lat: number; lng: number }[] }).stops;
    expect(stops).toHaveLength(3);
    expect(straightLineWalkableKm(stops)).not.toBeNull();
  });
});
