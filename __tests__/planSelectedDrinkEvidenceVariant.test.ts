import { describe, expect, it } from "vitest";

import {
  cleanSelectedDrinkPriceEvidence,
  selectedDrinkPriceDescription,
} from "@/lib/planSelectedDrinkPriceEvidence";

const listed = {
  category: "wine",
  pence: 525,
  serving: "125ml",
  source: "listed",
  sourceUrl: "https://example.org/menu",
  observedAt: "2026-09-29T10:40:17.846Z",
} as const;

describe("Plan selected drink evidence variants", () => {
  it("keeps a bounded listed citation and its explicit serving", () => {
    expect(cleanSelectedDrinkPriceEvidence(listed)).toEqual(listed);
    expect(selectedDrinkPriceDescription(listed)).toContain("125ml");
    expect(selectedDrinkPriceDescription(listed)).toContain("published menu");
  });

  it("marks absent listed serving as unknown", () => {
    const evidence = { ...listed, serving: null };
    expect(cleanSelectedDrinkPriceEvidence(evidence)).toEqual(evidence);
    expect(selectedDrinkPriceDescription(evidence)).toContain(
      "Serving size not recorded",
    );
  });

  it.each([
    { ...listed, sourceUrl: "javascript:alert(1)" },
    { ...listed, sourceUrl: "https://example.org/me\nnu" },
    { ...listed, sourceUrl: "https://person:secret@example.org/menu" },
    { ...listed, sourceUrl: "https://example.org/" + "x".repeat(2048) },
    { ...listed, observedAt: "2026-09-29" },
    { ...listed, serving: "x".repeat(49) },
    { ...listed, serving: "125\nml" },
    { ...listed, pence: 0 },
  ])("rejects malformed listed evidence", (invalid) => {
    expect(cleanSelectedDrinkPriceEvidence(invalid)).toBeNull();
  });

  it("preserves the exact five-field community shape", () => {
    const community = {
      category: "wine",
      pence: 550,
      serving: null,
      source: "community",
      reportedAt: "2026-09-25T12:00:00.000Z",
    };
    expect(
      cleanSelectedDrinkPriceEvidence({ ...community, contributor: "private" }),
    ).toEqual(community);
    expect(
      cleanSelectedDrinkPriceEvidence({
        ...community,
        sourceUrl: listed.sourceUrl,
      }),
    ).toEqual(community);
    expect(
      cleanSelectedDrinkPriceEvidence({ ...community, serving: "125ml" }),
    ).toBeNull();
  });
});


describe("Cider accepted named quote", () => {
  const cider = { category: "beer", pence: 365, serving: null, source: "listed",
    sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/",
    observedAt: "2026-09-21T18:27:31.674Z", drinkLabel: "Aspall 4.5%", drinkSubtype: "beer-cider" } as const;

  it("admits the actual Plough named-eight tuple and labels its serving unknown", () => {
    expect(cleanSelectedDrinkPriceEvidence(cider)).toEqual(cider);
    expect(Object.keys(cleanSelectedDrinkPriceEvidence(cider) ?? {})).toHaveLength(8);
    expect(selectedDrinkPriceDescription(cider)).toContain("Aspall 4.5%");
    expect(selectedDrinkPriceDescription(cider)).toContain("£3.65");
    expect(selectedDrinkPriceDescription(cider)).toContain("Serving size not recorded");
    expect(selectedDrinkPriceDescription(cider)).not.toMatch(/pint|current price/i);
  });

  it.each([
    ["generic legacy Beer", { category: "beer", pence: 365, serving: null, source: "listed",
      sourceUrl: cider.sourceUrl, observedAt: cider.observedAt }],
    ["Beer community aggregate", { category: "beer", pence: 365, serving: null, source: "community", reportedAt: cider.observedAt }],
    ["sibling lager", { ...cider, drinkLabel: "Pravha lager", drinkSubtype: "beer-lager" }],
    ["forged label/subtype", { ...cider, drinkLabel: "Pravha lager" }],
    ["forged cross-category subtype", { ...cider, drinkSubtype: "wine-red" }],
    ["missing paired label", { ...cider, drinkLabel: undefined }],
  ])("keeps %s outside the narrow Cider evidence contract", (_label, evidence) => {
    expect(cleanSelectedDrinkPriceEvidence(evidence)).toBeNull();
  });

  it("keeps Cider display evidence separate from requested pint measure", async () => {
    const { selectedDrinkPriceEvidenceForPrice } = await import("@/lib/planSelectedDrinkPriceEvidence");
    const price = { venueId: "venue-13xdb1p", category: "beer" as const, categoryLabel: "Beer",
      priceGbp: 3.65, source: "listed" as const, servingSize: null, drinkLabel: "Aspall 4.5%",
      sourceUrl: cider.sourceUrl, observedAt: cider.observedAt };
    const allServings = { drinkCategory: "beer" as const, zeroProof: false, drinkSubtype: "beer-cider", drinkServing: null };
    expect(selectedDrinkPriceEvidenceForPrice(price, allServings)).toEqual(cider);
    const pintOnly = { ...allServings, drinkServing: "pint" };
    expect(selectedDrinkPriceEvidenceForPrice(price, pintOnly)).toBeNull();
    expect(selectedDrinkPriceEvidenceForPrice(price, { drinkCategory: "beer", zeroProof: false })).toBeNull();
  });
});
