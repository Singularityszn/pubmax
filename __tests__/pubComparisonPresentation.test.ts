import { describe, expect, it } from "vitest";
import type { PubComparisonResultVenue } from "@/lib/pubComparison";
import { comparisonDetour, comparisonShareText, comparisonPoll } from "@/lib/pubComparisonPresentation";

function venue(overrides: Partial<PubComparisonResultVenue> = {}): PubComparisonResultVenue {
  return {
    id: "venue-a", name: "The Crown", address: "1 Test Street", borough: "Islington",
    items: [], knownSubtotalPence: 1000, totalPence: 1000,
    walk: { status: "routed", minutes: 5, method: "ors", timing: "shared-walking-pace" },
    mapHref: "/map?sel=venue-a", ...overrides,
  };
}

describe("pub comparison decisions", () => {
  it("compares the same complete order and keeps pounds separate from minutes", () => {
    expect(comparisonDetour(venue(), venue({ id: "venue-b", totalPence: 800,
      walk: { status: "routed", minutes: 12, method: "ors", timing: "shared-walking-pace" },
    }))).toEqual({ savingPence: 200, extraMinutes: 7 });
  });

  it("refuses a saving based on an incomplete subtotal", () => {
    expect(comparisonDetour(venue(), venue({ totalPence: null, knownSubtotalPence: 100 }))).toBeNull();
  });

  it("refuses walking differences when either route is unavailable", () => {
    expect(comparisonDetour(venue(), venue({
      walk: { status: "unavailable", minutes: null, method: null, timing: null },
    }))).toBeNull();
  });

  it("shares public pub choices without meeting points, people, orders or private URLs", () => {
    const text = comparisonShareText([venue(), venue({ id: "venue-b", name: "The Bell", totalPence: null })]);
    expect(text).toContain("The Crown, 1 Test Street");
    expect(text).toContain("The Bell");
    expect(text).toContain("Order incomplete");
    expect(text).toContain("https://pubmaxxing.com/ledger/venue-a");
    expect(text).not.toContain("?sel=");
    expect(text).not.toContain("£10");
  });

  it("keeps same-name poll options distinct and refuses a one-pub ballot", () => {
    expect(comparisonPoll([venue()])).toBeNull();
    const poll = comparisonPoll([venue(), venue({ id: "venue-b", address: "2 Other Street" })]);
    expect(poll?.options).toEqual(["1. The Crown, 1 Test Street", "2. The Crown, 2 Other Street"]);
  });
});
