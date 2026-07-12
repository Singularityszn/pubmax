import { describe, expect, it } from "vitest";

import {
  poiFilter,
  transportFilter,
  opportunityForFeature,
  pubIconOpacityExpr,
  glowPulsePaint,
  hashEntranceSeed,
  pinEntranceLocalT,
  pinEntranceIconSizeExpr,
  pinEntranceIconOpacityExpr,
  PIN_ICON_SIZE_EXPR,
} from "@/components/map/canvas/filters";
import {
  GLOW_PULSE_PERIOD_MS,
  GLOW_PULSE_MIN_OPACITY,
  GLOW_PULSE_MAX_OPACITY,
  GLOW_PULSE_MIN_WIDTH,
  GLOW_PULSE_MAX_WIDTH,
  PIN_ENTRANCE_BUCKETS,
  PIN_ENTRANCE_STAGGER_MS,
  PIN_ENTRANCE_RAMP_MS,
  PIN_ENTRANCE_TOTAL_MS,
} from "@/components/map/canvas/tokens";
import type { PoiCategory } from "@/lib/pois";
import type { ThingsToDoOpportunity } from "@/lib/citymcp/client";

function hiddenMap(hidden: Partial<Record<PoiCategory, boolean>> = {}): Record<PoiCategory, boolean> {
  return new Proxy(hidden as Record<PoiCategory, boolean>, {
    get: (target, key: string) => Boolean(target[key as PoiCategory]),
  });
}

describe("poiFilter", () => {
  it("excludes hidden categories from the literal list", () => {
    const filter = poiFilter(hiddenMap({ park: true }), ["park", "garden", "market"]);
    // ["in", ["get","category"], ["literal", [...visible]]]
    const literal = (filter as unknown as [string, unknown, [string, string[]]])[2][1];
    expect(literal).toEqual(["garden", "market"]);
  });
});

describe("transportFilter", () => {
  it("toggles the rank test between == and != on majorOnly", () => {
    const major = transportFilter(hiddenMap(), true) as unknown as [string, unknown, [string, ...unknown[]]];
    const minor = transportFilter(hiddenMap(), false) as unknown as [string, unknown, [string, ...unknown[]]];
    expect(major[2][0]).toBe("==");
    expect(minor[2][0]).toBe("!=");
  });
});

describe("opportunityForFeature", () => {
  const ops: ThingsToDoOpportunity[] = [
    { title: "Jazz Night", place: { name: "The Blue Note" } } as ThingsToDoOpportunity,
  ];

  it("matches on title + placeName", () => {
    expect(
      opportunityForFeature({ title: "Jazz Night", placeName: "The Blue Note" }, ops),
    ).toBe(ops[0]);
  });

  it("matches on title only", () => {
    expect(opportunityForFeature({ title: "Jazz Night" }, ops)).toBe(ops[0]);
  });

  it("matches on placeName only", () => {
    expect(opportunityForFeature({ placeName: "The Blue Note" }, ops)).toBe(ops[0]);
  });

  it("returns undefined on a miss", () => {
    expect(opportunityForFeature({ title: "Nope" }, ops)).toBeUndefined();
  });
});

describe("pubIconOpacityExpr", () => {
  it("keeps the plain serves-based dim when nothing is selected", () => {
    expect(pubIconOpacityExpr("")).toEqual(["case", ["get", "serves"], 0.98, 0.22]);
  });

  it("selected pin reads at full opacity; other serving pins ease to 0.45", () => {
    const expr = pubIconOpacityExpr("pub-1");
    expect(expr).toEqual([
      "case",
      ["==", ["get", "id"], "pub-1"],
      1,
      ["case", ["get", "serves"], 0.45, 0.22],
    ]);
  });
});

describe("glowPulsePaint", () => {
  it("stays within the configured min/max envelope", () => {
    for (let t = 0; t < GLOW_PULSE_PERIOD_MS * 3; t += 97) {
      const { opacity, width } = glowPulsePaint(t);
      expect(opacity).toBeGreaterThanOrEqual(GLOW_PULSE_MIN_OPACITY - 1e-9);
      expect(opacity).toBeLessThanOrEqual(GLOW_PULSE_MAX_OPACITY + 1e-9);
      expect(width).toBeGreaterThanOrEqual(GLOW_PULSE_MIN_WIDTH - 1e-9);
      expect(width).toBeLessThanOrEqual(GLOW_PULSE_MAX_WIDTH + 1e-9);
    }
  });

  it("is periodic with GLOW_PULSE_PERIOD_MS", () => {
    const a = glowPulsePaint(123);
    const b = glowPulsePaint(123 + GLOW_PULSE_PERIOD_MS);
    expect(a.opacity).toBeCloseTo(b.opacity, 9);
    expect(a.width).toBeCloseTo(b.width, 9);
  });

  it("breathes: min near phase 0.75 of the period, max near phase 0.25", () => {
    const quarter = glowPulsePaint(GLOW_PULSE_PERIOD_MS * 0.25);
    const threeQuarter = glowPulsePaint(GLOW_PULSE_PERIOD_MS * 0.75);
    expect(quarter.opacity).toBeCloseTo(GLOW_PULSE_MAX_OPACITY, 5);
    expect(threeQuarter.opacity).toBeCloseTo(GLOW_PULSE_MIN_OPACITY, 5);
  });
});

describe("hashEntranceSeed (M7 pin entrance stagger key)", () => {
  it("is deterministic for the same id", () => {
    expect(hashEntranceSeed("pub-123", 14)).toBe(hashEntranceSeed("pub-123", 14));
  });

  it("stays within [0, buckets)", () => {
    for (const id of ["a", "pub-1", "pub-2", "The Blue Note, W1", "", "🍺-emoji-id"]) {
      const seed = hashEntranceSeed(id, PIN_ENTRANCE_BUCKETS);
      expect(seed).toBeGreaterThanOrEqual(0);
      expect(seed).toBeLessThan(PIN_ENTRANCE_BUCKETS);
    }
  });

  it("spreads a run of similar ids across more than one bucket (not a mechanical/degenerate hash)", () => {
    const seeds = new Set<number>();
    for (let i = 0; i < 50; i++) seeds.add(hashEntranceSeed(`pub-${i}`, PIN_ENTRANCE_BUCKETS));
    expect(seeds.size).toBeGreaterThan(1);
  });
});

describe("pinEntranceLocalT (M7 pure stagger/ramp math)", () => {
  it("is 0 before a bucket's delay has elapsed", () => {
    expect(pinEntranceLocalT(0, 10, 14, PIN_ENTRANCE_STAGGER_MS, PIN_ENTRANCE_RAMP_MS)).toBe(0);
  });

  it("reaches 1 once stagger + ramp have elapsed for every bucket", () => {
    for (let seed = 0; seed < 14; seed++) {
      expect(
        pinEntranceLocalT(PIN_ENTRANCE_TOTAL_MS, seed, 14, PIN_ENTRANCE_STAGGER_MS, PIN_ENTRANCE_RAMP_MS),
      ).toBe(1);
    }
  });

  it("bucket 0 ramps in before the last bucket at the same elapsed time", () => {
    const mid = PIN_ENTRANCE_STAGGER_MS / 2;
    const early = pinEntranceLocalT(mid, 0, 14, PIN_ENTRANCE_STAGGER_MS, PIN_ENTRANCE_RAMP_MS);
    const late = pinEntranceLocalT(mid, 13, 14, PIN_ENTRANCE_STAGGER_MS, PIN_ENTRANCE_RAMP_MS);
    expect(early).toBeGreaterThan(late);
  });

  it("clamps to [0, 1] outside the ramp window", () => {
    expect(pinEntranceLocalT(-500, 0, 14, PIN_ENTRANCE_STAGGER_MS, PIN_ENTRANCE_RAMP_MS)).toBe(0);
    expect(pinEntranceLocalT(999999, 13, 14, PIN_ENTRANCE_STAGGER_MS, PIN_ENTRANCE_RAMP_MS)).toBe(1);
  });
});

describe("pinEntranceIconSizeExpr / pinEntranceIconOpacityExpr (M7 selection guard)", () => {
  it("size: with no selection, wraps PIN_ICON_SIZE_EXPR in a localT multiply", () => {
    const expr = pinEntranceIconSizeExpr(0, "", PIN_ENTRANCE_BUCKETS, PIN_ENTRANCE_STAGGER_MS, PIN_ENTRANCE_RAMP_MS);
    expect(expr[0]).toBe("*");
    expect(expr[2]).toEqual(PIN_ICON_SIZE_EXPR);
  });

  it("size: the selected pin bypasses the ramp entirely (M1 spotlight wins)", () => {
    const expr = pinEntranceIconSizeExpr(
      0,
      "pub-1",
      PIN_ENTRANCE_BUCKETS,
      PIN_ENTRANCE_STAGGER_MS,
      PIN_ENTRANCE_RAMP_MS,
    ) as unknown as ["case", unknown, unknown, unknown];
    expect(expr[0]).toBe("case");
    expect(expr[1]).toEqual(["==", ["get", "id"], "pub-1"]);
    expect(expr[2]).toEqual(PIN_ICON_SIZE_EXPR);
  });

  it("opacity: the selected pin keeps pubIconOpacityExpr's value, not the ramped one", () => {
    const expr = pinEntranceIconOpacityExpr(
      0,
      "pub-1",
      PIN_ENTRANCE_BUCKETS,
      PIN_ENTRANCE_STAGGER_MS,
      PIN_ENTRANCE_RAMP_MS,
    ) as unknown as ["case", unknown, unknown, unknown];
    expect(expr[0]).toBe("case");
    expect(expr[2]).toEqual(pubIconOpacityExpr("pub-1"));
  });
});
