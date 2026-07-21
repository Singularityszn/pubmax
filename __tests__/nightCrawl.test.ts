import { describe, expect, it } from "vitest";

import {
  advanceNightCrawl,
  classifyActionOutcome,
  isFinalStop,
  nightCrawlActionNote,
  nightCrawlActionPayload,
  nightCrawlHero,
  nightCrawlIdempotencyScope,
  nightCrawlStack,
  outcomeKeepsOptimistic,
  stopDisposition,
} from "@/lib/nightCrawl";
import type { PlanActionDTO, PlanStopDTO } from "@/lib/plan";

function stop(position: number, name = `Pub ${position}`): PlanStopDTO {
  return { venueId: `venue-${position}`, venueName: name, position };
}

function action(type: PlanActionDTO["type"], stopPosition: number): PlanActionDTO {
  return { id: `${type}-${stopPosition}`, type, stopPosition, ending: null, createdAt: "2026-07-21T22:00:00.000Z" };
}

const THREE = [stop(0, "The Southampton Arms"), stop(1, "The Bull & Last"), stop(2, "The Pineapple")];

describe("nightCrawlStack", () => {
  it("splits stops into done / current(hero) / upcoming around the cursor", () => {
    const stack = nightCrawlStack(THREE, 1);
    expect(stack.map((v) => v.slot)).toEqual(["done", "current", "upcoming"]);
    expect(stack[1]?.stop.venueName).toBe("The Bull & Last");
  });

  it("sorts by stored position, never insertion order", () => {
    const scrambled = [stop(2, "Third"), stop(0, "First"), stop(1, "Second")];
    const stack = nightCrawlStack(scrambled, 0);
    expect(stack.map((v) => v.stop.venueName)).toEqual(["First", "Second", "Third"]);
    expect(stack[0]?.slot).toBe("current");
  });

  it("clamps a cursor past the end to the last stop (never points past the final pub)", () => {
    const stack = nightCrawlStack(THREE, 99);
    expect(stack.map((v) => v.slot)).toEqual(["done", "done", "current"]);
  });

  it("returns an empty stack for a plan with no stops", () => {
    expect(nightCrawlStack([], 0)).toEqual([]);
  });

  it("carries each done stop's recorded disposition, current/upcoming carry none", () => {
    const actions = [action("arrived", 0)];
    const stack = nightCrawlStack(THREE, 1, actions);
    expect(stack[0]?.disposition).toBe("arrived");
    expect(stack[1]?.disposition).toBeNull();
    expect(stack[2]?.disposition).toBeNull();
  });

  it("lets an optimistic disposition win over the server log for instant flip", () => {
    const stack = nightCrawlStack(THREE, 1, [], { 0: "skipped" });
    expect(stack[0]?.disposition).toBe("skipped");
  });
});

describe("nightCrawlHero + advance (hero advances on arrived/skip)", () => {
  it("names the cursor stop as the hero", () => {
    expect(nightCrawlHero(THREE, 0)?.venueName).toBe("The Southampton Arms");
    expect(nightCrawlHero(THREE, 1)?.venueName).toBe("The Bull & Last");
  });

  it("advances the cursor one stop so the next hero takes over", () => {
    const next = advanceNightCrawl(0, THREE.length);
    expect(next).toBe(1);
    expect(nightCrawlHero(THREE, next)?.venueName).toBe("The Bull & Last");
  });

  it("never advances past the last stop", () => {
    expect(advanceNightCrawl(2, THREE.length)).toBe(2);
  });

  it("returns null hero for an empty plan", () => {
    expect(nightCrawlHero([], 0)).toBeNull();
  });
});

describe("isFinalStop", () => {
  it("is true only when the hero is the last pub", () => {
    expect(isFinalStop(THREE, 0)).toBe(false);
    expect(isFinalStop(THREE, 2)).toBe(true);
    expect(isFinalStop(THREE, 99)).toBe(true);
    expect(isFinalStop([], 0)).toBe(false);
  });
});

describe("stopDisposition", () => {
  it("returns the latest arrived/skipped for a position", () => {
    const actions = [action("skipped", 1), action("arrived", 1)];
    expect(stopDisposition(actions, 1)).toBe("arrived");
  });

  it("ignores non-arrival actions and unmatched positions", () => {
    expect(stopDisposition([action("swapped", 0)], 0)).toBeNull();
    expect(stopDisposition([action("arrived", 0)], 1)).toBeNull();
    expect(stopDisposition(undefined, 0)).toBeNull();
  });
});

describe("action payload + idempotency scope", () => {
  it("builds the POST body against the hero stop's position", () => {
    expect(nightCrawlActionPayload("arrived", stop(1))).toEqual({ type: "arrived", stopPosition: 1 });
    expect(nightCrawlActionPayload("skipped", stop(2))).toEqual({ type: "skipped", stopPosition: 2 });
  });

  it("scopes idempotency per plan, action, and position (stable per tap, distinct across taps)", () => {
    const a = nightCrawlIdempotencyScope("plan-1", "arrived", 1);
    expect(a).toBe(nightCrawlIdempotencyScope("plan-1", "arrived", 1));
    expect(a).not.toBe(nightCrawlIdempotencyScope("plan-1", "skipped", 1));
    expect(a).not.toBe(nightCrawlIdempotencyScope("plan-1", "arrived", 2));
    expect(a).not.toBe(nightCrawlIdempotencyScope("plan-2", "arrived", 1));
  });
});

describe("classifyActionOutcome + optimistic reconciliation", () => {
  it("maps 2xx to confirmed", () => {
    expect(classifyActionOutcome(200)).toBe("confirmed");
    expect(classifyActionOutcome(201)).toBe("confirmed");
  });

  it("maps a network drop and 5xx to offline (queued look)", () => {
    expect(classifyActionOutcome("network")).toBe("offline");
    expect(classifyActionOutcome(503)).toBe("offline");
  });

  it("maps 403 to forbidden and other 4xx to rejected", () => {
    expect(classifyActionOutcome(403)).toBe("forbidden");
    expect(classifyActionOutcome(400)).toBe("rejected");
    expect(classifyActionOutcome(409)).toBe("rejected");
    expect(classifyActionOutcome(404)).toBe("rejected");
  });

  it("keeps the optimistic advance only for confirmed and offline", () => {
    expect(outcomeKeepsOptimistic("confirmed")).toBe(true);
    expect(outcomeKeepsOptimistic("offline")).toBe(true);
    expect(outcomeKeepsOptimistic("rejected")).toBe(false);
    expect(outcomeKeepsOptimistic("forbidden")).toBe(false);
  });
});

describe("nightCrawlActionNote (value-first, no apology-first, plain British)", () => {
  const notes = [
    nightCrawlActionNote("arrived", "The Bull & Last", "offline"),
    nightCrawlActionNote("skipped", "The Bull & Last", "rejected"),
    nightCrawlActionNote("arrived", "The Bull & Last", "forbidden"),
  ];

  it("never opens with an apology and carries no em dash", () => {
    for (const text of notes) {
      expect(text.toLowerCase().startsWith("sorry")).toBe(false);
      expect(text).not.toContain("—");
      expect(text.length).toBeGreaterThan(0);
    }
  });

  it("offline copy promises a sync, rejected copy invites another tap", () => {
    expect(nightCrawlActionNote("arrived", "X", "offline")).toMatch(/sync/i);
    expect(nightCrawlActionNote("skipped", "X", "rejected")).toMatch(/another tap/i);
    expect(nightCrawlActionNote("arrived", "X", "forbidden")).toMatch(/crew/i);
  });

  it("falls back to a generic name when the venue name is blank", () => {
    expect(nightCrawlActionNote("arrived", "  ", "rejected")).toContain("this stop");
  });
});
