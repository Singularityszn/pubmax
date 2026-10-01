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
