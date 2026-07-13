import { describe, expect, it } from "vitest";

import {
  errorMessageFromBody,
  nightAreaCoverageSummary,
  nightAreaCoverageMeta,
  nightAreaMapHref,
  nightAreaOptionLabel,
  nightAreaSelectorGroups,
} from "@/components/plan/PlanComposer";
import { getNightArea } from "@/lib/nightAreas";

describe("PlanComposer Night Area coverage states", () => {
  const groups = nightAreaSelectorGroups(new Date("2026-07-13T12:00:00.000Z"));

  it("keeps route-ready areas available in the context selector", () => {
    const ready = groups.find((group) => group.label === "Ready to plan");

    expect(ready).toMatchObject({ disabled: false });
    expect(ready?.areas.map((area) => area.slug)).toEqual([
      "clapham",
      "victoria",
      "piccadilly-soho",
      "canary-wharf",
    ]);
    expect(nightAreaOptionLabel(ready!.areas[0], false)).toBe("Clapham");
  });

  it("marks non-route-ready areas as unavailable without hiding them", () => {
    const notReady = groups.find((group) => group.label === "Not ready yet");
    const barnes = notReady?.areas.find((area) => area.slug === "barnes");

    expect(notReady).toMatchObject({ disabled: true });
    expect(barnes).toBeDefined();
    expect(nightAreaOptionLabel(barnes!, true)).toBe("Barnes — not route-ready");
  });

  it("turns the structured route gate response into useful error copy", () => {
    expect(errorMessageFromBody({
      error: {
        code: "NIGHT_AREA_ROUTE_NOT_READY",
        message: "We're still checking this Night Area before planning a Crawl Route.",
      },
      nightArea: { id: "barnes" },
    }, "fallback")).toBe(
      "Barnes is not ready for route planning yet. We're still checking this Night Area before planning a Crawl Route. Choose a ready area to continue.",
    );
  });

  it("keeps legacy district route-gate payloads readable during the Night Area transition", () => {
    expect(errorMessageFromBody({
      error: {
        code: "DISTRICT_ROUTE_NOT_READY",
        message: "We're still checking this Night Area before planning a Crawl Route.",
      },
      district: { id: "chiswick" },
    }, "fallback")).toBe(
      "Chiswick is not ready for route planning yet. We're still checking this Night Area before planning a Crawl Route. Choose a ready area to continue.",
    );
  });

  it("shows the review window instead of presenting coverage as timeless", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");

    expect(nightAreaCoverageMeta(getNightArea("clapham"), now)).toBe(
      "Last checked 13 Jul 2026 · review through 1 Jan 2027.",
    );
    expect(nightAreaCoverageMeta(getNightArea("shoreditch"), now)).toBe(
      "No reviewed snapshot yet.",
    );
    expect(nightAreaCoverageMeta(getNightArea("richmond"), now)).toBe(
      "Last checked 1 Jan 2026 · review expired 1 Jun 2026.",
    );
  });

  it("keeps every capture state explicit and names the evidence gap", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");

    expect(nightAreaCoverageSummary(getNightArea("clapham"), now)).toMatchObject({
      label: "Route-ready",
      tone: "ready",
    });
    expect(nightAreaCoverageSummary(getNightArea("shoreditch"), now)).toMatchObject({
      label: "Captured",
      detail: "Not route-ready yet — missing opening hours and route feasibility + 2 more.",
      tone: "capture",
    });
    expect(nightAreaCoverageSummary(getNightArea("barnes"), now)).toMatchObject({
      label: "Reviewed",
      detail: "Not route-ready yet — missing opening hours and the route home.",
      tone: "review",
    });
    expect(nightAreaCoverageSummary(getNightArea("dalston"), now)).toMatchObject({
      label: "Discovered",
      detail: "Not route-ready yet — evidence capture has not started.",
      tone: "discovery",
    });
  });

  it("keeps map exploration available for route-ready and queued areas", () => {
    expect(nightAreaMapHref(getNightArea("barnes"))).toBe("/map?q=Barnes");
    expect(nightAreaMapHref(getNightArea("bermondsey-london-bridge"))).toBe(
      "/map?q=Bermondsey%20%26%20London%20Bridge",
    );
  });
});
