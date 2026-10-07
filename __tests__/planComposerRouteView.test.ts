import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  composerRouteMutation,
  parsePlanRouteDraft,
  pickedPlanStop,
  routeStopsFromGenerated,
  swapDraftStop,
  type DraftStop,
} from "@/components/plan/PlanComposer";

const wire = (venueId: string, walk: number | null, pence: number | null, withSource = true) => ({
  venueId,
  venueName: venueId.toUpperCase(),
  walkingMinutesFromPrevious: walk,
  estimatedPintPricePence: pence,
  priceEvidence: { pence, source: withSource ? { label: "Pub list", url: "https://example.com", observedAt: "2026-10-02" } : null, confidenceState: "fresh" },
});

const stops = (): DraftStop[] => routeStopsFromGenerated([wire("a", null, 560), wire("b", 4, 520), wire("c", 5, 660, false)]);

describe("the generator's timing and price ride on the stop", () => {
  it("keeps the walk, the neighbour it was timed from, and the price with its trust word", () => {
    const [a, b, c] = stops();
    expect(a).not.toHaveProperty("walkingMinutesFromPrevious");
    expect(b).toMatchObject({ walkingMinutesFromPrevious: 4, walkFromVenueId: "a", estimatedPintPricePence: 520, priceKind: "listed" });
    expect(c).toMatchObject({ walkingMinutesFromPrevious: 5, walkFromVenueId: "b", estimatedPintPricePence: 660, priceKind: "estimated" });
  });

  it("reads a stored draft with its own neighbour, so a reorder survives a reload", () => {
    const [a, b, c] = stops() as [DraftStop, DraftStop, DraftStop];
    const reordered = [c, a, b];
    const draft = parsePlanRouteDraft(JSON.stringify({ stops: reordered, nightContext: null, routeRevision: null, routeStale: false }));
    expect(draft?.stops.map((stop) => stop.venueId)).toEqual(["c", "a", "b"]);
    // C still remembers it was timed from B, so it will not print a walk after nothing.
    expect(draft?.stops[0]).not.toHaveProperty("walkingMinutesFromPrevious");
    expect(draft?.stops[2]).toMatchObject({ walkFromVenueId: "a", walkingMinutesFromPrevious: 4 });
  });

  it("refuses a walk or a price that is not a real number", () => {
    const [stop] = routeStopsFromGenerated([{ ...wire("a", -3, 0), walkingMinutesFromPrevious: -3, estimatedPintPricePence: 0 }]);
    expect(stop).not.toHaveProperty("estimatedPintPricePence");
    const [, second] = routeStopsFromGenerated([wire("a", null, 500), { ...wire("b", 4, 500), walkingMinutesFromPrevious: "soon" }]);
    expect(second).not.toHaveProperty("walkingMinutesFromPrevious");
  });

  it("clears the old pub's walk and price when a stop is swapped or chosen again", () => {
    const [, b] = routeStopsFromGenerated([wire("a", null, 560), { ...wire("b", 4, 520), alternatives: [{ venueId: "z", venueName: "Z" }] }]) as [DraftStop, DraftStop];
    const swapped = swapDraftStop(b);
    expect(swapped.venueId).toBe("z");
    expect(swapped.estimatedPintPricePence).toBeUndefined();
    expect(swapped.walkingMinutesFromPrevious).toBeUndefined();
    const picked = pickedPlanStop(b, { id: "q", name: "Q" });
    expect(picked).toEqual({ key: b.key, venueId: "q", venueName: "Q", alternatives: [] });
  });
});

describe("a reorder", () => {
  const base = (planAnchor: Parameters<typeof composerRouteMutation>[0]["planAnchor"]) => {
    const current = stops();
    return composerRouteMutation({
      currentStops: current,
      nextStops: [current[1]!, current[0]!, current[2]!],
      groundingProof: "proof",
      createOperationKey: "key",
      planAnchor,
      routeStale: false,
      reorder: true,
    });
  };

  it("keeps a legacy proof, because that proof covers the SET of pubs and not their order", () => {
    const result = base(null);
    expect(result).toMatchObject({ accepted: true, groundingProof: "proof", createOperationKey: "key", routeStale: false });
    expect(result.stops.map((stop) => stop.venueId)).toEqual(["b", "a", "c"]);
  });

  it("is an ordinary change for an anchored route, whose proof binds the exact order", () => {
    const result = base({ venueId: "a", source: "near", outcome: "route" });
    expect(result).toMatchObject({ accepted: true, groundingProof: null, createOperationKey: null, routeStale: true });
  });

  it("is still refused when it would move a held pub off Stop 1", () => {
    const current = stops();
    const result = composerRouteMutation({
      currentStops: current,
      nextStops: [current[1]!, current[0]!, current[2]!],
      heldVenueId: "a",
      groundingProof: "proof",
      createOperationKey: "key",
      planAnchor: null,
      routeStale: false,
      reorder: true,
    });
    expect(result.accepted).toBe(false);
  });

  it("with a stop added or removed is never a pure reorder", () => {
    const current = stops();
    const result = composerRouteMutation({
      currentStops: current,
      nextStops: [current[1]!, current[0]!],
      groundingProof: "proof",
      createOperationKey: "key",
      planAnchor: null,
      routeStale: false,
      reorder: true,
    });
    expect(result).toMatchObject({ groundingProof: null, routeStale: true });
  });
});
