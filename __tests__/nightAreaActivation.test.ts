import { describe, expect, it } from "vitest";

import { resolveNightAreaActivation } from "@/lib/nightAreaActivation";

const CHECKED_DATE = new Date("2026-08-23T18:00:00.000Z");

describe("Night Area activation route state", () => {
  it("hands a route-ready area to the canonical Plan query handoff", () => {
    expect(resolveNightAreaActivation({ slug: "clapham", now: CHECKED_DATE })).toMatchObject({
      kind: "ready",
      reason: "route-ready",
      areaName: "Clapham",
      primaryAction: {
        label: "Plan this night",
        href: "/plan?query=Plan+a+crawl+in+Clapham",
      },
    });
  });

  it("keeps an area without current route proof on the Map", () => {
    expect(resolveNightAreaActivation({ slug: "barnes", now: CHECKED_DATE })).toMatchObject({
      kind: "browse",
      reason: "not-ready",
      areaName: "Barnes",
      primaryAction: {
        label: "Browse Barnes pubs",
        href: "/map?q=Barnes",
      },
    });
  });

  it("turns an unknown slug into a labelled Map browse rather than a plan", () => {
    const state = resolveNightAreaActivation({ slug: "new-town" });

    expect(state).toMatchObject({
      kind: "browse",
      reason: "unknown",
      areaName: "New town",
      primaryAction: {
        label: "Browse the map",
        href: "/map?q=New+town",
      },
    });
    expect(state.primaryAction.href).not.toContain("/plan");
  });

  it("rejects a known area when the requested city does not own it", () => {
    const state = resolveNightAreaActivation({
      slug: "clapham",
      cityId: "manchester",
      now: CHECKED_DATE,
    });

    expect(state).toMatchObject({
      kind: "browse",
      reason: "city-mismatch",
      areaName: null,
      primaryAction: {
        label: "Open the Manchester map",
        href: "/map/manchester",
      },
    });
    expect(state.primaryAction.href).not.toContain("/plan");
  });

  it("fails closed for an invalid city instead of defaulting to London", () => {
    expect(resolveNightAreaActivation({ slug: "clapham", cityId: "not-a-city" })).toMatchObject({
      kind: "browse",
      reason: "invalid-city",
      areaName: null,
      primaryAction: {
        label: "Open the London map",
        href: "/map",
      },
    });
  });
});
