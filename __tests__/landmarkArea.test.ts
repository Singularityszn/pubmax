import { describe, expect, it } from "vitest";

import { landmarkAreaLine, nightAreaContaining } from "@/lib/landmarkArea";
import { landmarkById } from "@/lib/landmarks";

// The story says where it is, because the top bar prints the area the reader
// CHOSE and may not be rewritten under that choice (captain's 390 shot,
// 2026-09-05: the bar said Barnes over a Covent Garden story). The line is
// honest by construction: only an area whose own radius covers the point may
// claim the landmark, and a landmark between areas gets no line at all.

describe("nightAreaContaining", () => {
  it("names the area whose radius covers Covent Garden", () => {
    const landmark = landmarkById("covent-garden");
    expect(landmark).toBeDefined();
    const area = nightAreaContaining("london", landmark!.coordinates);
    expect(area?.slug).toBe("piccadilly-soho");
    expect(landmarkAreaLine(area)).toBe("In Piccadilly & Soho");
  });

  it("answers nothing for a point outside every area rather than the nearest one", () => {
    // Mid-Thames off Woolwich: miles from any curated London patch.
    expect(nightAreaContaining("london", [0.06, 51.49])).toBeNull();
    expect(landmarkAreaLine(null)).toBeNull();
  });

  it("never claims an area from another city", () => {
    const landmark = landmarkById("covent-garden");
    expect(nightAreaContaining("manchester", landmark!.coordinates)).toBeNull();
  });
});
