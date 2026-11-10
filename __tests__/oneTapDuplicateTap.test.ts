// Three taps on Log it in one tick are ONE price (battle test D10).

import { describe, expect, it } from "vitest";

import {
  duplicateOneTapDrop,
  ONE_TAP_DUPLICATE_WINDOW_MS,
} from "@/lib/oneTapDuplicate";
import type { PintDrop } from "@/lib/pintDrops";

const NOW = Date.parse("2026-09-05T18:00:00.000Z");
const VENUE = "venue-a9nk2t";

function row(over: Partial<PintDrop> & { id: string }): PintDrop {
  return {
    venueId: VENUE,
    handle: "bobpent",
    drink: "Beer",
    priceGbp: 5.9,
    passedDownNote: "",
    era: "",
    provenance: "contributor",
    status: "visible",
    visibility: "public",
    createdAt: new Date(NOW - 21).toISOString(),
    ...over,
  };
}

const candidate = {
  venueId: VENUE,
  handle: "bobpent",
  priceGbp: 5.9,
  measure: "pint" as const,
};

describe("the duplicate-tap window", () => {
  it("reads the report's own burst as one tap", () => {
    // The rows landed 21 ms apart at venue-a9nk2t, one account, one figure.
    const first = row({ id: "burst-1", createdAt: new Date(NOW - 21).toISOString() });
    expect(duplicateOneTapDrop([first], candidate, NOW)?.id).toBe("burst-1");
  });

  it("answers with the FRESHEST matching row, so a third tap sees the second", () => {
    const rows = [
      row({ id: "burst-1", createdAt: new Date(NOW - 21).toISOString() }),
      row({ id: "burst-2", createdAt: new Date(NOW - 9).toISOString() }),
    ];
    expect(duplicateOneTapDrop(rows, candidate, NOW)?.id).toBe("burst-2");
  });

  it("lets an honest second report through once the window has passed", () => {
    const old = row({
      id: "earlier",
      createdAt: new Date(NOW - ONE_TAP_DUPLICATE_WINDOW_MS - 1).toISOString(),
    });
    expect(duplicateOneTapDrop([old], candidate, NOW)).toBe(null);
  });

  it("holds the boundary itself as a duplicate", () => {
    const edge = row({
      id: "edge",
      createdAt: new Date(NOW - ONE_TAP_DUPLICATE_WINDOW_MS).toISOString(),
    });
    expect(duplicateOneTapDrop([edge], candidate, NOW)?.id).toBe("edge");
  });

  it("is not a daily cap: a CORRECTION at a different figure still lands", () => {
    // The pairing lane takes several prices from one account at one pub in one
    // day on purpose. Only an exact repeat is refused.
    const other = row({ id: "different", priceGbp: 6.2 });
    expect(duplicateOneTapDrop([other], candidate, NOW)).toBe(null);
  });

  it("does not merge two different drinkers", () => {
    const someoneElse = row({ id: "alice", handle: "alicepent" });
    expect(duplicateOneTapDrop([someoneElse], candidate, NOW)).toBe(null);
  });

  it("does not merge two different pubs", () => {
    const elsewhere = row({ id: "other-pub", venueId: "venue-elsewhere" });
    expect(duplicateOneTapDrop([elsewhere], candidate, NOW)).toBe(null);
  });

  it("does not merge two different measures at one figure", () => {
    // £2.60 for a half and £2.60 for a pint are two observations, not one tap.
    const half = row({ id: "half", priceGbp: 2.6, measure: "half" });
    expect(
      duplicateOneTapDrop([half], { ...candidate, priceGbp: 2.6 }, NOW),
    ).toBe(null);
  });

  it("treats a row dated ahead of us as a clock, never a repeat", () => {
    const ahead = row({ id: "ahead", createdAt: new Date(NOW + 5_000).toISOString() });
    expect(duplicateOneTapDrop([ahead], candidate, NOW)).toBe(null);
  });

  it("says nothing about an unpriced row", () => {
    expect(
      duplicateOneTapDrop([row({ id: "note" })], { ...candidate, priceGbp: null }, NOW),
    ).toBe(null);
  });
});
