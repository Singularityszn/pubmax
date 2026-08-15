import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";

import {
  parsePlanDraftEnvelope,
  readPlanDraftEnvelope,
  writePlanDraftEnvelope,
  type ParsedPlanDraft,
  type StoredPlanDraft,
} from "@/lib/planDraft";
import {
  readPlanRouteDraftEnvelope,
  writePlanRouteDraftEnvelope,
  type ParsedPlanRouteDraft,
} from "@/lib/planRouteDraft";
import {
  createPlanIntakeDraft,
  readPlanIntakeDraftWithMetadata,
  writePlanIntakeDraft,
  type ParsedPlanIntakeDraft,
} from "@/lib/planIntake";
import { createPlanningIntent } from "@/lib/planningIntent";
import { PLAN_TEMPLATES } from "@/lib/planTemplates";
import {
  applyTemplate,
  composerLockErrorFromResponse,
  londonServiceDateLabel,
  seedProvisionalStop1,
  resolveComposerHydration,
  UNRESOLVED_ACCEPTED_VENUE_LABEL,
  UNRESOLVED_ACCEPTED_VENUE_NAME,
} from "@/lib/planComposerHandoff";

const NOW = Date.parse("2026-07-24T12:00:00.000Z");

function memoryStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() { return values.size; },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key); },
    setItem: (key, value) => { values.set(key, String(value)); },
  };
}

function storedPlan(overrides: Partial<StoredPlanDraft> = {}): StoredPlanDraft {
  return {
    title: "Friday Plan",
    creatorName: "K",
    startTime: "2026-07-24T18:00:00.000Z",
    conciergeQuery: "Quiet pints",
    stops: [{ key: 1, venueId: "venue-a", venueName: "Venue A" }],
    ...overrides,
  };
}

function v2Plan(savedAt: number): ParsedPlanDraft {
  const storage = memoryStorage();
  writePlanDraftEnvelope(storedPlan(), "manual", storage, savedAt);
  return readPlanDraftEnvelope(storage, savedAt) as ParsedPlanDraft;
}

function legacyPlan(): ParsedPlanDraft {
  return parsePlanDraftEnvelope(null, JSON.stringify(storedPlan()), NOW) as ParsedPlanDraft;
}

function fakeProof(expiresAt: number): string {
  const payload = Buffer.from(JSON.stringify({ v: 2, expiresAt }), "utf8").toString("base64url");
  return `${payload}.not-a-trusted-signature`;
}

function routeDraft(outcome: "route" | "anchor-only", savedAt = NOW): ParsedPlanRouteDraft {
  const storage = memoryStorage();
  const stops = outcome === "route"
    ? [
        { key: 1, venueId: "venue-a", venueName: "Venue A", alternatives: [] },
        { key: 2, venueId: "venue-b", venueName: "Venue B", alternatives: [] },
        { key: 3, venueId: "venue-c", venueName: "Venue C", alternatives: [] },
      ]
    : [{ key: 1, venueId: "venue-a", venueName: "Venue A", alternatives: [] }];
  writePlanRouteDraftEnvelope({
    anchorVenueId: "venue-a",
    anchorSource: "near",
    outcome,
    stops,
    alternatives: [],
    nightContext: null,
    routeTotals: null,
    transportBasis: null,
    planningConfidence: null,
    warnings: [],
    groundingProof: fakeProof(NOW + 60 * 60 * 1000),
    operationKey: "operation-1",
    routeRevision: 1,
    routeStale: false,
  }, "plan-generated", storage, savedAt);
  return readPlanRouteDraftEnvelope(storage, savedAt) as ParsedPlanRouteDraft;
}

function intakeDraft(savedAt: number): ParsedPlanIntakeDraft {
  const storage = memoryStorage();
  const blank = createPlanIntakeDraft();
  writePlanIntakeDraft({
    ...blank,
    currentStep: "group-size",
    settledSteps: ["area", "time-window"],
    answers: { ...blank.answers, area: "soho", timeWindow: "evening", exactStartIso: "2026-07-24T19:00:00.000Z" },
  }, storage, savedAt);
  return readPlanIntakeDraftWithMetadata(storage, savedAt) as ParsedPlanIntakeDraft;
}

function intent() {
  return createPlanningIntent({
    source: "near",
    cityId: "london",
    acceptedVenueId: "venue-intent",
    acceptedArea: { kind: "night-patch", id: "soho" },
    startsAt: "2026-07-24T20:00:00.000Z",
    displayEvidence: { kind: "directory", observedAt: null },
  }, NOW);
}

describe("resolveComposerHydration", () => {
  it("uses PlanningIntent as a permanent handoff", () => {
    const hydration = resolveComposerHydration({
      planDraft: null, routeDraft: null, intakeDraft: null,
      planningIntent: intent(), rememberedArea: null,
    });

    expect(hydration.active).toBe(true);
    expect(hydration.acceptedVenueId).toBe("venue-intent");
    expect(hydration.acceptedSource).toBe("near");
    expect(hydration.acceptedAnchor).toEqual({
      venueId: "venue-intent",
      source: "near",
      acceptedArea: { kind: "night-patch", id: "soho" },
      startsAt: "2026-07-24T20:00:00.000Z",
    });
    expect(hydration.showAcceptedSummary).toBe(true);
    expect(hydration.answeredArea).toBe(true);
    expect(hydration.answeredDate).toBe(true);
  });

  it("keeps explicit unknown area and date in the exact accepted anchor", () => {
    const planningIntent = intent();
    expect(planningIntent).not.toBeNull();
    const hydration = resolveComposerHydration({
      planDraft: null,
      routeDraft: null,
      intakeDraft: null,
      planningIntent: { ...planningIntent!, acceptedArea: null, startsAt: null },
      rememberedArea: { kind: "patch", id: "camden" },
    });

    expect(hydration.area).toEqual({ kind: "night-patch", id: "camden" });
    expect(hydration.acceptedAnchor).toEqual({
      venueId: "venue-intent",
      source: "near",
      acceptedArea: null,
      startsAt: null,
    });
  });

  it("stays generic when no accepted or recovered context exists", () => {
    const hydration = resolveComposerHydration({
      planDraft: null, routeDraft: null, intakeDraft: null,
      planningIntent: null, rememberedArea: null,
    });
    expect(hydration.active).toBe(false);
    expect(hydration.showAcceptedSummary).toBe(false);
    expect(hydration.answeredArea).toBe(false);
    expect(hydration.answeredDate).toBe(false);
    expect(hydration.acceptedVenueId).toBeNull();
  });

  it("prefills accepted context from intent without re-asking area or date", () => {
    const hydration = resolveComposerHydration({
      planDraft: null, routeDraft: null, intakeDraft: null,
      planningIntent: intent(), rememberedArea: null,
    });
    expect(hydration.active).toBe(true);
    expect(hydration.acceptedVenueId).toBe("venue-intent");
    expect(hydration.area).toEqual({ kind: "night-patch", id: "soho" });
    expect(hydration.startsAt).toBe("2026-07-24T20:00:00.000Z");
    expect(hydration.showAcceptedSummary).toBe(true);
    expect(hydration.answeredArea).toBe(true);
    expect(hydration.answeredDate).toBe(true);
    expect(hydration.defaultsMayWrite).toBe(true);
  });

  it("lets a newer Plan draft win over a newer intent and records the conflict", () => {
    const hydration = resolveComposerHydration({
      planDraft: v2Plan(NOW + 2_000), routeDraft: null, intakeDraft: null,
      planningIntent: intent(), rememberedArea: null,
    });
    expect(hydration.acceptedVenueId).toBe("venue-a");
    expect(hydration.conflicts.map((c) => c.code)).toContain("intent-preserved-existing");
  });

  it("preserves legacy Plan work ahead of intent", () => {
    const hydration = resolveComposerHydration({
      planDraft: legacyPlan(), routeDraft: null, intakeDraft: null,
      planningIntent: intent(), rememberedArea: null,
    });
    expect(hydration.acceptedVenueId).toBe("venue-a");
    expect(hydration.conflicts.some((c) => c.code === "intent-preserved-existing" && c.recoveryAction === "review-existing-plan")).toBe(true);
  });

  it("carries an anchor-only Route preview with its proof", () => {
    const hydration = resolveComposerHydration({
      planDraft: null, routeDraft: routeDraft("anchor-only"), intakeDraft: null,
      planningIntent: null, rememberedArea: null,
    });
    expect(hydration.routePreview?.value.outcome).toBe("anchor-only");
    expect(hydration.routeProofPresent).toBe(true);
    expect(hydration.showAcceptedSummary).toBe(true);
  });

  it("treats intake-answered area and date as answered (non-today date)", () => {
    const hydration = resolveComposerHydration({
      planDraft: null, routeDraft: null, intakeDraft: intakeDraft(NOW),
      planningIntent: null, rememberedArea: null,
    });
    expect(hydration.answeredArea).toBe(true);
    expect(hydration.answeredDate).toBe(true);
    expect(hydration.startsAt).toBe("2026-07-24T19:00:00.000Z");
  });

  it("keeps Route precedence and its conflict when permanent intent read sees both", () => {
    const hydration = resolveComposerHydration({
      planDraft: null, routeDraft: routeDraft("route"), intakeDraft: null,
      planningIntent: intent(), rememberedArea: null,
    });

    expect(hydration.acceptedVenueId).toBe("venue-a");
    expect(hydration.conflicts).toContainEqual(expect.objectContaining({
      code: "intent-preserved-existing",
      recoveryAction: "review-existing-plan",
    }));
  });
});

describe("provisional accepted Venue Stop 1 seed", () => {
  it("seeds one indexed accepted Venue when no saved Route or Plan stops exist", () => {
    expect(seedProvisionalStop1({
      acceptedVenueId: "venue-intent",
      venues: [{ id: "venue-intent", name: "The Accepted Arms" }],
      recoveredRouteStops: [],
      recoveredPlanStops: [],
    })).toEqual({
      key: 1,
      venueId: "venue-intent",
      venueName: "The Accepted Arms",
      alternatives: [],
    });
  });

  it("never seeds a raw Venue id as the Stop name", () => {
    // A pin promoted out of the UK base layer is absent from the slim index for
    // good, so the id would have printed as a pub name permanently rather than
    // for the moment before the fetch answered.
    const seeded = seedProvisionalStop1({
      acceptedVenueId: "venue-uk-osm-8123456",
      venues: [{ id: "venue-other", name: "Somewhere Else" }],
      recoveredRouteStops: [],
      recoveredPlanStops: [],
    });

    expect(seeded).toEqual({
      key: 1,
      venueId: "venue-uk-osm-8123456",
      venueName: UNRESOLVED_ACCEPTED_VENUE_NAME,
      alternatives: [],
    });
    expect(seeded?.venueName).not.toContain("venue-");
    expect(UNRESOLVED_ACCEPTED_VENUE_LABEL).not.toContain("venue-");

    // A missing index answers the same way as an index that does not carry it.
    expect(seedProvisionalStop1({
      acceptedVenueId: "venue-uk-osm-8123456",
      venues: null,
      recoveredRouteStops: [],
      recoveredPlanStops: [],
    })?.venueName).toBe(UNRESOLVED_ACCEPTED_VENUE_NAME);
  });

  it("does not replace recovered Route or Plan stops", () => {
    const accepted = { acceptedVenueId: "venue-intent", venues: [{ id: "venue-intent", name: "Accepted" }] };
    expect(seedProvisionalStop1({
      ...accepted,
      recoveredRouteStops: [{ venueId: "venue-route", venueName: "Route Stop" }],
      recoveredPlanStops: [],
    })).toBeNull();
    expect(seedProvisionalStop1({
      ...accepted,
      recoveredRouteStops: [],
      recoveredPlanStops: [{ venueId: "venue-plan", venueName: "Plan Stop" }],
    })).toBeNull();
  });
});

describe("composer template + lifecycle helpers", () => {
  it("applies a template without overriding accepted geography (Soho + Cheap round)", () => {
    const cheap = PLAN_TEMPLATES.find((t) => t.id === "cheap-round")!;
    const locked = applyTemplate(cheap, true);
    expect(locked).toMatchObject({ title: cheap.title, conciergeQuery: cheap.conciergeQuery, geographyLocked: true });
    expect(applyTemplate(cheap, false).geographyLocked).toBe(false);
  });

  it("maps 422 and 409 lock responses to honest recovery copy", () => {
    expect(composerLockErrorFromResponse(422)).toMatch(/refresh|regenerate/i);
    expect(composerLockErrorFromResponse(409)).toMatch(/already locked/i);
    expect(composerLockErrorFromResponse(500)).toBeNull();
  });

  it("formats a London service-date label and tolerates missing input", () => {
    expect(londonServiceDateLabel("2026-07-24T19:00:00.000Z")).toContain("Jul");
    expect(londonServiceDateLabel(null)).toBeNull();
    expect(londonServiceDateLabel("not-a-date")).toBeNull();
  });
});
