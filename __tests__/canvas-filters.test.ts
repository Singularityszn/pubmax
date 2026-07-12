import { describe, expect, it } from "vitest";

import {
  poiFilter,
  transportFilter,
  opportunityForFeature,
  pubIconOpacityExpr,
  glowPulsePaint,
} from "@/components/map/canvas/filters";
import {
  GLOW_PULSE_PERIOD_MS,
  GLOW_PULSE_MIN_OPACITY,
  GLOW_PULSE_MAX_OPACITY,
  GLOW_PULSE_MIN_WIDTH,
  GLOW_PULSE_MAX_WIDTH,
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
