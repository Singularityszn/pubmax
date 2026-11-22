// The priced starter /plan is prerendered with (lib/planStarter.ts): what a
// generation must carry before the page prints it, and that nothing but
// display fields leaves the server.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { generate } = vi.hoisted(() => ({ generate: vi.fn<(request: Request) => Promise<Response>>() }));
vi.mock("@/app/api/plans/generate/route", () => ({ POST: generate }));

import { prerenderedPlanStarter } from "@/app/plan/planStarter.server";
import { DESCRIBE_FIRST_CHIPS } from "@/lib/describeFirstChips";
import { PLAN_STARTER_ASK, planStarterRequestBody, planStarterView } from "@/lib/planStarter";

const NOW = Date.parse("2026-11-22T12:00:00.000Z");
const SOURCE = { label: "Pint Prices", url: "https://example.com/prices", observedAt: "2026-11-09" };

function stop(venueId: string, pence: number | null, extra: Record<string, unknown> = {}) {
  return {
    venueId,
    venueName: `Pub ${venueId}`,
    alternatives: [{ venueId: "venue-z", venueName: "Pub z" }],
    ...(pence === null ? {} : {
      estimatedPintPricePence: pence,
      priceKind: "listed",
      priceServing: "pint",
      priceEvidence: { pence, confidenceState: "fresh", source: SOURCE },
    }),
    ...extra,
  };
}

function generation(stops: unknown[] = [stop("a", 249), stop("b", 620), stop("c", 350)]) {
  return {
    grounded: true,
    groundingProof: "proof.bound-to-one-request",
    operationKey: "create-one-request",
    inferredContext: { nightArea: "shoreditch", daypart: "evening" },
    stops,
  };
}

describe("the words the starter asks for", () => {
  it("are a shipped describe chip, sent the way the entry form sends them", () => {
    expect(DESCRIBE_FIRST_CHIPS).toContain(PLAN_STARTER_ASK);
    const body = planStarterRequestBody(PLAN_STARTER_ASK);
    expect(body.query).toBe(PLAN_STARTER_ASK);
    expect(body.context?.nightArea).toBe("shoreditch");
    expect(body.intake.area).toEqual({ kind: "night-patch", id: "shoreditch" });
    expect(body.intake.skipped).toEqual(["time-window", "group-size", "budget", "accessibility"]);
  });
});

describe("what the page prints from a generation", () => {
  it("names the area, sums the listed pints and keeps each price's serving, publisher and day", () => {
    const view = planStarterView(PLAN_STARTER_ASK, generation(), NOW)!;
    expect(view.heading).toBe("Cheap pints in Shoreditch");
    expect(view.summary).toBe("3 stops · £12.19 each for pints");
    expect(view.stops.map((route) => route.pintPriceEvidence)).toEqual([249, 620, 350].map((pence, index) => ({
      venueId: "abc"[index],
      pence,
      serving: "pint",
      source: SOURCE,
    })));
  });

  it("carries display fields only: no proof, key or swap list bound to one request", () => {
    const text = JSON.stringify(planStarterView(PLAN_STARTER_ASK, generation(), NOW));
    expect(text).not.toMatch(/proof|operationKey|create-one-request|alternatives|venue-z/);
  });

  it.each([
    ["a stop with no price", generation([stop("a", 249), stop("b", null), stop("c", 350)])],
    ["an estimated price", generation([stop("a", 249, { priceKind: "estimated" })])],
    ["a listed price with no record", generation([stop("a", 249, { priceEvidence: undefined })])],
    ["a drink-specific price", generation([stop("a", 249, { selectedDrinkPriceEvidence: { pence: 500 } })])],
    ["an ungrounded route", { ...generation(), grounded: false }],
    ["an unknown area", { ...generation(), inferredContext: { nightArea: "atlantis" } }],
    ["no stops", generation([])],
  ])("prints nothing for %s", (_, body) => {
    expect(planStarterView(PLAN_STARTER_ASK, body, NOW)).toBeNull();
  });
});

describe("the prerendered starter", () => {
  beforeEach(() => generate.mockReset());

  it("is the generate route's answer to the starter's own request", async () => {
    generate.mockResolvedValue(Response.json(generation()));
    const view = await prerenderedPlanStarter();

    expect(view?.ask).toBe(PLAN_STARTER_ASK);
    expect(view?.stops).toHaveLength(3);
    expect(await generate.mock.calls[0]![0].json()).toEqual(
      JSON.parse(JSON.stringify(planStarterRequestBody(PLAN_STARTER_ASK))),
    );
  });

  it("answers no starter for a refusal, a missing signing key or a fault", async () => {
    generate.mockResolvedValueOnce(Response.json({ error: "No route." }, { status: 422 }));
    expect(await prerenderedPlanStarter()).toBeNull();
    generate.mockResolvedValueOnce(Response.json({ error: "Unavailable." }, { status: 503 }));
    expect(await prerenderedPlanStarter()).toBeNull();
    generate.mockRejectedValueOnce(new Error("store unreachable"));
    expect(await prerenderedPlanStarter()).toBeNull();
  });
});
