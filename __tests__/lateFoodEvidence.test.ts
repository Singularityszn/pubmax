import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// @ts-expect-error The dependency-free validator is shared with the Node data gate.
// prettier-ignore
import { EXPECTED_NIGHT_AREA_SLUGS, validateLateFoodEvidence } from "@/scripts/lib/validateLateFoodEvidence.mjs";

const fixture = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "public/data/late_food_evidence.json"),
    "utf8",
  ),
);

describe("late-food evidence snapshot", () => {
  it("covers all 20 canonical Night Areas and passes provenance validation", () => {
    expect(Object.keys(fixture.areas).sort()).toEqual(
      [...EXPECTED_NIGHT_AREA_SLUGS].sort(),
    );
    expect(EXPECTED_NIGHT_AREA_SLUGS).toHaveLength(20);
    expect(validateLateFoodEvidence(fixture)).toEqual([]);
  });

  it("has at least one expiring, anchor-priced first-party option for every Night Area", () => {
    const areas = Object.values(fixture.areas) as Array<{
      status: string;
      options: Array<{
        anchor: {
          label: string;
          price: number;
          sourceUrl: string;
          observedAt: string;
        };
        source: { sourceUrl: string; expiresAt: string };
      }>;
    }>;
    expect(
      areas.every(
        (area) => area.status === "partial" && area.options.length >= 1,
      ),
    ).toBe(true);
    expect(areas.flatMap((area) => area.options)).toHaveLength(20);
    expect(
      areas
        .flatMap((area) => area.options)
        .every(
          (option) =>
            option.source.sourceUrl.startsWith("https://") &&
            Date.parse(option.source.expiresAt) >
              Date.parse(fixture.generatedAt) &&
            option.anchor.label.length > 2 &&
            option.anchor.price > 0 &&
            option.anchor.sourceUrl.startsWith("https://") &&
            Number.isFinite(Date.parse(option.anchor.observedAt)),
        ),
    ).toBe(true);
  });

  it("rejects an option whose published anchor loses provenance", () => {
    const invalid = structuredClone(fixture);
    delete invalid.areas["piccadilly-soho"].options[0].anchor.sourceUrl;
    expect(validateLateFoodEvidence(invalid).join(" ")).toMatch(
      /sourced anchor/i,
    );
  });

  it("rejects competitor or review-aggregator provenance", () => {
    const invalid = structuredClone(fixture);
    invalid.areas["piccadilly-soho"].options[0].source.sourceUrl =
      "https://www.tripadvisor.co.uk/example";
    expect(validateLateFoodEvidence(invalid).join(" ")).toMatch(
      /official-operator provenance/i,
    );
  });

  it("rejects non-operator supporting evidence", () => {
    const invalid = structuredClone(fixture);
    invalid.areas.barnes.options[0].source.supportingUrls = [
      "https://maps.example.com/barnes",
    ];
    expect(validateLateFoodEvidence(invalid).join(" ")).toMatch(
      /supportingUrls/i,
    );
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
