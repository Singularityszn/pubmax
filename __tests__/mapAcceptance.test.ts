import { describe, it, expect } from "vitest";

import {
  buildMapAcceptanceIntentInput,
  initialAcceptanceSource,
  isPlanningIntentSource,
} from "@/lib/mapAcceptance";
import { createPlanningIntent } from "@/lib/planningIntent";

describe("isPlanningIntentSource", () => {
  it("accepts the four valid sources and rejects everything else", () => {
    for (const source of ["near", "map-search", "tonight", "pal"]) {
      expect(isPlanningIntentSource(source)).toBe(true);
    }
    expect(isPlanningIntentSource("direct-plan")).toBe(false);
    expect(isPlanningIntentSource("mobile-route-preview")).toBe(false);
    expect(isPlanningIntentSource("")).toBe(false);
    expect(isPlanningIntentSource(null)).toBe(false);
    expect(isPlanningIntentSource(undefined)).toBe(false);
  });
});

describe("initialAcceptanceSource", () => {
  it("reads a valid source only from a genuine accepted-handoff arrival", () => {
    expect(initialAcceptanceSource("?sel=v1&accept=1&src=near")).toBe("near");
    expect(initialAcceptanceSource("?accept=1&src=tonight")).toBe("tonight");
  });

  it("returns null without accept=1, or with an unknown/missing source", () => {
    expect(initialAcceptanceSource("?sel=v1&src=near")).toBeNull(); // browse deep link
    expect(initialAcceptanceSource("?accept=1")).toBeNull();
    expect(initialAcceptanceSource("?accept=1&src=direct-plan")).toBeNull();
    expect(initialAcceptanceSource("?accept=0&src=near")).toBeNull();
    expect(initialAcceptanceSource("")).toBeNull();
  });
});

describe("buildMapAcceptanceIntentInput", () => {
  it("builds a minimal honest envelope that parses as a valid PlanningIntent", () => {
    const input = buildMapAcceptanceIntentInput({
      source: "map-search",
      cityId: "london",
      acceptedVenueId: "venue-abc",
    });
    expect(input).toEqual({
      source: "map-search",
      cityId: "london",
      acceptedVenueId: "venue-abc",
      acceptedArea: null,
      startsAt: null,
      displayEvidence: { kind: "directory", observedAt: null },
    });
    // Round-trips through the real contract (2h envelope, canonical timestamps).
    const now = Date.parse("2026-07-24T18:00:00.000Z");
    const intent = createPlanningIntent(input, now);
    expect(intent).not.toBeNull();
    expect(intent?.source).toBe("map-search");
    expect(intent?.acceptedVenueId).toBe("venue-abc");
    expect(intent?.expiresAt).toBe("2026-07-24T20:00:00.000Z");
  });
});
