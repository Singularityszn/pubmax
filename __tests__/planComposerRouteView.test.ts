import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  composerRouteMutation,
  parsePlanRouteDraft,
  pickedPlanStop,
  routeStopsFromGenerated,
  type DraftStop,
} from "@/components/plan/PlanComposer";
import { heldSwapLine, isPriceLedAsk, swapDraftStop, swapPriceNote } from "@/lib/planStopSwap";
import { inferNightContext } from "@/lib/nightPlanning";

const wire = (venueId: string, walk: number | null, pence: number | null, withSource = true, routed = true) => ({
  venueId,
  venueName: venueId.toUpperCase(),
  walkingMinutesFromPrevious: walk,
  estimatedPintPricePence: pence,
  priceEvidence: { pence, source: withSource ? { label: "Pub list", url: "https://example.com", observedAt: "2026-10-02" } : null, confidenceState: "fresh" },
  operationalEvidence: {
    transportBasis: routed ? "openrouteservice foot-walking route duration" : "direct-distance at 4.8 km/h plus 5 minutes uncertainty per leg",
  },
});

const stops = (): DraftStop[] => routeStopsFromGenerated([wire("a", null, 560), wire("b", 4, 520), wire("c", 5, 660, false)]);

describe("the generator's timing and price ride on the stop", () => {
  it("keeps the walk, the neighbour it was timed from, and the price with its trust word", () => {
    const [a, b, c] = stops();
    expect(a).not.toHaveProperty("walkingMinutesFromPrevious");
    expect(b).toMatchObject({ walkingMinutesFromPrevious: 4, walkFromVenueId: "a", estimatedPintPricePence: 520, priceKind: "listed" });
    expect(c).toMatchObject({ walkingMinutesFromPrevious: 5, walkFromVenueId: "b", estimatedPintPricePence: 660, priceKind: "estimated" });
  });

  it("prints only a walk that was routed on foot, before and after a reorder", () => {
    const keyless = routeStopsFromGenerated([wire("a", null, 560, true, false), wire("b", 4, 520, true, false), wire("c", 5, 660, true, false)]);
    expect(keyless.map((stop) => stop.walkingMinutesFromPrevious)).toEqual([undefined, undefined, undefined]);
    const [a, b, c] = keyless as [DraftStop, DraftStop, DraftStop];
    const draft = parsePlanRouteDraft(JSON.stringify({ stops: [c, a, b], nightContext: null, routeRevision: null, routeStale: false }));
    expect(draft?.stops.map((stop) => stop.walkingMinutesFromPrevious)).toEqual([undefined, undefined, undefined]);
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

  it("restores the exact selected price and its source before swapping to another quote", () => {
    const initial = routeStopsFromGenerated([{
      ...wire("a", null, 289),
      alternatives: [{
        ...wire("b", null, 395),
        priceEvidence: {
          pence: 395,
          source: { label: "Pub menu", url: "https://example.org/menu", observedAt: "2026-09-26T23:30:00.000Z" },
          confidenceState: "fresh",
        },
      }],
    }]);
    const restored = parsePlanRouteDraft(JSON.stringify({ stops: initial }))!.stops[0]!;
    expect(restored.pintPriceEvidence).toEqual({
      venueId: "a", pence: 289, serving: "pint",
      source: { label: "Pub list", url: "https://example.com", observedAt: "2026-10-02" },
    });
    const swapped = swapDraftStop(restored);
    expect(swapped.pintPriceEvidence).toEqual({
      venueId: "b", pence: 395, serving: "pint",
      source: { label: "Pub menu", url: "https://example.org/menu", observedAt: "2026-09-26T23:30:00.000Z" },
    });
    expect(swapDraftStop(swapped).pintPriceEvidence).toEqual(restored.pintPriceEvidence);
  });

  it("does not attach another amount's source or give an estimate listed evidence", () => {
    const [mismatched, estimated] = routeStopsFromGenerated([
      { ...wire("a", null, 289), priceEvidence: wire("b", null, 395).priceEvidence },
      { ...wire("b", null, 395), priceKind: "estimated" },
    ]);
    expect(mismatched).toMatchObject({ estimatedPintPricePence: 289, priceKind: "estimated" });
    expect(estimated).toMatchObject({ estimatedPintPricePence: 395, priceKind: "estimated" });
    expect(mismatched).not.toHaveProperty("pintPriceEvidence");
    expect(estimated).not.toHaveProperty("pintPriceEvidence");
  });

  it("refuses another venue's quote without using the old day as a fallback", () => {
    const quoteFromA = {
      venueId: "a", pence: 289, serving: "pint",
      source: { label: "A pub menu", url: "https://example.com/a", observedAt: "2026-10-02" },
    };
    const draft = parsePlanRouteDraft(JSON.stringify({ stops: [{
      venueId: "b", venueName: "B", estimatedPintPricePence: 289,
      priceKind: "listed", pintPriceEvidence: quoteFromA,
      priceObservedAt: "2026-10-02",
      alternatives: [{
        venueId: "c", venueName: "C", estimatedPintPricePence: 289,
        priceKind: "listed", pintPriceEvidence: quoteFromA,
        priceObservedAt: "2026-10-02",
      }],
    }] }));
    const stop = draft!.stops[0]!;
    expect(stop).toMatchObject({ venueId: "b", estimatedPintPricePence: 289, priceKind: "estimated" });
    expect(stop).not.toHaveProperty("pintPriceEvidence");
    const swapped = swapDraftStop(stop);
    expect(swapped).toMatchObject({ venueId: "c", estimatedPintPricePence: 289, priceKind: "estimated" });
    expect(swapped.pintPriceEvidence).toBeUndefined();
  });

  it.each(["2026-09", "2026-02-30", "2026-09-26T12:00:00"])(
    "keeps the recorded publisher but refuses the invalid source-read day %s",
    (observedAt) => {
      const stop = wire("a", null, 289);
      const [parsed] = routeStopsFromGenerated([{
        ...stop,
        priceObservedAt: "2026-10-02",
        priceEvidence: {
          ...stop.priceEvidence,
          source: { label: "Pub list", url: "javascript:alert(1)", observedAt },
        },
      }]);
      expect(parsed?.pintPriceEvidence).toEqual({
        venueId: "a", pence: 289, serving: null,
        source: { label: "Pub list", url: null, observedAt: null },
      });
    },
  );

  it("keeps the old writer's read day and rejects stored wire evidence and unbound quotes", () => {
    const draft = parsePlanRouteDraft(JSON.stringify({
      stops: [{
        venueId: "a", venueName: "A", estimatedPintPricePence: 289,
        priceKind: "listed", priceObservedAt: "2026-10-02",
      }, {
        ...wire("b", null, 289), priceKind: "listed", priceObservedAt: "2026-10-02",
      }, {
        venueId: "c", venueName: "C", estimatedPintPricePence: 289, priceKind: "listed",
        pintPriceEvidence: { pence: 289, serving: "pint", source: wire("a", null, 289).priceEvidence.source },
      }],
    }));
    expect(draft?.stops[0]).toMatchObject({
      estimatedPintPricePence: 289, priceKind: "listed",
      pintPriceEvidence: { venueId: "a", pence: 289, serving: null, source: { label: null, url: null, observedAt: "2026-10-02" } },
    });
    expect(draft?.stops[1]).toMatchObject({ estimatedPintPricePence: 289, priceKind: "listed" });
    expect(draft?.stops[1]).not.toHaveProperty("pintPriceEvidence");
    expect(draft?.stops[2]).toMatchObject({ estimatedPintPricePence: 289, priceKind: "estimated" });
    expect(draft?.stops[2]).not.toHaveProperty("pintPriceEvidence");
  });

  it("reads the route's night from a draft saved before the route kept its own", () => {
    const nightContext = inferNightContext("Quiet in Clapham for 4").context;
    const legacy = (routeStale: boolean) => parsePlanRouteDraft(JSON.stringify({ stops: stops(), nightContext, routeRevision: null, routeStale }));
    expect(legacy(false)?.routeNight).toEqual({ nightArea: "clapham", daypart: nightContext.daypart });
    expect(legacy(true)?.routeNight).toBeNull();
    const kept = parsePlanRouteDraft(JSON.stringify({ stops: stops(), nightContext, routeNight: { nightArea: "victoria" }, routeRevision: null, routeStale: false }));
    expect(kept?.routeNight).toEqual({ nightArea: "victoria" });
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

describe("a swap on a cheap plan", () => {
  const cheap = { priceLed: true };
  const generated = (stop: ReturnType<typeof wire>, alternatives: ReturnType<typeof wire>[]) => (
    routeStopsFromGenerated([{ ...stop, reason: "Close to the heart of the area.", alternatives }])[0]!
  );
  const queensHead = () => generated(wire("queens", null, 520), [wire("devonshire", null, 690), wire("glasshouse", null, 640)]);

  it("reads a cheap or budgeted ask as price-led, and a quiet one as not", () => {
    expect(isPriceLedAsk(inferNightContext("Cheap pints in Soho for 6").context)).toBe(true);
    expect(isPriceLedAsk(inferNightContext("Pints in Soho for 4 under £20 each").context)).toBe(true);
    expect(isPriceLedAsk(inferNightContext("Quiet pints in Clapham for 4").context)).toBe(false);
    expect(isPriceLedAsk(null)).toBe(false);
  });

  it("takes the cheapest priced pub at or under the stop it replaces", () => {
    const stop = generated(wire("dog", null, 605), [
      wire("crown", null, 675), wire("greyhounds", null, null), wire("glass", null, 600), wire("cheapest", null, 560),
    ]);
    const swapped = swapDraftStop(stop, new Set(), cheap);
    expect(swapped).toMatchObject({ venueId: "cheapest", estimatedPintPricePence: 560 });
    expect(swapPriceNote(stop, swapped)).toBe(", £0.45 less a pint");
    expect(swapDraftStop(stop, new Set(["cheapest"]), cheap).venueId).toBe("glass");
  });

  it("holds a dearer swap until the person confirms it, and says what it costs", () => {
    const stop = queensHead();
    expect(swapDraftStop(stop, new Set(), cheap)).toBe(stop);
    expect(heldSwapLine(stop, new Set(), cheap)).toEqual({
      venueId: "glasshouse",
      line: "No cheaper pub fits nearby. GLASSHOUSE is £6.40, £1.20 more. Swap again to take it.",
    });
    const confirmed = swapDraftStop(stop, new Set(), { ...cheap, confirmedVenueId: "glasshouse" });
    expect(confirmed).toMatchObject({ venueId: "glasshouse", estimatedPintPricePence: 640 });
    expect(swapPriceNote(stop, confirmed)).toBe(", £1.20 more a pint");
    // A confirmation names one pub. It does not let a different, dearer pub through.
    expect(swapDraftStop(stop, new Set(), { ...cheap, confirmedVenueId: "devonshire" })).toBe(stop);
  });

  it("never trades a priced pub for an unpriced one without asking", () => {
    const stop = generated(wire("queens", null, 520), [wire("greyhounds", null, null)]);
    expect(swapDraftStop(stop, new Set(), cheap)).toBe(stop);
    expect(heldSwapLine(stop, new Set(), cheap)?.line)
      .toBe("No cheaper pub fits nearby. GREYHOUNDS has no price yet. Swap again to take it.");
  });

  it("still says a price rise on a plan that is not about price", () => {
    const stop = queensHead();
    const swapped = swapDraftStop(stop);
    expect(swapped.venueId).toBe("devonshire");
    expect(heldSwapLine(stop, new Set(), { priceLed: false })).toBeNull();
    expect(swapPriceNote(stop, swapped)).toBe(", £1.70 more a pint");
  });

  it("keeps the area line on a pub swapped in from the generator's own list", () => {
    const swapped = swapDraftStop(queensHead(), new Set(), { ...cheap, confirmedVenueId: "glasshouse" });
    expect(swapped.reason).toBeTruthy();
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
