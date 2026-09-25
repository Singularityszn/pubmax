import { describe, expect, it } from "vitest";

import {
  HARVEST_SOURCES,
  isHarvestableDrinkUpdateUrl,
  isHarvestableOperatorUrl,
  isRefusedOnPermission,
} from "@/lib/harvest/sourcePolicy";
import {
  TAVILY_HARVEST_DEFAULT_EXTRACT_CAP,
  tavilyHarvestExtractCap,
} from "@/lib/paidSpendBudget";

describe("drink update source permission", () => {
  it("refuses Nicholson's when robots permission cannot be read", () => {
    const source = HARVEST_SOURCES.find((row) => row.id === "mitchells-butlers-menu-prices");
    expect(source && isRefusedOnPermission(source)).toBe(true);
    expect(
      isHarvestableDrinkUpdateUrl("https://www.nicholsonspubs.co.uk/restaurants/london/foo-drinks"),
    ).toBe(false);
    expect(isHarvestableOperatorUrl("https://www.nicholsonspubs.co.uk/")).toBe(false);
  });

  it("caps Tavily extract spend per harvest run", () => {
    expect(tavilyHarvestExtractCap({})).toBe(TAVILY_HARVEST_DEFAULT_EXTRACT_CAP);
    expect(tavilyHarvestExtractCap({ PUBMAX_PAID_SPEND_BUDGET_TAVILY: "50" })).toBe(50);
  });
});
