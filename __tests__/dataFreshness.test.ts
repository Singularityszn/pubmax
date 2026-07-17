import { describe, expect, it } from "vitest";

import {
  formatMonthYear,
  formatObservedDate,
  isoDate,
  PINT_DATASET_OBSERVED_AT,
} from "@/lib/dataFreshness";

// SEO integrity regression: the visible "collected" stamp (en-GB,
// Europe/London) and the JSON-LD ISO date must name the SAME calendar day.
// The raw scrape instant (2026-07-03T23:10:47Z) is already 4 July in London,
// which is exactly the bug this pins against — the constant is anchored at
// noon UTC so no timezone conversion can move the day.
describe("PINT_DATASET_OBSERVED_AT", () => {
  it("renders the same day to users and to JSON-LD", () => {
    expect(formatObservedDate(PINT_DATASET_OBSERVED_AT)).toBe("3 July 2026");
    expect(isoDate(PINT_DATASET_OBSERVED_AT)).toBe("2026-07-03");
  });

  it("keeps the month stamp on the collection month", () => {
    expect(formatMonthYear(PINT_DATASET_OBSERVED_AT)).toBe("July 2026");
  });

  it("is anchored mid-day so London/UTC agree in both BST and GMT", () => {
    expect(PINT_DATASET_OBSERVED_AT.getUTCHours()).toBe(12);
  });
});
