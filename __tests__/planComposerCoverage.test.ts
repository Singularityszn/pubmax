import { describe, expect, it } from "vitest";

import {
  errorMessageFromBody,
  isGroundedGeneratedRoute,
  nightAreaCoverageSummary,
  nightAreaCoverageMeta,
  nightAreaMapHref,
  nightAreaOptionLabel,
  nightAreaSelectorGroups,
  nightContextChanged,
  parsePlanRouteDraft,
  planAcceptanceTelemetry,
  routeStopsFromGenerated,
  serverPlanCreationAttribution,
  swapDraftStop,
} from "@/components/plan/PlanComposer";
import { getNightArea } from "@/lib/nightAreas";

describe("PlanComposer Night Area coverage states", () => {
  const groups = nightAreaSelectorGroups(new Date("2026-07-13T12:00:00.000Z"));

  it("keeps route-ready areas available in the context selector", () => {
    const ready = groups.find((group) => group.label === "Higher confidence");

    expect(ready).toMatchObject({ disabled: false });
    expect(ready?.areas.map((area) => area.slug)).toEqual([
      "clapham",
      "victoria",
      "piccadilly-soho",
      "canary-wharf",
    ]);
    expect(nightAreaOptionLabel(ready!.areas[0], false)).toBe("Clapham");
  });

  it("keeps lower-confidence areas available with an evidence label", () => {
    const notReady = groups.find((group) => group.label === "Plan with warnings");
    const barnes = notReady?.areas.find((area) => area.slug === "barnes");

    expect(notReady).toMatchObject({ disabled: false });
    expect(barnes).toBeDefined();
    expect(nightAreaOptionLabel(barnes!, false)).toBe("Barnes - plan with evidence gaps");
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
      label: "Plan with warnings",
      detail: "Captured coverage, missing opening hours and route feasibility + 2 more.",
      tone: "capture",
    });
    expect(nightAreaCoverageSummary(getNightArea("barnes"), now)).toMatchObject({
      label: "Plan with warnings",
      detail: "Reviewed coverage, missing opening hours and the route home.",
      tone: "review",
    });
    expect(nightAreaCoverageSummary(getNightArea("dalston"), now)).toMatchObject({
      label: "Low confidence",
      detail: "Evidence capture has not started. The route stays editable.",
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

describe("PlanComposer route preview seam", () => {
  it("never restores client-writable grounding attribution from local storage", () => {
    const restored = parsePlanRouteDraft(JSON.stringify({
      stops: [
        { key: 1, venueId: "a", venueName: "A", alternatives: [] },
        { key: 2, venueId: "b", venueName: "B", alternatives: [] },
        { key: 3, venueId: "c", venueName: "C", alternatives: [] },
      ],
      routeGrounded: true,
    }));

    expect(restored).not.toHaveProperty("routeGrounded");
  });

  it("emits acceptance only for a server-attributed first creation", () => {
    expect(planAcceptanceTelemetry({ created: true, grounded: true }, 3)).toEqual({ stops: 3, grounded: true });
    expect(planAcceptanceTelemetry({ created: false, grounded: true }, 3)).toEqual({ stops: 3, grounded: true });
    expect(planAcceptanceTelemetry({ created: true, grounded: "true" }, 3)).toBeNull();
    expect(serverPlanCreationAttribution({ created: false, grounded: false })).toEqual({ created: false, grounded: false });
  });

  it("uses the generator's explicit grounding assertion instead of route revision metadata", () => {
    const stops = routeStopsFromGenerated([
      { venueId: "a", venueName: "A" },
      { venueId: "b", venueName: "B" },
      { venueId: "c", venueName: "C" },
    ]);

    expect(isGroundedGeneratedRoute({ grounded: true, groundingProof: "signed-proof" }, stops)).toBe(true);
    expect(isGroundedGeneratedRoute({ routeRevision: 7 }, stops)).toBe(false);
    expect(isGroundedGeneratedRoute({ grounded: true, groundingProof: "signed-proof" }, stops.slice(0, 2))).toBe(false);
  });

  it("keeps exactly three generated stops and attaches the top-level alternative pool", () => {
    const stops = routeStopsFromGenerated([
      { venueId: "a", venueName: "A" },
      { venueId: "b", venueName: "B" },
      { venueId: "c", venueName: "C" },
      { venueId: "d", venueName: "D" },
    ], [
      { venueId: "a", venueName: "duplicate current" },
      { venueId: "x", venueName: "X" },
      { venueId: "x", venueName: "X again" },
    ]);

    expect(stops).toHaveLength(3);
    expect(stops[0]?.alternatives).toEqual([{ venueId: "x", venueName: "X" }]);
  });

  it("cycles a grounded swap while retaining the previous venue as an alternative", () => {
    const next = swapDraftStop({
      key: 1,
      venueId: "a",
      venueName: "A",
      alternatives: [{ venueId: "x", venueName: "X" }, { venueId: "y", venueName: "Y" }],
    });

    expect(next).toMatchObject({ venueId: "x", venueName: "X" });
    expect(next.alternatives).toEqual([
      { venueId: "y", venueName: "Y" },
      { venueId: "a", venueName: "A" },
    ]);
  });

  it("skips alternatives already used by another route stop", () => {
    const current = {
      key: 1,
      venueId: "a",
      venueName: "A",
      alternatives: [{ venueId: "b", venueName: "B" }, { venueId: "x", venueName: "X" }],
    };

    expect(swapDraftStop(current, new Set(["b"]))).toMatchObject({ venueId: "x", venueName: "X" });
    expect(swapDraftStop(current, new Set(["b", "x"]))).toBe(current);
  });

  it("marks only real context changes as route-staling edits", () => {
    const context = {
      nightArea: "clapham" as const,
      daypart: "evening" as const,
      partyType: "friends" as const,
      groupSize: 4,
      budget: "standard" as const,
      budgetLimitPence: null,
      zeroProof: false,
      atmosphere: [],
      foodNeeds: [],
      accessibility: [],
      transportConstraints: [],
    };

    expect(nightContextChanged(context, { ...context })).toBe(false);
    expect(nightContextChanged(context, { ...context, budget: "value" })).toBe(true);
  });
});
