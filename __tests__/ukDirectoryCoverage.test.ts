import { describe, expect, it } from "vitest";

import { ukDirectoryCoverage } from "@/lib/ukDirectoryCoverage";

// Independent metadata fixture: four named pubs, two unnamed pubs, three bars.
const generatedFrom = { pubs: 4, unnamed: 2, bars: 3, count: 9 };

describe("UK directory coverage", () => {
  it("includes unnamed pub listings and keeps bars separate", () => {
    expect(ukDirectoryCoverage({ generatedFrom })).toEqual({
      pubListings: 6,
      barListings: 3,
    });
  });

  it("accepts a pack containing pubs without bars or unnamed pubs", () => {
    expect(ukDirectoryCoverage({
      generatedFrom: { pubs: 4, unnamed: 0, bars: 0, count: 4 },
    })).toEqual({ pubListings: 4, barListings: 0 });
  });

  it.each([null, undefined, [], {}, { generatedFrom: null }])(
    "does not invent a count from missing metadata: %j",
    (manifest) => {
      expect(ukDirectoryCoverage(manifest)).toBeNull();
    },
  );

  for (const field of ["pubs", "unnamed", "bars", "count"] as const) {
    it.each([undefined, "4", -1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1])(
      `refuses an invalid ${field} value: %s`,
      (value) => {
        expect(ukDirectoryCoverage({
          generatedFrom: { ...generatedFrom, [field]: value },
        })).toBeNull();
      },
    );
  }

  it("withholds a count when the kind totals disagree with the pack", () => {
    expect(ukDirectoryCoverage({
      generatedFrom: { ...generatedFrom, count: 8 },
    })).toBeNull();
  });

  it("does not publish an empty pack as zero UK coverage", () => {
    expect(ukDirectoryCoverage({
      generatedFrom: { pubs: 0, unnamed: 0, bars: 0, count: 0 },
    })).toBeNull();
  });
});
