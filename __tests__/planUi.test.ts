import { describe, expect, it } from "vitest";

import { planViewModel, shareCopyForPlan, stopsFromAnswerCards, stopsFromConcierge } from "@/components/plan/planPresentation";
import { routeHasChanged } from "@/components/plan/PlanSummary";
import type { PlanState } from "@/lib/plan";

const state: PlanState = {
  plan: {
    id: "6ab5ca40-836b-4970-9477-d1779fdd31ab",
    title: "Thursday, sorted",
    startTime: "2026-07-16T17:30:00.000Z",
    createdAt: "2026-07-11T12:00:00.000Z",
    routeRevision: 1,
  },
  stops: [
    { venueId: "v-second", venueName: "The Swan", position: 2 },
    { venueId: "v-first", venueName: "The George", position: 1 },
  ],
  crew: [],
};

describe("planViewModel", () => {
  it("renders crawl stops in their explicit order", () => {
    expect(planViewModel(state).stops.map((stop) => stop.venueName)).toEqual([
      "The George",
      "The Swan",
    ]);
  });

  it("keeps the invite copy useful before anyone joins", () => {
    expect(shareCopyForPlan(state)).toBe(
      "Thursday, sorted · 2 stops · Starts 18:30 — see the plan and tap I'm in.",
    );
  });
});

describe("routeHasChanged", () => {
  it("requires an actual ordered stop change", () => {
    expect(routeHasChanged([{ venueId: "a" }, { venueId: "b" }, { venueId: "c" }], [{ venueId: "a" }, { venueId: "b" }, { venueId: "c" }])).toBe(false);
    expect(routeHasChanged([{ venueId: "a" }, { venueId: "b" }, { venueId: "c" }], [{ venueId: "a" }, { venueId: "x" }, { venueId: "c" }])).toBe(true);
  });
});

describe("stopsFromConcierge", () => {
  it("threads grounded concierge ids and names into the Plan composer", () => {
    expect(stopsFromConcierge([
      { id: " venue-1 ", name: " The George " },
      { id: "", name: "Invented Arms" },
    ])).toEqual([{ venueId: "venue-1", venueName: "The George" }]);
  });
});

describe("stopsFromAnswerCards", () => {
  it("threads answerFromBody cards (venue-ranking shape) into plan stops", () => {
    expect(stopsFromAnswerCards([
      { venueId: "venue-1", title: "The George" },
      { venueId: "venue-2", title: "The Swan" },
    ])).toEqual([
      { venueId: "venue-1", venueName: "The George" },
      { venueId: "venue-2", venueName: "The Swan" },
    ]);
  });

  it("threads answerFromBody cards (What's-On listings shape) into plan stops", () => {
    // An occasion template whose text names a kind ("pub quiz tonight near
    // me") answers from grounded What's-On listings, not ranked venues —
    // answerFromBody normalises both into the same {venueId, title} card
    // shape, so the same stop-mapping applies here honestly.
    expect(stopsFromAnswerCards([
      { venueId: "venue-quiz", title: "Pub quiz — Sundays" },
    ])).toEqual([{ venueId: "venue-quiz", venueName: "Pub quiz — Sundays" }]);
  });

  it("drops a card whose venueId never resolved rather than inventing a stop", () => {
    expect(stopsFromAnswerCards([
      { venueId: "", title: "Some listing with no resolved venue" },
    ])).toEqual([]);
  });
});
