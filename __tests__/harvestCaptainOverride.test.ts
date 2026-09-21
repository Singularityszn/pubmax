import { describe, expect, it } from "vitest";

import {
  LONDON_DRINK_CAPTAIN_OVERRIDE_CHECKED_ON,
  LONDON_DRINK_CAPTAIN_OVERRIDE_HOSTS,
  hostHasLondonDrinkCaptainOverride,
} from "@/lib/harvest/sourcePolicy";
import {
  TAVILY_HARVEST_DEFAULT_EXTRACT_CAP,
  tavilyHarvestExtractCap,
} from "@/lib/paidSpendBudget";

describe("London drink captain override (2026-09-21)", () => {
  it("re-opens Nicholson's and estate hosts for drink harvest CLIs", () => {
    expect(LONDON_DRINK_CAPTAIN_OVERRIDE_CHECKED_ON).toBe("2026-09-21");
    expect(LONDON_DRINK_CAPTAIN_OVERRIDE_HOSTS).toContain("nicholsonspubs.co.uk");
    expect(hostHasLondonDrinkCaptainOverride("www.nicholsonspubs.co.uk")).toBe(true);
    expect(hostHasLondonDrinkCaptainOverride("www.example.com")).toBe(false);
  });

  it("caps Tavily extract spend per harvest run", () => {
    expect(tavilyHarvestExtractCap({})).toBe(TAVILY_HARVEST_DEFAULT_EXTRACT_CAP);
    expect(tavilyHarvestExtractCap({ PUBMAX_PAID_SPEND_BUDGET_TAVILY: "50" })).toBe(50);
  });
});
