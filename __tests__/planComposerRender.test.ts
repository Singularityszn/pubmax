import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { AcceptedContextPanel, PlanComposerErrorNotice } from "@/components/plan/PlanComposer";
import {
  readPlanDraftEnvelope,
  writePlanDraftEnvelope,
  type ParsedPlanDraft,
} from "@/lib/planDraft";
import {
  composerLockErrorFromResponse,
  resolveComposerHydration,
} from "@/lib/planComposerHandoff";
import { createPlanningIntent } from "@/lib/planningIntent";

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

function v2Plan(savedAt: number): ParsedPlanDraft {
  const storage = memoryStorage();
  writePlanDraftEnvelope({
    title: "Friday Plan",
    creatorName: "K",
    startTime: "2026-07-24T18:00:00.000Z",
    conciergeQuery: "Quiet pints",
    stops: [{ key: 1, venueId: "venue-a", venueName: "Venue A" }],
  }, "manual", storage, savedAt);
  return readPlanDraftEnvelope(storage, savedAt) as ParsedPlanDraft;
}

describe("PlanComposer rendered UI", () => {
  it("renders accepted context before intake completion", () => {
    const handoff = resolveComposerHydration({
      planDraft: null, routeDraft: null, intakeDraft: null,
      planningIntent: intent(), rememberedArea: null,
    });
    const html = renderToStaticMarkup(createElement(AcceptedContextPanel, { handoff }));

    expect(handoff.showAcceptedSummary).toBe(true);
    expect(html).toContain("Carried over from what you accepted");
    expect(html).toContain("venue-intent");
  });

  it("renders the accepted Venue/area/date summary and marks area+date answered so intake never re-asks", () => {
    const handoff = resolveComposerHydration({
      planDraft: null, routeDraft: null, intakeDraft: null,
      planningIntent: intent(), rememberedArea: null,
    });
    const html = renderToStaticMarkup(createElement(AcceptedContextPanel, { handoff }));

    expect(html).toContain("Carried over from what you accepted");
    expect(html).toContain("venue-intent");
    expect(html).toContain("soho");
    expect(html).toContain("Jul"); // London service-date label for the accepted start
    expect(html).toContain("You can still change any of these below");
    // The same hydration marks area + date answered, which is what suppresses the
    // area/date intake steps (PlanIntake is seeded settled; untouched here per the hold).
    expect(handoff.answeredArea).toBe(true);
    expect(handoff.answeredDate).toBe(true);
  });

  it("renders the 'kept existing Plan work' conflict note when a newer Plan draft beats a newer intent", () => {
    const handoff = resolveComposerHydration({
      planDraft: v2Plan(NOW + 2_000), routeDraft: null, intakeDraft: null,
      planningIntent: intent(), rememberedArea: null,
    });
    expect(handoff.conflicts.map((conflict) => conflict.code)).toContain("intent-preserved-existing");

    const html = renderToStaticMarkup(createElement(AcceptedContextPanel, { handoff }));
    expect(html).toContain("Plan changes we kept safe");
    expect(html).toContain("Kept existing Plan work");
  });

  it("renders the anchored 422 and 409 lock-failure recovery copy in the alert banner", () => {
    const copy422 = composerLockErrorFromResponse(422);
    const copy409 = composerLockErrorFromResponse(409);
    expect(copy422).not.toBeNull();
    expect(copy409).not.toBeNull();

    const html422 = renderToStaticMarkup(createElement(PlanComposerErrorNotice, { message: copy422 as string }));
    expect(html422).toContain('role="alert"');
    expect(html422).toContain("planComposer__error");
    expect(html422).toMatch(/refresh|regenerate/i);

    const html409 = renderToStaticMarkup(createElement(PlanComposerErrorNotice, { message: copy409 as string }));
    expect(html409).toContain('role="alert"');
    expect(html409).toMatch(/already locked/i);
  });
});
