import { describe, expect, it } from "vitest";

import { resolveComposerHydration } from "@/lib/planComposerHandoff";
import {
  PLAN_ROUTE_DRAFT_KEY,
  PLAN_ROUTE_DRAFT_TTL_MS,
  PLAN_ROUTE_DRAFT_V2_KEY,
  reconcilePlanRouteDrafts,
  writePlanRouteDraftEnvelope,
} from "@/lib/planRouteDraft";

type RouteValue = Parameters<typeof writePlanRouteDraftEnvelope>[0];

const T0 = Date.parse("2026-11-01T19:00:00Z");

function anchoredRoute(): RouteValue {
  return {
    stops: ["v1", "v2", "v3"].map((venueId, index) => ({
      key: index + 1, venueId, venueName: `Pub ${index + 1}`, alternatives: [],
    })),
    alternatives: [], nightContext: null, routeTotals: null, transportBasis: null,
    planningConfidence: null, warnings: [], operationKey: null, routeRevision: null,
    anchorVenueId: "v1", anchorSource: "near", outcome: "route", groundingProof: null, routeStale: false,
  } as unknown as RouteValue;
}

function storedRoute(): Map<string, string> {
  const stored = new Map<string, string>();
  const storage = {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    removeItem: (key: string) => { stored.delete(key); },
  } as unknown as Storage;
  writePlanRouteDraftEnvelope(anchoredRoute(), "manual", storage, T0);
  return stored;
}

function hydrateAt(stored: Map<string, string>, now: number) {
  const { envelope } = reconcilePlanRouteDrafts(
    stored.get(PLAN_ROUTE_DRAFT_V2_KEY) ?? null,
    stored.get(PLAN_ROUTE_DRAFT_KEY) ?? null,
    now,
  );
  return {
    envelope,
    hydration: resolveComposerHydration({
      planDraft: null, routeDraft: envelope, intakeDraft: null, planningIntent: null, rememberedArea: null,
    }),
  };
}

describe("a dated V1 route copy past the route lifetime", () => {
  // The V2 record expires after a day. The V1 copy now carries the accepted
  // pub and its save time, so it must not keep holding that pub for ever.
  it("keeps the stops as a preview but holds no accepted pub days later", () => {
    const { envelope, hydration } = hydrateAt(storedRoute(), T0 + 5 * 24 * 60 * 60 * 1000);
    expect(envelope?.value.stops.map((stop) => stop.venueId)).toEqual(["v1", "v2", "v3"]);
    expect(envelope?.value.anchorVenueId).toBeNull();
    expect(hydration.heldVenueId).toBeNull();
  });

  it("still holds the accepted pub inside the route lifetime", () => {
    const { hydration } = hydrateAt(storedRoute(), T0 + PLAN_ROUTE_DRAFT_TTL_MS - 60_000);
    expect(hydration.heldVenueId).toBe("v1");
  });
});
