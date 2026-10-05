import { describe, expect, it } from "vitest";

import {
  livePendingRoute,
  orderedRouteStops,
  routeRevisionsMatch,
  routeSaveOutcome,
  seedRouteDraft,
  type EditableStop,
} from "@/lib/planRouteEditor";
import { defined } from "@/__tests__/helpers/defined";

const stored: EditableStop[] = [
  { venueId: "v-beehive", venueName: "Beehive", position: 0 },
  { venueId: "v-bread", venueName: "Bread & Roses", position: 1 },
  { venueId: "v-lotus", venueName: "Lotus Bar", position: 2 },
];

describe("routeRevisionsMatch", () => {
  it("names one stored route across number and string spellings", () => {
    expect(routeRevisionsMatch(2, 2)).toBe(true);
    expect(routeRevisionsMatch(2, "2")).toBe(true);
    expect(routeRevisionsMatch("2", 2)).toBe(true);
  });

  it("never matches an absent revision", () => {
    expect(routeRevisionsMatch(null, 2)).toBe(false);
    expect(routeRevisionsMatch(2, null)).toBe(false);
    expect(routeRevisionsMatch(null, null)).toBe(false);
  });

  it("separates two revisions", () => {
    expect(routeRevisionsMatch(1, 2)).toBe(false);
  });
});

describe("livePendingRoute", () => {
  const draft = { stops: stored, expectedRouteRevision: 2 as string | number | null, groundingProof: null, operationKey: null };

  it("keeps a draft built over the revision the store still holds", () => {
    expect(livePendingRoute(draft, 2)).toBe(draft);
  });

  it("drops a draft older than the stored route (D02: the editor never opens on it)", () => {
    expect(livePendingRoute(draft, 3)).toBeNull();
  });

  it("drops a draft that cannot prove its revision", () => {
    expect(livePendingRoute({ ...draft, expectedRouteRevision: null }, 2)).toBeNull();
    expect(livePendingRoute(draft, null)).toBeNull();
  });

  it("answers null for no draft", () => {
    expect(livePendingRoute(null, 2)).toBeNull();
  });
});

describe("orderedRouteStops", () => {
  it("puts stops in stored order and renumbers positions to match", () => {
    expect(orderedRouteStops([
      { venueId: "c", venueName: "C", position: 5 },
      { venueId: "a", venueName: "A", position: 1 },
      { venueId: "b", venueName: "B", position: 3 },
    ])).toEqual([
      { venueId: "a", venueName: "A", position: 0 },
      { venueId: "b", venueName: "B", position: 1 },
      { venueId: "c", venueName: "C", position: 2 },
    ]);
  });
});

describe("seedRouteDraft", () => {
  // A deterministic generator answers the pre-edit route again, with Cafe Sol
  // where Lotus Bar was saved. The stored route must win, in its stored order.
  const generated = [
    { venueId: "v-beehive", venueName: "Beehive", alternatives: [{ venueId: "v-stonhouse", venueName: "Stonhouse" }] },
    { venueId: "v-bread", venueName: "Bread & Roses", alternatives: [{ venueId: "v-falcon", venueName: "The Falcon" }] },
    { venueId: "v-cafesol", venueName: "Cafe Sol", alternatives: [{ venueId: "v-lotus", venueName: "Lotus Bar" }] },
  ];

  it("opens on the STORED stops in stored order, never on the generated route", () => {
    const shuffled = [defined(stored[2]), defined(stored[0]), defined(stored[1])];
    expect(seedRouteDraft(shuffled, generated).map((stop) => stop.venueName)).toEqual([
      "Beehive",
      "Bread & Roses",
      "Lotus Bar",
    ]);
  });

  it("offers the generated candidates as backups, its own position first, without any stop already in the route", () => {
    const draft = seedRouteDraft(stored, generated);
    expect(defined(draft[2]).alternatives).toEqual([
      { venueId: "v-cafesol", venueName: "Cafe Sol" },
      { venueId: "v-stonhouse", venueName: "Stonhouse" },
      { venueId: "v-falcon", venueName: "The Falcon" },
    ]);
    expect(defined(draft[0]).alternatives?.map((alternative) => alternative.venueId)).toEqual([
      "v-stonhouse",
      "v-falcon",
      "v-cafesol",
    ]);
    for (const stop of draft) {
      const ids = (stop.alternatives ?? []).map((alternative) => alternative.venueId);
      expect(ids).not.toContain("v-beehive");
      expect(ids).not.toContain("v-bread");
      expect(ids).not.toContain("v-lotus");
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("leaves a stop with no backups when the generator offered nothing new", () => {
    const draft = seedRouteDraft(stored, [
      { venueId: "v-beehive", venueName: "Beehive" },
      { venueId: "v-bread", venueName: "Bread & Roses" },
      { venueId: "v-lotus", venueName: "Lotus Bar" },
    ]);
    expect(draft.every((stop) => stop.alternatives?.length === 0)).toBe(true);
  });

  it("keeps a generated price with its own backup venue", () => {
    const cocktail = {
      category: "cocktail" as const, pence: 850, serving: null, source: "community" as const,
      reportedAt: "2026-09-26T12:00:00.000Z",
    };
    const draft = seedRouteDraft(stored, [
      { venueId: "v-beehive", venueName: "Beehive" },
      { venueId: "v-bread", venueName: "Bread & Roses" },
      { venueId: "v-cafesol", venueName: "Cafe Sol", selectedDrinkPriceEvidence: cocktail },
    ]);

    expect(defined(draft[2]).alternatives?.[0]).toEqual({
      venueId: "v-cafesol", venueName: "Cafe Sol", selectedDrinkPriceEvidence: cocktail,
    });
    expect(defined(draft[2]).selectedDrinkPriceEvidence).toBeUndefined();
  });

  it("does not mutate the stored stops", () => {
    const before = JSON.stringify(stored);
    seedRouteDraft(stored, generated);
    expect(JSON.stringify(stored)).toBe(before);
  });
});

describe("routeSaveOutcome", () => {
  it("reads a landed write, a stale revision and a refusal apart", () => {
    expect(routeSaveOutcome(200, true)).toBe("saved");
    expect(routeSaveOutcome(409, false)).toBe("conflict");
    expect(routeSaveOutcome(412, false)).toBe("conflict");
    expect(routeSaveOutcome(400, false)).toBe("refused");
    expect(routeSaveOutcome(503, false)).toBe("refused");
  });
});
