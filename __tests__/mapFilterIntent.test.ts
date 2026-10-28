import { describe, expect, it } from "vitest";
import { updateMapFilterIntent } from "@/lib/mapFilterIntent";
import { initialFilters } from "@/lib/venues";

describe("current map filter choices", () => {
  it("remembers turning a preference off after another filter changes", () => {
    const first = updateMapFilterIntent({ filters: initialFilters, currentFilterKeys: [] }, { ...initialFilters, requireBeerGarden: true });
    const second = updateMapFilterIntent(first, { ...first.filters, requireBeerGarden: false, query: "Soho" });
    expect(second.currentFilterKeys).toContain("requireBeerGarden");
    expect(second.currentFilterKeys).toContain("query");
    expect(second.currentFilterKeys).not.toContain("requireStepFree");
  });

  it("an explicit reset overrides saved preferences even when already at defaults", () => {
    const state = updateMapFilterIntent({ filters: initialFilters, currentFilterKeys: [] }, { ...initialFilters });
    expect(state.currentFilterKeys).toContain("requireNonAlcoholic");
    expect(state.currentFilterKeys).toContain("drinkCategory");
    expect(state.currentFilterKeys).toContain("requireStepFree");
  });
});
