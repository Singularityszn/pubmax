import { describe, expect, it } from "vitest";

import type { LegOption } from "@/lib/legOptions";
import { palLeadLine, palLeadPath, planWalkAfterLead } from "@/lib/palLead";

const way = (over: Partial<LegOption>): LegOption => ({
  id: "walk",
  kind: "walk",
  minutes: 6,
  farePence: 0,
  estimate: false,
  fastest: false,
  cheapest: false,
  parts: [],
  ...over,
});

describe("Pal leads the way", () => {
  it("walks the whole way as one path, each joint between parts once", () => {
    const option = way({
      kind: "transit",
      parts: [
        { mode: "walking", line: null, minutes: 2, path: [[-0.13, 51.51], [-0.131, 51.512]] },
        { mode: "tube", line: "Central", minutes: 3, path: [[-0.131, 51.512], [-0.14, 51.515], [-0.15, 51.515]] },
        { mode: "walking", line: null, minutes: 1, path: [[-0.15, 51.515], [-0.151, 51.516]] },
      ],
    });
    expect(palLeadPath(option)).toEqual([
      [-0.13, 51.51],
      [-0.131, 51.512],
      [-0.14, 51.515],
      [-0.15, 51.515],
      [-0.151, 51.516],
    ]);
    expect(palLeadPath(way({}))).toEqual([]);
  });

  it("says one line that reads only the marks the list shows", () => {
    expect(palLeadLine(way({ estimate: true, cheapest: true }))).toBe("No street map for this one. I'll go straight-ish.");
    expect(palLeadLine(way({ fastest: true, cheapest: true }))).toBe("Fastest and cheapest. We never get both.");
    expect(palLeadLine(way({ cheapest: true }))).toBe("Free and cheapest. Legs it is.");
    expect(palLeadLine(way({ kind: "transit", farePence: 175, cheapest: true }))).toBe("Cheapest way. More coins for later.");
    expect(palLeadLine(way({ kind: "transit", farePence: 280, fastest: true }))).toBe("Fastest way. Keep up.");
    expect(palLeadLine(way({ kind: "transit", farePence: null }))).toBe("TfL won't say the fare. Bold choice.");
    expect(palLeadLine(way({ kind: "transit", farePence: 300 }))).toBe("This way. Follow me.");
  });

  it("never shouts, and never claims a price it was not given", () => {
    const lines = [
      way({ estimate: true }),
      way({ fastest: true, cheapest: true }),
      way({ cheapest: true }),
      way({ kind: "transit", farePence: 175, cheapest: true }),
      way({ fastest: true }),
      way({ farePence: null }),
      way({}),
    ].map(palLeadLine);
    for (const line of lines) {
      expect(line).not.toMatch(/[!—]|£|\d/);
    }
  });
});

describe("the plan walk after a lead", () => {
  const walk = { key: "-0.13,51.51;-0.14,51.52", stops: [], path: [] };

  it("goes back to the plan's walk while it is still the route on the map", () => {
    expect(planWalkAfterLead(walk, walk.key)).toBe(walk);
  });

  it("has no walk to go back to once the plan ended or changed", () => {
    // The plan ended: no route on the map, so the perch or the empty map stands.
    expect(planWalkAfterLead(walk, "")).toBeNull();
    // A different route is on the map now.
    expect(planWalkAfterLead(walk, "-0.12,51.5;-0.11,51.5")).toBeNull();
    expect(planWalkAfterLead(null, walk.key)).toBeNull();
  });
});

