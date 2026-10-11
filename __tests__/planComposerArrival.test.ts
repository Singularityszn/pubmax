// @vitest-environment jsdom

import { afterEach, describe, expect, it } from "vitest";
import { readPlanComposerRecovery } from "@/components/plan/PlanComposerRecovery";
import { createPlanIntakeDraft, PLAN_INTAKE_STORAGE_KEY, writePlanIntakeDraft } from "@/lib/planIntake";
import { PLANNING_INTENT_STORAGE_KEY, writePlanningIntent } from "@/lib/planningIntent";
import { capturePlanEntryArrival } from "@/components/plan/PlanEntryArrival";

afterEach(() => {
  localStorage.clear();
  sessionStorage.clear();
});

describe("Plan recovery after its module loads", () => {
  it("keeps a newer intake draft while rejecting the invalid arrival value", () => {
    const arrival = {
      capturedAt: Date.now(),
      planDraftV1: null,
      planDraftV2: null,
      routeDraftV1: null,
      routeDraftV2: null,
      intakeDraft: "invalid intake bytes",
      planningIntent: null,
      rememberedArea: null,
      askDraft: null,
      search: "",
    };
    localStorage.setItem(PLAN_INTAKE_STORAGE_KEY, arrival.intakeDraft);
    writePlanIntakeDraft(createPlanIntakeDraft());
    const newer = localStorage.getItem(PLAN_INTAKE_STORAGE_KEY);

    const recovered = readPlanComposerRecovery(arrival);

    expect(recovered.hasDurableIntakeDraft).toBe(false);
    expect(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBe(newer);
  });

  it("keeps a newly accepted pub when the arrival's rejected intent is cleaned", () => {
    sessionStorage.setItem(PLANNING_INTENT_STORAGE_KEY, "rejected intent bytes");
    const arrival = capturePlanEntryArrival();
    writePlanningIntent({
      source: "near",
      cityId: "london",
      acceptedVenueId: "venue-abc123",
      acceptedArea: { kind: "night-patch", id: "soho" },
      startsAt: null,
      displayEvidence: { kind: "price", observedAt: null },
    });
    const newer = sessionStorage.getItem(PLANNING_INTENT_STORAGE_KEY);

    expect(readPlanComposerRecovery(arrival).handoff).toBeNull();
    expect(sessionStorage.getItem(PLANNING_INTENT_STORAGE_KEY)).toBe(newer);
  });

  it("still removes rejected bytes when no newer arrival has replaced them", () => {
    localStorage.setItem(PLAN_INTAKE_STORAGE_KEY, "rejected intake bytes");
    sessionStorage.setItem(PLANNING_INTENT_STORAGE_KEY, "rejected intent bytes");

    readPlanComposerRecovery(capturePlanEntryArrival());

    expect(localStorage.getItem(PLAN_INTAKE_STORAGE_KEY)).toBeNull();
    expect(sessionStorage.getItem(PLANNING_INTENT_STORAGE_KEY)).toBeNull();
  });
});
