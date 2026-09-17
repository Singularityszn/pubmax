// How old the evidence behind a displayed price is, and nothing else.
//
// This file used to test a vouch reader: "×3 this week", "vouched this week",
// "vouched recently", all derived from the anonymous price-confirm tally that
// battle test L03 retired. Those cases are gone with the capability, because a
// test of a retired lane is a test that keeps its vocabulary alive.
//
// What is left is an age read over the price's own observation, plus the one
// line that invites a fresh look when that is old.

import { describe, expect, it } from "vitest";

import {
  FRESH_WITHIN_DAYS,
  priceConfidence,
  STALE_AFTER_DAYS,
} from "@/lib/priceConfidence";

const NOW = Date.parse("2026-09-05T18:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

describe("priceConfidence", () => {
  it("reads a price observed today as fresh, and says nothing about it", () => {
    expect(priceConfidence({ priceObservedAt: NOW - DAY }, NOW)).toEqual({
      state: "fresh",
      label: null,
    });
  });

  it("holds the fresh boundary itself as fresh", () => {
    expect(
      priceConfidence({ priceObservedAt: NOW - FRESH_WITHIN_DAYS * DAY }, NOW).state,
    ).toBe("fresh");
    expect(
      priceConfidence({ priceObservedAt: NOW - FRESH_WITHIN_DAYS * DAY - 1 }, NOW).state,
    ).toBe("aging");
  });

  it("goes quiet rather than humble in the middle band", () => {
    expect(priceConfidence({ priceObservedAt: NOW - 30 * DAY }, NOW)).toEqual({
      state: "aging",
      label: null,
    });
  });

  it("invites a fresh look once the observation is stale", () => {
    expect(
      priceConfidence({ priceObservedAt: NOW - STALE_AFTER_DAYS * DAY - DAY }, NOW),
    ).toEqual({ state: "stale", label: "worth a fresh look" });
  });

  it("treats an unknown observation date as stale rather than fresh", () => {
    // Absence of evidence is not evidence of freshness. The price still
    // renders; it just stops implying anybody checked it recently.
    expect(priceConfidence({}, NOW).state).toBe("stale");
    expect(priceConfidence({ priceObservedAt: null }, NOW).state).toBe("stale");
  });

  it("never claims a community vouch, because there is no longer such a thing", () => {
    // L03: the words this module used to print were about an anonymous,
    // IP-keyed tally that could not say how many PEOPLE stood behind a price.
    for (const days of [0, 3, 10, 20, 90]) {
      const label = priceConfidence({ priceObservedAt: NOW - days * DAY }, NOW).label;
      expect(label === null || label === "worth a fresh look").toBe(true);
    }
  });
});
