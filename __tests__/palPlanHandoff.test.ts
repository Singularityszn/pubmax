import { describe, expect, it } from "vitest";

import {
  palDraftAnswers,
  palDraftAttemptKept,
  palDraftAttempts,
  palDraftAttemptsStopAt,
  palDraftCheckingLine,
  palDraftOutcomeLine,
  palDraftRouteLines,
  palPlanDraftFor,
  type PalPlanDraft,
} from "@/lib/palPlanHandoff";
import { buildPlanGenerationIntakeBody, createPlanIntakeDraft, type PlanGenerationAnchorInput } from "@/lib/planIntake";

const ASK = "Plan a crawl in Clapham for 4, not pricey";
const DRAFT = {
  query: ASK,
  stopIds: ["venue-1fz0jhj", "venue-1ros0mx", "venue-a"],
  stopNames: ["The London and South Western", "Junction (Clapham)", "The A"],
  createdAt: "2026-11-03T12:00:00.000Z",
  origin: "pal",
};
const raw = (patch: Record<string, unknown> = {}) => JSON.stringify({ ...DRAFT, ...patch });

describe("palPlanDraftFor: the drafted crawl rides only with its own ask", () => {
  it("reads a well-formed draft for the same ask", () => {
    expect(palPlanDraftFor(raw(), ASK)).toEqual({
      query: ASK,
      stopIds: DRAFT.stopIds,
      stopNames: DRAFT.stopNames,
      origin: "pal",
    });
    // Spacing and case are not an edit.
    expect(palPlanDraftFor(raw(), `  ${ASK.toUpperCase()} `)).not.toBeNull();
  });

  it("is no draft for an edited ask, a missing ask or a missing draft", () => {
    expect(palPlanDraftFor(raw(), "Plan a crawl in Soho")).toBeNull();
    expect(palPlanDraftFor(raw(), null)).toBeNull();
    expect(palPlanDraftFor(raw(), "  ")).toBeNull();
    expect(palPlanDraftFor(null, ASK)).toBeNull();
    expect(palPlanDraftFor("{not json", ASK)).toBeNull();
  });

  it("refuses a draft the anchored generator would refuse", () => {
    expect(palPlanDraftFor(raw({ stopIds: ["a", "b"], stopNames: ["A", "B"] }), ASK)).toBeNull();
    expect(palPlanDraftFor(raw({ stopIds: ["a", "a", "b"] }), ASK)).toBeNull();
    expect(palPlanDraftFor(raw({ stopIds: ["a", "b", "c d"] }), ASK)).toBeNull();
    expect(palPlanDraftFor(raw({ stopNames: ["A", "B"] }), ASK)).toBeNull();
    expect(palPlanDraftFor(raw({ stopNames: ["A", "B", " "] }), ASK)).toBeNull();
    const seven = ["a", "b", "c", "d", "e", "f", "g"];
    expect(palPlanDraftFor(raw({ stopIds: seven, stopNames: seven }), ASK)).toBeNull();
  });

  it("names Ask the map as the origin only when it says so", () => {
    expect(palPlanDraftFor(raw({ origin: "map" }), ASK)?.origin).toBe("map");
    expect(palPlanDraftFor(raw({ origin: undefined }), ASK)?.origin).toBe("pal");
    expect(palDraftAnswers(palPlanDraftFor(raw(), ASK)!, ASK)).toBe(true);
    expect(palDraftAnswers(palPlanDraftFor(raw(), ASK)!, "Somewhere else")).toBe(false);
  });
});

describe("palDraftAttempts: keep all, then keep the first, then plan from the ask", () => {
  const draft = palPlanDraftFor(raw(), ASK)!;
  const held = { venueId: "venue-held", source: "map-search" as const, acceptedArea: null, startsAt: null };

  it("is the one plain attempt without a draft", () => {
    expect(palDraftAttempts(null, held)).toEqual([{ keeps: "none", anchor: held, context: {} }]);
    expect(palDraftAttempts(null, null)).toEqual([{ keeps: "none", anchor: null, context: {} }]);
  });

  it("keeps the accepted first pub when a new draft starts somewhere else", () => {
    const attempts = palDraftAttempts(draft, held);
    const bodies = attempts.map((attempt) => buildPlanGenerationIntakeBody(
      createPlanIntakeDraft(), ASK, null, attempt.context, attempt.anchor,
    ));
    expect(bodies.map((body) => body.anchor?.venueId)).toEqual(["venue-held"]);
    expect(bodies[0]?.anchor).toEqual(held);
    expect(palDraftOutcomeLine(draft, attempts[0]!.keeps, ["The Held Pub", "The Other Pub"]))
      .toBe("Your chosen first pub stays first. The draft does not replace your choice.");
  });

  it("retains accepted area and time when the draft starts at the held pub", () => {
    const accepted: PlanGenerationAnchorInput = {
      ...held,
      venueId: DRAFT.stopIds[0]!,
      acceptedArea: { kind: "night-patch", id: "clapham" },
      startsAt: "2026-11-04T19:00:00.000Z",
    };
    const [all, first] = palDraftAttempts(draft, accepted);
    expect(all?.anchor).toEqual({ ...accepted, venueIds: DRAFT.stopIds });
    expect(first?.anchor).toEqual(accepted);
  });

  it.each([
    { origin: "pal", stopCount: null, keepingCount: 2 },
    { origin: "pal", stopCount: 3, keepingCount: 2 },
    { origin: "pal", stopCount: 5, keepingCount: 1 },
    { origin: "map", stopCount: null, keepingCount: 2 },
    { origin: "map", stopCount: 3, keepingCount: 2 },
    { origin: "map", stopCount: 5, keepingCount: 1 },
  ])("preserves the accepted pub and scarcity after $origin attempts fail at count $stopCount", ({ origin, stopCount, keepingCount }) => {
    const matchingDraft = palPlanDraftFor(raw({ origin }), ASK)!;
    const accepted: PlanGenerationAnchorInput = { ...held, venueId: DRAFT.stopIds[0]! };
    const scarcity = "We kept The London and South Western. We could not build the route you asked for. Change the details or add pubs.";
    const answer = { outcome: "anchor-only", stops: [{ venueId: accepted.venueId }] };
    const attempts = palDraftAttempts(matchingDraft, accepted, stopCount);
    expect(attempts).toHaveLength(keepingCount + 1);
    for (const attempt of attempts.slice(0, -1)) {
      expect(palDraftAttemptKept(attempt, matchingDraft, true, answer)).toBe(false);
    }
    const fallback = attempts.at(-1)!;
    expect(palDraftAttemptKept(fallback, matchingDraft, true, answer)).toBe(true);
    expect(fallback.keeps).toBe("held");
    const body = buildPlanGenerationIntakeBody(createPlanIntakeDraft(), ASK, null, fallback.context, fallback.anchor);
    expect(body.anchor).toEqual(accepted);
    const shown = palDraftRouteLines(matchingDraft, fallback.keeps, [DRAFT.stopNames[0]!], {
      conciergeNote: scarcity,
      routeStatus: scarcity,
    });
    for (const line of [shown.conciergeNote, shown.routeStatus]) {
      expect(line).toContain(scarcity);
      expect(line).not.toContain("Plan built one from your ask");
    }
  });

  it("asks the anchored generator for the whole drafted route first", () => {
    const [all, first, plain] = palDraftAttempts(draft, null);
    expect(all).toEqual({
      keeps: "all",
      anchor: { venueId: "venue-1fz0jhj", source: "pal", acceptedArea: null, startsAt: null, venueIds: DRAFT.stopIds },
      context: { stopCount: 3 },
    });
    expect(first).toEqual({
      keeps: "first",
      anchor: { venueId: "venue-1fz0jhj", source: "pal", acceptedArea: null, startsAt: null },
      context: {},
    });
    expect(plain).toEqual({ keeps: "none", anchor: null, context: {} });
    expect(palDraftAttempts(palPlanDraftFor(raw({ origin: "map" }), ASK), null)[0]?.anchor?.source).toBe("map-search");
  });

  it("sends the drafted pubs on the wire", () => {
    const [all] = palDraftAttempts(draft, null);
    const body = buildPlanGenerationIntakeBody(createPlanIntakeDraft(), ASK, null, all!.context, all!.anchor);
    expect(body.anchor).toEqual({
      venueId: "venue-1fz0jhj",
      source: "pal",
      acceptedArea: null,
      startsAt: null,
      venueIds: DRAFT.stopIds,
    });
    expect(body.context?.stopCount).toBe(3);
  });
});

describe("palDraftAttempts with a requested stop count", () => {
  const draft = palPlanDraftFor(raw(), ASK)!;

  // The Pal drafts three pubs. A request for five would send three pubs with a
  // count of five, which the anchored generator always refuses.
  it("skips keeping every pub when the request asks for another number of stops", () => {
    expect(palDraftAttempts(draft, null, 5).map((attempt) => attempt.keeps)).toEqual(["first", "none"]);
  });

  it("keeps every pub when the requested count matches the draft", () => {
    expect(palDraftAttempts(draft, null, 3).map((attempt) => attempt.keeps)).toEqual(["all", "first", "none"]);
    expect(palDraftAttempts(draft, null, null).map((attempt) => attempt.keeps)).toEqual(["all", "first", "none"]);
  });
});

describe("palDraftAttemptsStopAt: only a refusal hands over to the next attempt", () => {
  it("moves on after an answer or a refused request", () => {
    for (const status of [200, 400, 404, 409, 422]) expect(palDraftAttemptsStopAt(status)).toBe(false);
  });

  // A rate limit or a server fault says nothing about the drafted pubs. It is
  // shown as the error it is, and it does not spend two more requests.
  it("stops on a timeout, a rate limit or a server fault", () => {
    for (const status of [408, 429, 500, 502, 503, 504]) expect(palDraftAttemptsStopAt(status)).toBe(true);
  });
});

describe("palDraftAttemptKept: a keeping attempt counts only when it kept its promise", () => {
  const draft = palPlanDraftFor(raw(), ASK)!;
  const [all, first, plain] = palDraftAttempts(draft, null) as [never, never, never];
  const route = (ids: string[], outcome = "route") => ({ outcome, stops: ids.map((venueId) => ({ venueId })) });

  it("takes the plain attempt's answer, success or error, as it always did", () => {
    expect(palDraftAttemptKept(plain, draft, false, null)).toBe(true);
    expect(palDraftAttemptKept(plain, null, true, route(["x"]))).toBe(true);
  });

  it("keeps all only when every drafted pub is in the route and nothing else", () => {
    expect(palDraftAttemptKept(all, draft, true, route(["venue-1fz0jhj", "venue-a", "venue-1ros0mx"]))).toBe(true);
    expect(palDraftAttemptKept(all, draft, true, route(["venue-1fz0jhj", "venue-a", "other"]))).toBe(false);
    expect(palDraftAttemptKept(all, draft, true, route(["venue-1fz0jhj"], "anchor-only"))).toBe(false);
    expect(palDraftAttemptKept(all, draft, true, { outcome: "anchor-conflict", stops: [] })).toBe(false);
    expect(palDraftAttemptKept(all, draft, false, null)).toBe(false);
  });

  it("keeps the first only as Stop 1 of a full route", () => {
    expect(palDraftAttemptKept(first, draft, true, route(["venue-1fz0jhj", "b", "c"]))).toBe(true);
    expect(palDraftAttemptKept(first, draft, true, route(["b", "venue-1fz0jhj", "c"]))).toBe(false);
    expect(palDraftAttemptKept(first, draft, true, route(["venue-1fz0jhj"], "anchor-only"))).toBe(false);
  });

  it.each([1, 2] as const)("accepts a requested %i-stop route that keeps the first pub", (stopCount) => {
    const intake = createPlanIntakeDraft();
    intake.answers.stopCount = stopCount;
    const attempt = palDraftAttempts(draft, null)[1]!;
    const body = buildPlanGenerationIntakeBody(intake, ASK, null, { stopCount }, attempt.anchor);
    expect(body.intake?.stopCount).toBe(stopCount);
    expect(palDraftAttemptKept(attempt, draft, true, route(
      ["venue-1fz0jhj", "venue-new"].slice(0, stopCount),
    ))).toBe(true);
  });
});

describe("palDraftOutcomeLine: says which of the three happened", () => {
  const pal = palPlanDraftFor(raw(), ASK) as PalPlanDraft;
  const map = palPlanDraftFor(raw({ origin: "map" }), ASK) as PalPlanDraft;
  const names = ["The London and South Western", "Junction (Clapham)", "The A"];

  it("names every kept pub", () => {
    expect(palDraftOutcomeLine(pal, "all", names))
      .toBe("Kept your Pub Pal's pubs: The London and South Western, Junction (Clapham) and The A.");
    expect(palDraftOutcomeLine(map, "all", names))
      .toBe("Kept the drafted pubs: The London and South Western, Junction (Clapham) and The A.");
  });

  it("never hides a refusal", () => {
    expect(palDraftOutcomeLine(pal, "first", names)).toBe(
      "Your Pub Pal's pubs could not all make one route Plan can vouch for, so Plan kept The London and South Western and chose the rest.",
    );
    expect(palDraftOutcomeLine(pal, "none", names)).toBe(
      "Your Pub Pal's pubs could not make a route Plan can vouch for tonight, so Plan built one from your ask.",
    );
  });

  it("follows the house voice: no em dash, no exclamation mark", () => {
    for (const keep of ["all", "first", "held", "none"] as const) {
      for (const draft of [pal, map]) {
        const line = palDraftOutcomeLine(draft, keep, names);
        expect(line).not.toMatch(/[—!]/);
      }
    }
  });
});

describe("palDraftRouteLines and palDraftCheckingLine: the generator's lines without a draft", () => {
  const draft = palPlanDraftFor(raw(), ASK)!;
  const lines = { conciergeNote: "3 stops we can stand behind.", routeStatus: "Route refreshed." };

  it("leaves the generator's own lines alone when nothing was drafted", () => {
    expect(palDraftRouteLines(null, "none", [], lines)).toBe(lines);
    expect(palDraftCheckingLine(null, "Refreshing.")).toBe("Refreshing.");
  });

  it("says what happened to the draft first", () => {
    expect(palDraftRouteLines(draft, "all", ["A", "B", "C"], lines)).toEqual({
      conciergeNote: "Kept your Pub Pal's pubs: A, B and C.",
      routeStatus: "Kept your Pub Pal's pubs: A, B and C. Route refreshed.",
    });
    expect(palDraftCheckingLine(draft, "Refreshing.")).toBe("Checking your Pub Pal's draft for your night.");
    expect(palDraftCheckingLine(palPlanDraftFor(raw({ origin: "map" }), ASK), "x")).toBe("Checking the draft for your night.");
  });

  it("keeps the scarcity explanation when only the held pub survives", () => {
    const scarcity = "We kept The Held Pub. We could not build the 3-stop route you asked for. Change the details or add pubs.";
    const shown = palDraftRouteLines(draft, "held", ["The Held Pub"], {
      conciergeNote: scarcity,
      routeStatus: scarcity,
    });
    expect(shown.conciergeNote).toContain(scarcity);
    expect(shown.routeStatus).toContain(scarcity);
    expect(shown.conciergeNote).not.toContain("Plan built the route");
    expect(shown.routeStatus).not.toContain("Plan built the route");
  });
});
