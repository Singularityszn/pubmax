import { describe, expect, it } from "vitest";

import { palCheapPerchLine, palFirstLegLabel, palPerchSpeech, palWalkLine } from "@/lib/palMapLines";

const legTimes = (...labels: unknown[]): GeoJSON.FeatureCollection => ({
  type: "FeatureCollection",
  features: labels.map((label) => ({
    type: "Feature",
    properties: { label },
    geometry: { type: "Point", coordinates: [-0.13, 51.51] },
  })),
});

describe("what the Pal says on the map", () => {
  it("reads the first leg's own time bubble, and nothing it cannot read", () => {
    expect(palFirstLegLabel(legTimes("7 min", "4 min"))).toBe("7 min");
    expect(palFirstLegLabel(legTimes("~12 min"))).toBe("~12 min");
    expect(palFirstLegLabel(legTimes())).toBeNull();
    expect(palFirstLegLabel(legTimes("seven"))).toBeNull();
    expect(palFirstLegLabel(legTimes(7))).toBeNull();
  });

  it("sets off with that time, says an estimate as one, and says nothing with no time", () => {
    const lines = ["a", "b", "c", "d", "e", "f"].map((key) => palWalkLine("7 min", key));
    for (const line of lines) {
      expect(line).toMatch(/^7 min (to the next pub\. Race you\.|on foot\. I'll wait at the door\.|to the next one\. Stretch first\.)$/);
    }
    expect(new Set(lines).size).toBeGreaterThan(1);
    expect(palWalkLine("~7 min", "a")).toMatch(/^About 7 min /);
    expect(palWalkLine(null, "a")).toBeNull();
  });

  it("keeps the same line for the same place, so a re-render never changes its mind", () => {
    expect(palWalkLine("7 min", "route-1")).toBe(palWalkLine("7 min", "route-1"));
    expect(palCheapPerchLine("venue-1")).toBe(palCheapPerchLine("venue-1"));
  });

  it("never shouts, names a price or asks for a drink", () => {
    const lines = [
      ...["a", "b", "c", "d", "e", "f"].map((key) => palCheapPerchLine(key)),
      ...["a", "b", "c", "d", "e", "f"].map((key) => palWalkLine("~7 min", key)!),
    ];
    for (const line of lines) {
      expect(line).not.toMatch(/!|—|£|\b(pint|drink|round|another|level|streak|points?)\b/i);
    }
  });
});

describe("the Pal's line beside a cheap pin", () => {
  it("speaks for a new cheap pub, once", () => {
    expect(palPerchSpeech("", "venue-a", true)).toEqual({ spoken: "venue-a", say: palCheapPerchLine("venue-a") });
    expect(palPerchSpeech("venue-a", "venue-a", true)).toEqual({ spoken: "venue-a" });
  });

  it("takes the line back when the Pal moves to a pub that is not cheap, or to none", () => {
    expect(palPerchSpeech("venue-a", "venue-b", false)).toEqual({ spoken: "", say: null });
    expect(palPerchSpeech("venue-a", null, false)).toEqual({ spoken: "", say: null });
  });

  it("takes the line back when the same pub's pin leaves the cheapest band", () => {
    expect(palPerchSpeech("venue-a", "venue-a", false)).toEqual({ spoken: "", say: null });
  });

  it("swaps the line for the next cheap pub, and says nothing new beside pubs that are not cheap", () => {
    expect(palPerchSpeech("venue-a", "venue-b", true)).toEqual({ spoken: "venue-b", say: palCheapPerchLine("venue-b") });
    expect(palPerchSpeech("", "venue-c", false)).toEqual({ spoken: "" });
  });
});

