import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, expectTypeOf, it, vi } from "vitest";

import { boroughCode } from "@/lib/boroughCode";
import { LONDON_BOROUGH_NAMES } from "@/lib/londonBoroughNames.mjs";
import {
  DERIVED_NIGHT_AREA_SLUGS,
  LONDON_NIGHT_AREA_SLUGS,
  NIGHT_AREA_SLUGS,
} from "@/lib/nightAreaSlugs";
import * as nightAreas from "@/lib/nightAreas";
import * as pintIndex from "@/lib/pintIndex";

describe("analytics vocabulary ownership", () => {
  it("keeps legacy area exports on the canonical tuple objects", () => {
    expect(nightAreas.LONDON_NIGHT_AREA_SLUGS).toBe(LONDON_NIGHT_AREA_SLUGS);
    expect(nightAreas.DERIVED_NIGHT_AREA_SLUGS).toBe(DERIVED_NIGHT_AREA_SLUGS);
    expect(nightAreas.NIGHT_AREA_SLUGS).toBe(NIGHT_AREA_SLUGS);
  });

  it("keeps legacy borough exports on the shared names and code function", () => {
    expect(pintIndex.LONDON_BOROUGH_NAMES).toBe(LONDON_BOROUGH_NAMES);
    expect(pintIndex.boroughCode).toBe(boroughCode);
    expect(boroughCode("Kensington & Chelsea")).toBe("kensington-and-chelsea");
    expect(boroughCode(" City of London ")).toBe("city-of-london");
  });

  it("keeps the borough declaration closed and aligned with its runtime owner", () => {
    const declaration = readFileSync(
      join(process.cwd(), "lib/londonBoroughNames.d.mts"),
      "utf8",
    );
    const declaredNames = [...declaration.matchAll(/"([^"]+)"/g)].map((match) => match[1]);
    expect(declaredNames).toEqual(LONDON_BOROUGH_NAMES);
    expectTypeOf<pintIndex.LondonBoroughName>().not.toEqualTypeOf<string>();
    expectTypeOf<"Soho">().not.toMatchTypeOf<pintIndex.LondonBoroughName>();
  });

  it("sanitizes the closed vocabularies without loading area or index models", async () => {
    vi.resetModules();
    vi.doMock("@/lib/nightAreas", () => {
      throw new Error("analytics must not load full night-area data");
    });
    vi.doMock("@/lib/pintIndex", () => {
      throw new Error("analytics must not load the Pint Index model");
    });

    try {
      const { sanitizeEvent } = await import("@/lib/analyticsEvents");
      for (const area of NIGHT_AREA_SLUGS) {
        expect(sanitizeEvent("night_description_submitted", { area })).toEqual({
          name: "night_description_submitted",
          props: { area },
        });
      }
      for (const name of LONDON_BOROUGH_NAMES) {
        const area = boroughCode(name);
        expect(sanitizeEvent("pint_index_area_opened", { area, surface: "index" })).toEqual({
          name: "pint_index_area_opened",
          props: { area, surface: "index" },
        });
      }
      expect(sanitizeEvent("night_description_submitted", {
        area: "reader@example.com",
        coordinates: "51.5,-0.1",
      })).toEqual({ name: "night_description_submitted", props: {} });
      expect(sanitizeEvent("pint_index_area_opened", {
        area: "invented-borough",
        surface: "index",
      })).toBeNull();
    } finally {
      vi.doUnmock("@/lib/nightAreas");
      vi.doUnmock("@/lib/pintIndex");
      vi.resetModules();
    }
  });
});
