import { describe, expect, it } from "vitest";

import {
  anchorConflictMessage,
  composerCreatePayload,
  composerRouteMutation,
  createdPlanNeedsReadyTransition,
  editedPlanStop,
  errorMessageFromBody,
  applyPlanStopCount,
  generatedPlanAnchorFromResponse,
  isMatchingAnchorOnlyPlan,
  isGroundedGeneratedRoute,
  nightAreaCoverageSummary,
  nightAreaCoverageMeta,
  nightAreaMapHref,
  nightAreaOptionLabel,
  nightAreaSelectorGroups,
  nightContextChanged,
  parsePlanRouteDraft,
  planAcceptanceTelemetry,
  planCreationConsumesPlanningIntent,
  planComposerVenueIndexPath,
  planDraftSavedTelemetry,
  planGenerationFailureStatus,
  planLockValidationError,
  routeStopsFromGenerated,
  serverPlanCreationAttribution,
  swapDraftStop,
} from "@/components/plan/PlanComposer";
import { getNightArea } from "@/lib/nightAreas";
import { createPlanIntakeDraft } from "@/lib/planIntake";

describe("PlanComposer PlanningIntent settlement", () => {
  const intent = { acceptedVenueId: "venue-accepted" };

  it("settles only when created Stop 1 consumed the accepted Venue", () => {
    expect(planCreationConsumesPlanningIntent(intent, [
      { venueId: "venue-accepted" },
      { venueId: "venue-next" },
    ])).toBe(true);
    expect(planCreationConsumesPlanningIntent(intent, [
      { venueId: "venue-existing" },
      { venueId: "venue-accepted" },
    ])).toBe(false);
    expect(planCreationConsumesPlanningIntent(null, [
      { venueId: "venue-accepted" },
    ])).toBe(false);
  });
});

describe("PlanComposer accepted city authority", () => {
  it("sends the accepted city when creating the Plan", () => {
    expect(composerCreatePayload({
      title: "Manchester night",
      creatorName: "Karan",
      startTime: "2026-07-24T20:00:00.000Z",
      cityId: "manchester",
      stops: [{ venueId: "manchester-pub", venueName: "The Manchester Pub" }],
      groundingProof: "signed-proof",
      planAnchor: { venueId: "manchester-pub", source: "near", outcome: "anchor-only" },
      context: {
        nightArea: "piccadilly-soho", daypart: "evening", partyType: "friends", groupSize: null,
        stopCount: 3, budget: "value", budgetLimitPence: null, zeroProof: false,
        wetherspoonsPreferred: false, atmosphere: [], foodNeeds: [], accessibility: [], transportConstraints: [],
      },
    })).toMatchObject({
      cityId: "manchester",
      stops: [{ venueId: "manchester-pub", venueName: "The Manchester Pub" }],
      anchor: { venueId: "manchester-pub", source: "near", outcome: "anchor-only" },
      context: expect.objectContaining({ nightArea: "piccadilly-soho" }),
    });
  });

  it("resolves accepted Venue names from the accepted city's index", () => {
    expect(planComposerVenueIndexPath("manchester")).toBe(
      "/data/cities/manchester/venues_slim.json",
    );
  });
});

describe("PlanComposer accepted Stop 1 naming", () => {
  const accepted = {
    key: 1,
    venueId: "venue-accepted",
    venueName: "",
    alternatives: [],
  };

  it("keeps accepted authority while the fallback name is typed", () => {
    expect(editedPlanStop({
      stop: accepted,
      venueName: "The pub beside the station",
      venues: [],
      acceptedVenueId: "venue-accepted",
    })).toEqual({
      stop: { ...accepted, venueName: "The pub beside the station" },
      preservesAcceptedAuthority: true,
    });
  });

  it("identifies a different indexed pub as an authority-changing edit", () => {
    expect(editedPlanStop({
      stop: accepted,
      venueName: "Different Arms",
      venues: [{ id: "venue-different", name: "Different Arms" }],
      acceptedVenueId: "venue-accepted",
    })).toMatchObject({
      stop: { venueId: "venue-different" },
      preservesAcceptedAuthority: false,
    });
  });
});

describe("PlanComposer route mutation authority", () => {
  const current = [
    { key: 1, venueId: "accepted", venueName: "Accepted", alternatives: [] },
    { key: 2, venueId: "second", venueName: "Second", alternatives: [] },
    { key: 3, venueId: "third", venueName: "Third", alternatives: [] },
  ];
  const authority = {
    groundingProof: "signed-proof",
    createOperationKey: "operation-key",
    planAnchor: { venueId: "accepted", source: "near", outcome: "route" } as const,
    routeStale: false,
  };

  it.each([
    ["edits Stop 2", current.map((stop, index) => index === 1 ? { ...stop, venueId: "replacement", venueName: "Replacement" } : stop)],
    ["removes Stop 3", current.slice(0, 2)],
    ["adds a Stop", [...current, { key: 4, venueId: "fourth", venueName: "Fourth", alternatives: [] }]],
  ])("invalidates exact-route proof when it %s", (_label, nextStops) => {
    expect(composerRouteMutation({
      currentStops: current,
      nextStops,
      acceptedVenueId: "accepted",
      ...authority,
    })).toMatchObject({
      accepted: true,
      stops: nextStops,
      groundingProof: null,
      createOperationKey: null,
      planAnchor: authority.planAnchor,
      routeStale: true,
    });
  });

  it("refuses a mutation that removes accepted Stop 1", () => {
    expect(composerRouteMutation({
      currentStops: current,
      nextStops: current.slice(1),
      acceptedVenueId: "accepted",
      ...authority,
    })).toMatchObject({
      accepted: false,
      stops: current,
      groundingProof: "signed-proof",
      planAnchor: authority.planAnchor,
      routeStale: false,
    });
  });

  it("keeps authority when only accepted Stop 1 display text changes", () => {
    const nextStops = [{ ...current[0]!, venueName: "Resolved name" }, ...current.slice(1)];
    expect(composerRouteMutation({
      currentStops: current,
      nextStops,
      acceptedVenueId: "accepted",
      ...authority,
    })).toMatchObject({
      accepted: true,
      stops: nextStops,
      groundingProof: "signed-proof",
      createOperationKey: "operation-key",
      routeStale: false,
    });
  });
});

describe("PlanComposer created Plan readiness", () => {
  const plan = {
    id: "11111111-1111-4111-8111-111111111111",
    title: "Tonight",
    startTime: "2026-08-15T19:00:00.000Z",
    createdAt: "2026-08-15T12:00:00.000Z",
    status: "draft" as const,
    anchorVenueId: "accepted",
    anchorSource: "near" as const,
  };

  it("keeps an anchor-only one-Stop Plan in draft", () => {
    expect(createdPlanNeedsReadyTransition({
      plan: { ...plan, outcome: "anchor-only", routeReadyAt: null },
      stops: [{ venueId: "accepted", venueName: "Accepted", position: 0 }],
      crew: [],
    })).toBe(false);
  });

  it("marks a grounded anchored route with its readiness timestamp", () => {
    expect(createdPlanNeedsReadyTransition({
      plan: { ...plan, outcome: "route", routeReadyAt: "2026-08-15T12:00:00.000Z" },
      stops: [
        { venueId: "accepted", venueName: "Accepted", position: 0 },
        { venueId: "second", venueName: "Second", position: 1 },
        { venueId: "third", venueName: "Third", position: 2 },
      ],
      crew: [],
    })).toBe(true);
  });

  it("marks an unanchored three-Stop lock-in, which carries no anchor metadata", () => {
    expect(createdPlanNeedsReadyTransition({
      plan: {
        id: plan.id,
        title: plan.title,
        startTime: plan.startTime,
        createdAt: plan.createdAt,
        status: "draft",
        anchorVenueId: null,
        anchorSource: null,
        outcome: null,
        routeReadyAt: null,
      },
      stops: [
        { venueId: "first", venueName: "First", position: 0 },
        { venueId: "second", venueName: "Second", position: 1 },
        { venueId: "third", venueName: "Third", position: 2 },
      ],
      crew: [],
    })).toBe(true);
  });

  it("asks for no transition when the created Plan already left draft", () => {
    expect(createdPlanNeedsReadyTransition({
      plan: { ...plan, status: "ready", outcome: null, routeReadyAt: null },
      stops: [
        { venueId: "first", venueName: "First", position: 0 },
        { venueId: "second", venueName: "Second", position: 1 },
        { venueId: "third", venueName: "Third", position: 2 },
      ],
      crew: [],
    })).toBe(false);
  });
});

describe("PlanComposer anchor-only telemetry", () => {
  it("rebuilds plan_draft_saved only from grounded server attribution and matching anchor metadata", () => {
    const anchor = { venueId: "venue-accepted", source: "near", outcome: "anchor-only" } as const;

    expect(planDraftSavedTelemetry(
      { created: true, grounded: true },
      anchor,
      [{ venueId: "venue-accepted" }],
    )).toEqual({
      stops: 1,
      grounded: true,
      anchored: true,
      routeReady: false,
      source: "near",
    });
    expect(planDraftSavedTelemetry(
      { created: true, grounded: false },
      anchor,
      [{ venueId: "venue-accepted" }],
    )).toBeNull();
    expect(planDraftSavedTelemetry(
      { created: true, grounded: true },
      anchor,
      [{ venueId: "venue-other" }],
    )).toBeNull();
  });
});

describe("PlanComposer Night Area coverage states", () => {
  const groups = nightAreaSelectorGroups(new Date("2026-07-13T12:00:00.000Z"));

  it("keeps route-ready areas available in the context selector", () => {
    const ready = groups.find((group) => group.label === "Prices checked");

    expect(ready).toMatchObject({ disabled: false });
    expect(ready?.areas.map((area) => area.slug)).toEqual([
      "clapham",
      "victoria",
      "piccadilly-soho",
      "canary-wharf",
    ]);
    expect(nightAreaOptionLabel(ready!.areas[0], false)).toBe("Clapham");
  });

  it("keeps unchecked areas available with an honest label", () => {
    const notReady = groups.find((group) => group.label === "Not all checked");
    const barnes = notReady?.areas.find((area) => area.slug === "barnes");

    expect(notReady).toMatchObject({ disabled: false });
    expect(barnes).toBeDefined();
    expect(nightAreaOptionLabel(barnes!, false)).toBe("Barnes - not all checked");
  });

  it("turns the structured route gate response into useful error copy", () => {
    expect(errorMessageFromBody({
      error: {
        code: "NIGHT_AREA_ROUTE_NOT_READY",
        message: "We're still checking this area before planning a crawl.",
      },
      nightArea: { id: "barnes" },
    }, "fallback")).toBe(
      "Barnes is not ready for route planning yet. We're still checking this area before planning a crawl. Choose another area to continue.",
    );
  });

  it("keeps legacy district route-gate payloads readable during the Night Area transition", () => {
    expect(errorMessageFromBody({
      error: {
        code: "DISTRICT_ROUTE_NOT_READY",
        message: "We're still checking this area before planning a crawl.",
      },
      district: { id: "chiswick" },
    }, "fallback")).toBe(
      "Chiswick is not ready for route planning yet. We're still checking this area before planning a crawl. Choose another area to continue.",
    );
  });

  it("shows the review window instead of presenting coverage as timeless", () => {
    const now = new Date("2026-07-13T12:00:00.000Z");

    expect(nightAreaCoverageMeta(getNightArea("clapham"), now)).toBe(
      "Last checked 13 Jul 2026 · review through 1 Jan 2027.",
    );
    expect(nightAreaCoverageMeta(getNightArea("shoreditch"), now)).toBe(
      "Not checked yet.",
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
      label: "Not all checked",
      detail: "Some checks complete. Missing opening hours and route feasibility + 2 more.",
      tone: "capture",
    });
    expect(nightAreaCoverageSummary(getNightArea("barnes"), now)).toMatchObject({
      label: "Not all checked",
      detail: "Checked with gaps. Missing opening hours and the route home.",
      tone: "review",
    });
    expect(nightAreaCoverageSummary(getNightArea("dalston"), now)).toMatchObject({
      label: "Rough guess",
      detail: "We haven't checked this area yet. The route stays yours to change.",
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
  it("keeps first-generation failures free of stale-route wording", () => {
    expect(planGenerationFailureStatus("Could not sort this one.", false)).toBe(
      "Could not sort this one.",
    );
  });

  it("names the retained route when a refresh fails", () => {
    expect(planGenerationFailureStatus("Could not sort this one.", true)).toBe(
      "The previous route is still here. Could not sort this one.",
    );
  });

  it("uses house error copy when Lock it in is missing only a name", () => {
    expect(planLockValidationError({
      title: "Thursday crawl",
      creatorName: " ",
      startTime: "2026-07-20T18:00",
      completeStopCount: 2,
      visibleStopCount: 2,
    })).toEqual({ message: "Add your name.", focus: "name" });
  });

  it("keeps the broader Lock it in validation copy for mixed missing fields", () => {
    expect(planLockValidationError({
      title: "Thursday crawl",
      creatorName: " ",
      startTime: "",
      completeStopCount: 0,
      visibleStopCount: 0,
    })).toEqual({
      message: "Add your name, a start time, and choose at least one venue from the list.",
      focus: "name",
    });
  });

  it("blocks blank visible stops before the final action", () => {
    expect(planLockValidationError({
      title: "Thursday crawl",
      creatorName: "Karan",
      startTime: "2026-07-20T18:00",
      completeStopCount: 1,
      visibleStopCount: 2,
    })).toEqual({
      message: "Choose a venue for every visible stop.",
      focus: null,
    });
  });

  it("blocks a generated one-Stop Plan unless its anchor-only outcome names Stop 1", () => {
    const generatedOneStop = {
      title: "Thursday crawl",
      creatorName: "Karan",
      startTime: "2026-07-20T18:00",
      completeStopCount: 1,
      visibleStopCount: 1,
      groundingProof: "signed-proof",
      singleStopVenueId: "venue-a",
    };

    expect(planLockValidationError(generatedOneStop)).toEqual({
      message: "Sort this pub again before locking it in.",
      focus: null,
    });
    expect(planLockValidationError({
      ...generatedOneStop,
      planAnchor: { venueId: "venue-a", source: "near", outcome: "route" as const },
    })).toEqual({
      message: "Sort this pub again before locking it in.",
      focus: null,
    });
    expect(planLockValidationError({
      ...generatedOneStop,
      planAnchor: { venueId: "venue-b", source: "near", outcome: "anchor-only" as const },
    })).toEqual({
      message: "Sort this pub again before locking it in.",
      focus: null,
    });
    expect(planLockValidationError({
      ...generatedOneStop,
      planAnchor: { venueId: "venue-a", source: "near", outcome: "anchor-only" as const },
    })).toBeNull();
    expect(isMatchingAnchorOnlyPlan({
      groundingProof: "signed-proof",
      completeStopCount: 1,
      singleStopVenueId: "venue-a",
      planAnchor: { venueId: "venue-a", source: "near", outcome: "anchor-only" },
    })).toBe(true);
  });

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
    expect(isGroundedGeneratedRoute({
      grounded: true,
      groundingProof: "signed-proof",
      anchored: true,
      anchorVenueId: "a",
      anchorSource: "near",
      outcome: "anchor-only",
    }, stops.slice(0, 1))).toBe(true);
    expect(isGroundedGeneratedRoute({ routeRevision: 7 }, stops)).toBe(false);
    expect(isGroundedGeneratedRoute({ grounded: true, groundingProof: "signed-proof" }, stops.slice(0, 2))).toBe(false);
  });

  it("reads only exact server-returned anchor metadata", () => {
    expect(generatedPlanAnchorFromResponse({
      anchored: true,
      anchorVenueId: "venue-a",
      anchorSource: "near",
      outcome: "route",
    })).toEqual({ venueId: "venue-a", source: "near", outcome: "route" });
    expect(generatedPlanAnchorFromResponse({
      anchored: true,
      anchorVenueId: "venue-a",
      anchorSource: "near",
      outcome: "wrong",
    })).toBeNull();
    expect(generatedPlanAnchorFromResponse({
      anchored: false,
      anchorVenueId: "venue-a",
      anchorSource: "near",
      outcome: "route",
    })).toBeNull();
  });

  it("keeps generated stops and attaches the top-level alternative pool", () => {
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

    expect(stops).toHaveLength(4);
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
      wetherspoonsPreferred: false,
      atmosphere: [],
      foodNeeds: [],
      accessibility: [],
      transportConstraints: [],
    };

    expect(nightContextChanged(context, { ...context })).toBe(false);
    expect(nightContextChanged(context, { ...context, budget: "value" })).toBe(true);
    expect(nightContextChanged(context, { ...context, stopCount: 3 })).toBe(false);
    expect(nightContextChanged(context, { ...context, stopCount: 4 })).toBe(true);

    const synced = applyPlanStopCount(
      createPlanIntakeDraft(),
      { ...context, stopCount: 3 },
      4,
    );
    expect(synced.draft.answers.stopCount).toBe(4);
    expect(synced.context?.stopCount).toBe(4);
  });
});

describe("PlanComposer anchor-conflict reporting", () => {
  // The route optimizer answers HTTP 200 with an empty Stops list when the
  // accepted pub itself is what refused, so the empty-route branch would have
  // printed "No venues matched that ask" over the one sentence that names the
  // real reason. Every conflict code travels this way.
  it("prints the server sentence for an anchor conflict answered 200", () => {
    expect(anchorConflictMessage({
      grounded: false,
      outcome: "anchor-conflict",
      stops: [],
      reason: "ANCHOR_OPENING_CONFLICT",
      message: "That pub is not open for your chosen time. Adjust the time or accept another pub.",
    })).toBe("That pub is not open for your chosen time. Adjust the time or accept another pub.");
  });

  it("falls back to one honest sentence when the conflict carries no message", () => {
    expect(anchorConflictMessage({ outcome: "anchor-conflict", stops: [] }))
      .toBe("We could not build a route from that pub right now. Try a different pub.");
    expect(anchorConflictMessage({ outcome: "anchor-conflict", message: "   " }))
      .toBe("We could not build a route from that pub right now. Try a different pub.");
  });

  it("stays out of the way of every other generation outcome", () => {
    expect(anchorConflictMessage({ outcome: "anchor-only", message: "Kept." })).toBeNull();
    expect(anchorConflictMessage({ stops: [], message: "Nothing matched." })).toBeNull();
    expect(anchorConflictMessage(null)).toBeNull();
    expect(anchorConflictMessage("anchor-conflict")).toBeNull();
  });
});
