import { describe, expect, it } from "vitest";

import {
  poiFilter,
  transportFilter,
  opportunityForFeature,
} from "@/components/map/canvas/filters";
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
