import { describe, expect, it } from "vitest";

import {
  buildTonightDecisionModel,
  tonightDecisionListingState,
} from "@/lib/tonightDecision";

describe("Tonight decision model", () => {
  it("compresses listing fetch states into honest launcher states", () => {
    expect(tonightDecisionListingState("idle")).toBe("checking");
    expect(tonightDecisionListingState("ready")).toBe("ready");
    expect(tonightDecisionListingState("empty")).toBe("quiet");
    expect(tonightDecisionListingState("error")).toBe("unavailable");
  });

  it("offers the three existing mobile outcomes without adding a new flow", () => {
    const model = buildTonightDecisionModel({
      listingState: "ready",
      listingCount: 12,
      areaLabel: "Shoreditch",
    });

    expect(model.proof).toBe("Shoreditch \u00b7 12 sourced listings tonight");
    expect(model.options.map((option) => option.id)).toEqual([
      "one-pub",
      "three-stop",
      "whats-on",
    ]);
    expect(model.options.map((option) => option.href)).toEqual([
      "/near?source=tonight-decision",
      "/plan?source=tonight-decision",
      "#tonight-listings",
    ]);
  });

  it("keeps quiet and failed listings useful", () => {
    expect(
      buildTonightDecisionModel({ listingState: "quiet", listingCount: 0 }).proof,
    ).toBe("Quiet listings, full pub map");
    expect(
      buildTonightDecisionModel({
        listingState: "unavailable",
        listingCount: 0,
      }).proof,
    ).toBe("The map and planner are ready");
  });

  it("normalizes invalid counts and empty area labels", () => {
    const model = buildTonightDecisionModel({
      listingState: "ready",
      listingCount: -4.8,
      areaLabel: "   ",
    });
    expect(model.proof).toBe("0 sourced listings tonight");
    expect(
      buildTonightDecisionModel({
        listingState: "ready",
        listingCount: Number.NaN,
      }).proof,
    ).toBe("0 sourced listings tonight");
  });
});
