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

const LOCALITY_NAMES: string[] = JSON.parse(
  readFileSync(
    path.join(process.cwd(), "public/data/london_localities.json"),
    "utf8",
  ),
).localities.map((locality: { name: string }) => locality.name);

const validate = (snapshot: unknown): string[] =>
  validateLateFoodEvidence(snapshot, LOCALITY_NAMES);

describe("late-food evidence snapshot", () => {
  it("covers all 20 canonical Night Areas and passes provenance validation", () => {
    expect(Object.keys(fixture.areas).sort()).toEqual(
      [...EXPECTED_NIGHT_AREA_SLUGS].sort(),
    );
    expect(EXPECTED_NIGHT_AREA_SLUGS).toHaveLength(20);
    expect(validate(fixture)).toEqual([]);
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
    expect(validate(invalid).join(" ")).toMatch(
      /sourced anchor/i,
    );
  });

  it("rejects an anchor document published for a different branch", () => {
    const invalid = structuredClone(fixture);
    invalid.areas.richmond.options[0].anchor.sourceUrl =
      "https://www.francomanca.co.uk/wp-content/uploads/2026/02/FM-MENU-L0226NC-WATERLOO-V2.pdf";
    expect(validate(invalid).join(" ")).toMatch(/names waterloo/i);
  });

  it("rejects an opaque PDF without branch-to-document proof", () => {
    const invalid = structuredClone(fixture);
    const option = invalid.areas.richmond.options[0];
    option.anchor.sourceUrl =
      "https://www.francomanca.co.uk/wp-content/uploads/2026/06/opaque-menu.pdf";
    delete option.source.anchorDocumentLink;
    expect(validate(invalid).join(" ")).toMatch(
      /PDF anchor requires an explicit operator-page link/i,
    );
  });

  it("rejects document proof that does not match the anchor", () => {
    const wrongDocument = structuredClone(fixture);
    wrongDocument.areas.richmond.options[0].source.anchorDocumentLink.documentUrl =
      "https://www.francomanca.co.uk/wp-content/uploads/2026/06/other.pdf";
    expect(validate(wrongDocument).join(" ")).toMatch(
      /documentUrl must match the anchor source/i,
    );
  });

  it("rejects document proof outside the option source chain", () => {
    const unrelatedPage = structuredClone(fixture);
    unrelatedPage.areas.richmond.options[0].source.anchorDocumentLink.pageUrl =
      "https://www.francomanca.co.uk/menu/";
    expect(validate(unrelatedPage).join(" ")).toMatch(
      /pageUrl must be recorded in the option provenance/i,
    );
  });

  it("rejects document proof from a different operator", () => {
    const wrongOperator = structuredClone(fixture);
    const source = wrongOperator.areas.richmond.options[0].source;
    source.anchorDocumentLink.pageUrl =
      "https://www.honestburgers.co.uk/menus/smash-and-grab-menu/";
    source.supportingUrls = [source.anchorDocumentLink.pageUrl];
    expect(validate(wrongOperator).join(" ")).toMatch(
      /page and document must share an operator host/i,
    );
  });

  it("records each Franco Manca branch page that links its exact menu PDF", () => {
    const expected = {
      victoria: {
        pageUrl:
          "https://www.francomanca.co.uk/restaurants/victoria-nova/",
        documentUrl:
          "https://www.francomanca.co.uk/wp-content/uploads/2026/06/FM-MENU-L0526P.pdf",
        price: 13.95,
      },
      "canary-wharf": {
        pageUrl:
          "https://www.francomanca.co.uk/restaurants/canary-wharf/",
        documentUrl:
          "https://www.francomanca.co.uk/wp-content/uploads/2026/06/FM-MENU-L0526P.pdf",
        price: 13.95,
      },
      islington: {
        pageUrl: "https://www.francomanca.co.uk/restaurants/islington/",
        documentUrl:
          "https://www.francomanca.co.uk/wp-content/uploads/2026/06/FM-MENU-L0526S.pdf",
        price: 13.5,
      },
      balham: {
        pageUrl: "https://www.francomanca.co.uk/restaurants/balham/",
        documentUrl:
          "https://www.francomanca.co.uk/wp-content/uploads/2026/06/FM-MENU-L0526S.pdf",
        price: 13.5,
      },
      richmond: {
        pageUrl: "https://www.francomanca.co.uk/restaurants/richmond/",
        documentUrl:
          "https://www.francomanca.co.uk/wp-content/uploads/2026/06/FM-MENU-L0526S.pdf",
        price: 13.5,
      },
      putney: {
        pageUrl: "https://www.francomanca.co.uk/restaurants/putney/",
        documentUrl:
          "https://www.francomanca.co.uk/wp-content/uploads/2026/06/FM-MENU-L0526S.pdf",
        price: 13.5,
      },
    } as const;

    for (const [area, proof] of Object.entries(expected)) {
      const option = fixture.areas[area].options[0];
      expect(option.source.sourceUrl).toBe(proof.pageUrl);
      expect(option.source.anchorDocumentLink).toEqual({
        pageUrl: proof.pageUrl,
        documentUrl: proof.documentUrl,
      });
      expect(option.anchor).toMatchObject({
        sourceUrl: proof.documentUrl,
        price: proof.price,
      });
    }
  });

  it("accepts a chain-wide anchor document that names no branch", () => {
    expect(
      fixture.areas.clapham.options[0].anchor.sourceUrl,
    ).toBe("https://www.honestburgers.co.uk/menus/smash-and-grab-menu/");
    expect(validate(fixture)).toEqual([]);
  });

  it("refuses to run the coverage check without a gazetteer", () => {
    expect(validateLateFoodEvidence(fixture, []).join(" ")).toMatch(
      /gazetteer is required/i,
    );
  });

  it("rejects competitor or review-aggregator provenance", () => {
    const invalid = structuredClone(fixture);
    invalid.areas["piccadilly-soho"].options[0].source.sourceUrl =
      "https://www.tripadvisor.co.uk/example";
    expect(validate(invalid).join(" ")).toMatch(
      /official-operator provenance/i,
    );
  });

  it("rejects non-operator supporting evidence", () => {
    const invalid = structuredClone(fixture);
    invalid.areas.barnes.options[0].source.supportingUrls = [
      "https://maps.example.com/barnes",
    ];
    expect(validate(invalid).join(" ")).toMatch(
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
    const errors = validate(invalid).join(" ");
    expect(errors).toMatch(/serviceHoursText/i);
    expect(errors).toMatch(/weeklyHours/i);
    expect(errors).toMatch(/coordinates/i);
    expect(errors).toMatch(/dates are out of order/i);
  });

  it.each([undefined, null, false, 0, "snapshot", []])(
    "returns only the snapshot error for non-object input %j",
    (value) => {
      expect(validateLateFoodEvidence(value, [])).toEqual([
        "snapshot must be an object",
      ]);
    },
  );

  it("reports the gazetteer and schema errors before the areas error", () => {
    expect(validateLateFoodEvidence({}, null)).toEqual([
      "a Greater London locality gazetteer is required to check anchor document coverage",
      "schemaVersion must be 1",
      "snapshotId is required",
      "generatedAt must be an ISO date",
      "coveragePolicy is required",
      "areas must be an object",
    ]);
  });

  it("keeps option errors ordered and detects duplicate IDs across areas", () => {
    const invalid = structuredClone(fixture);
    invalid.areas.clapham.options = [null, { id: "repeated" }];
    invalid.areas.victoria.options[0].id = "repeated";

    expect(validate(invalid)).toEqual([
      "clapham option 0: must be an object",
      "clapham option 1: identity, area, category and address are required",
      "clapham option 1: coordinates need an operator location link and Greater London point",
      "clapham option 1: explicit serviceHoursText is required",
      "clapham option 1: weeklyHours must include every weekday",
      "clapham option 1: verifyOnNight must be true",
      "clapham option 1: invalid confidence",
      "clapham option 1: a sourced anchor price is required",
      "clapham option 1: eligible official-operator provenance is required",
      "victoria option 0: id is missing or duplicated",
    ]);
  });

  it("reports invalid service windows in weekday order", () => {
    const invalid = structuredClone(fixture);
    const hours = invalid.areas.clapham.options[0].weeklyHours;
    hours.monday = null;
    hours.tuesday = [];
    hours.wednesday = [null];
    hours.thursday = [{ open: "24:00", close: "02:00", closesNextDay: true }];
    hours.friday = [{ open: "18:00", close: "02:00", closesNextDay: null }];

    expect(validate(invalid)).toEqual([
      "clapham option 0: monday has an invalid service window",
      "clapham option 0: tuesday has an invalid service window",
      "clapham option 0: wednesday has an invalid service window",
      "clapham option 0: thursday has an invalid service window",
      "clapham option 0: friday has an invalid service window",
    ]);
  });

  it("continues after invalid supporting URLs but stops at invalid provenance dates", () => {
    const invalid = structuredClone(fixture);
    const source = invalid.areas.clapham.options[0].source;
    source.supportingUrls = null;
    source.observedAt = null;
    source.expiresAt = source.reviewedAt;

    expect(validate(invalid)).toEqual([
      "clapham option 0: supportingUrls must contain only eligible official-operator URLs",
      "clapham option 0: observedAt, reviewedAt and expiresAt must be ISO dates",
    ]);

    source.publisher = null;
    expect(validate(invalid)).toEqual([
      "clapham option 0: eligible official-operator provenance is required",
    ]);
  });

  it("accepts overnight windows and optional non-PDF link evidence", () => {
    const valid = structuredClone(fixture);
    const option = valid.areas.clapham.options[0];
    option.weeklyHours.monday = [
      { open: "23:00", close: "00:00", closesNextDay: true },
    ];
    delete option.source.supportingUrls;
    option.source.anchorDocumentLink = null;

    expect(validate(valid)).toEqual([]);
  });
});
