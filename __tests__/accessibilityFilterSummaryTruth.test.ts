import { describe, expect, it } from "vitest";

import {
  accessibilityFilterSummary,
  EMPTY_ACCESSIBILITY_FILTERS,
  matchesAccessibilityFilters,
  type AccessibilityFilters,
} from "@/lib/venueAccessibility";
import type { Venue } from "@/lib/venues";

const activeCases = [
  ["step-free entry", { ...EMPTY_ACCESSIBILITY_FILTERS, stepFree: true }],
  ["accessible toilet", { ...EMPTY_ACCESSIBILITY_FILTERS, accessibleToilet: true }],
  ["seated service", { ...EMPTY_ACCESSIBILITY_FILTERS, seatedService: true }],
  ["step-free entry and accessible toilet", { stepFree: true, accessibleToilet: true, seatedService: false }],
  ["step-free entry and seated service", { stepFree: true, accessibleToilet: false, seatedService: true }],
  ["accessible toilet and seated service", { stepFree: false, accessibleToilet: true, seatedService: true }],
  ["step-free entry, accessible toilet and seated service", { stepFree: true, accessibleToilet: true, seatedService: true }],
] satisfies Array<[string, AccessibilityFilters]>;

describe.each([0, 3])("accessibility summary with %i confirmed pubs", (count) => {
  it.each(activeCases)("keeps unknown pubs distinct from confirmed absence for %s", (phrase, filters) => {
    const summary = accessibilityFilterSummary(filters, count);

    expect(summary).toContain(`Only showing pubs with confirmed ${phrase}.`);
    expect(summary).toContain(`${count} confirmed so far`);
    expect(summary).toContain("Other pubs may match; we haven't checked them all.");
  });
});

describe("accessibility summary does not relax confirmed-fact filters", () => {
  it.each(["stepFree", "accessibleToilet", "seatedService"] as const)(
    "%s keeps unknown and documented absence out of a positive filter",
    (facet) => {
      const filters = { ...EMPTY_ACCESSIBILITY_FILTERS, [facet]: true };
      const confirmed = { accessibility: { [facet]: true } } as Venue;
      const absent = { accessibility: { [facet]: false } } as Venue;
      const unknown = {} as Venue;

      expect(matchesAccessibilityFilters(confirmed, filters)).toBe(true);
      expect(matchesAccessibilityFilters(absent, filters)).toBe(false);
      expect(matchesAccessibilityFilters(unknown, filters)).toBe(false);
    },
  );

  it("keeps an unfiltered list silent", () => {
    expect(accessibilityFilterSummary(EMPTY_ACCESSIBILITY_FILTERS, 3)).toBeNull();
  });
});
