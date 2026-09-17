// F-13: widening a Plan to one or two stops (#1512) left the grounding proof's
// own floor at a literal 3.
//
// Before `cc934ad80` that floor was unreachable, because the optimizer refused
// any pool smaller than the target and the minimum target was 3. With a
// `stopCount` of 1 or 2 a constrained area - a budget ceiling, an accessibility
// need, a route window - produces a candidate set of 1 or 2 ids, and
// `mintPlanGroundingProof` threw a plain Error over it.
// `planSigningUnavailableResponse` matches the signing-key error alone, so the
// generate route's `throw error` escaped as a 500 on exactly the inputs the PR
// opened up, and a 500 is the one answer a planner surface cannot word.
//
// TWO RULES. The floor is the table's own, so a one-pub meetup mints and
// verifies like any other plan. And a mint that still cannot commit throws a
// TYPED refusal the route maps to its existing scarcity 422.

import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { mintMock } = vi.hoisted(() => ({ mintMock: vi.fn() }));

vi.mock("@/lib/serverEnv", () => ({ assertServerEnv: () => {} }));
vi.mock("@/public/data/weather/latest.json", () => ({
  default: { version: 1, generatedAt: "2026-01-01T00:00:00.000Z", observations: [] },
}));
vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: vi.fn(async () => false) };
});
vi.mock("@/lib/walkRouteProvider", () => ({
  fetchWalkLegRoute: vi.fn(async () => null),
  orsApiKey: () => null,
}));
vi.mock("@/lib/walkRouteStore", () => ({
  walkRouteStore: () => ({ getLeg: async () => null, putLeg: async () => undefined }),
}));
vi.mock("@/lib/planGrounding.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/planGrounding.server")>();
  mintMock.mockImplementation(actual.mintPlanGroundingProof);
  return { ...actual, mintPlanGroundingProof: mintMock };
});

import { POST } from "@/app/api/plans/generate/route";
import {
  isPlanGroundingProofUnmintableError,
  mintPlanGroundingProof,
  PlanGroundingProofUnmintableError,
  verifyPlanGroundingProof,
} from "@/lib/planGrounding.server";
import { planGroundingUnmintableResponse, planSigningUnavailableResponse } from "@/lib/planSigningHttp.server";
import { MIN_PLAN_STOP_COUNT, PLAN_STOP_COUNTS } from "@/lib/planStopCount";

const ISSUED_AT = Date.parse("2026-07-20T12:00:00.000Z");
const OPERATION = "create-operation-a";

describe("the grounding proof's floor is the stop-count table's", () => {
  it.each([1, 2])("mints and verifies a candidate set of %i ids", (count) => {
    const candidates = Array.from({ length: count }, (_, index) => `venue-${index}`);

    const proof = mintPlanGroundingProof(candidates, OPERATION, ISSUED_AT);

    expect(verifyPlanGroundingProof(proof, candidates, OPERATION, ISSUED_AT)).toBe(true);
  });

  it("takes its floor from the table rather than a literal", () => {
    expect(MIN_PLAN_STOP_COUNT).toBe(PLAN_STOP_COUNTS[0]);
    expect(() => mintPlanGroundingProof([], OPERATION, ISSUED_AT))
      .toThrow(PlanGroundingProofUnmintableError);
  });

  it("refuses a set it cannot commit to with a TYPED error, never a plain one", () => {
    const overflow = Array.from({ length: 101 }, (_, index) => `venue-${index}`);

    for (const bad of [[], overflow, ["   "]]) {
      let caught: unknown;
      try {
        mintPlanGroundingProof(bad, OPERATION, ISSUED_AT);
      } catch (error) {
        caught = error;
      }
      expect(isPlanGroundingProofUnmintableError(caught)).toBe(true);
    }
  });
});

describe("a proof the server cannot mint", () => {
  it("answers the scarcity 422 rather than escaping as a 500", async () => {
    const details = { nightArea: "clapham", availableVenueCount: 1, requestedStopCount: 1 };
    const response = planGroundingUnmintableResponse(
      new PlanGroundingProofUnmintableError("A grounding proof needs canonical venues and one create operation."),
      details,
    );

    expect(response?.status).toBe(422);
    const body = await response?.json();
    expect(body.code).toBe("GROUNDED_VENUES_INSUFFICIENT");
    expect(body.details).toEqual(details);
  });

  it("is a different lane from a signing key we do not hold", () => {
    const unmintable = new PlanGroundingProofUnmintableError("no set");
    expect(planSigningUnavailableResponse(unmintable)).toBeNull();
    expect(planGroundingUnmintableResponse(new Error("something else"), {})).toBeNull();
  });
});

describe("the generate route over a set it cannot prove", () => {
  it("answers 422 rather than letting the refusal escape as a 500", async () => {
    mintMock.mockImplementationOnce(() => {
      throw new PlanGroundingProofUnmintableError(
        "A grounding proof needs canonical venues and one create operation.",
      );
    });

    const response = await POST(new Request("http://localhost/api/plans/generate", {
      method: "POST",
      body: JSON.stringify({ query: "a 1 pub crawl in Clapham" }),
    }));
    const body = await response.json();

    expect(response.status).toBe(422);
    expect(body.code).toBe("GROUNDED_VENUES_INSUFFICIENT");
    expect(body.details).toMatchObject({ nightArea: "clapham", requestedStopCount: 1 });
  });
});
