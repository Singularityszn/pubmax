import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error The dependency-free validator is shared with the Node data gate.
import { EXPECTED_NIGHT_AREA_SLUGS, validateLateFoodEvidence } from "@/scripts/lib/validateLateFoodEvidence.mjs";

const fixture = JSON.parse(readFileSync(path.join(process.cwd(), "public/data/late_food_evidence.json"), "utf8"));

describe("late-food evidence snapshot", () => {
  it("covers all 20 canonical Night Areas and passes provenance validation", () => {
    expect(Object.keys(fixture.areas).sort()).toEqual([...EXPECTED_NIGHT_AREA_SLUGS].sort());
    expect(EXPECTED_NIGHT_AREA_SLUGS).toHaveLength(20);
    expect(validateLateFoodEvidence(fixture)).toEqual([]);
  });

  it("has at least one expiring first-party option for every Night Area", () => {
    const areas = Object.values(fixture.areas) as Array<{ status: string; options: Array<{ source: { sourceUrl: string; expiresAt: string } }> }>;
    expect(areas.every((area) => area.status === "partial" && area.options.length >= 1)).toBe(true);
    expect(areas.flatMap((area) => area.options)).toHaveLength(20);
    expect(areas.flatMap((area) => area.options).every((option) =>
      option.source.sourceUrl.startsWith("https://") && Date.parse(option.source.expiresAt) > Date.parse(fixture.generatedAt)
    )).toBe(true);
  });

  it("rejects competitor or review-aggregator provenance", () => {
    const invalid = structuredClone(fixture);
    invalid.areas["piccadilly-soho"].options[0].source.sourceUrl = "https://www.tripadvisor.co.uk/example";
    expect(validateLateFoodEvidence(invalid).join(" ")).toMatch(/official-operator provenance/i);
  });

  it("rejects non-operator supporting evidence", () => {
    const invalid = structuredClone(fixture);
    invalid.areas.barnes.options[0].source.supportingUrls = ["https://maps.example.com/barnes"];
    expect(validateLateFoodEvidence(invalid).join(" ")).toMatch(/supportingUrls/i);
  });

  it("requires explicit hours, coordinates and ordered evidence dates", () => {
    const invalid = structuredClone(fixture);
    const option = invalid.areas["piccadilly-soho"].options[0];
    option.serviceHoursText = "";
    delete option.weeklyHours.monday;
    option.coordinates.method = "nearest_guess";
    option.source.expiresAt = option.source.observedAt;
    const errors = validateLateFoodEvidence(invalid).join(" ");
    expect(errors).toMatch(/serviceHoursText/i);
    expect(errors).toMatch(/weeklyHours/i);
    expect(errors).toMatch(/coordinates/i);
    expect(errors).toMatch(/dates are out of order/i);
  });
});
