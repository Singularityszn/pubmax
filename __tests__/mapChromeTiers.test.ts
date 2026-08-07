import { describe, expect, it } from "vitest";

import { buildFiltersChip, buildNearMeChip, buildTflCorner } from "@/lib/mapChromeTiers";

describe("buildNearMeChip", () => {
  it("labels every status honestly", () => {
    expect(buildNearMeChip("idle", 0).label).toBe("Near me");
    expect(buildNearMeChip("requesting", 0)).toMatchObject({ label: "Locating", disabled: true });
    expect(buildNearMeChip("ready", 7)).toMatchObject({ label: "Nearby 7", pressed: true });
    expect(buildNearMeChip("error", 0).label).toBe("Try near me");
  });
});

describe("buildFiltersChip", () => {
  it("counts active refinement groups, not individual filters", () => {
    expect(buildFiltersChip({ drinkFiltersActive: false, priceCapActive: false, priceLabel: "Price" }).refinements).toBe(0);
    expect(buildFiltersChip({ drinkFiltersActive: true, priceCapActive: false, priceLabel: "Price" }).refinements).toBe(1);
    expect(buildFiltersChip({ drinkFiltersActive: true, priceCapActive: true, priceLabel: "≤£8.00" }).refinements).toBe(2);
  });

  it("speaks the active refinements to screen readers", () => {
    expect(buildFiltersChip({ drinkFiltersActive: false, priceCapActive: false, priceLabel: "Price" }).ariaLabel).toBe("Filters");
    expect(
      buildFiltersChip({ drinkFiltersActive: true, priceCapActive: true, priceLabel: "≤£8.00" }).ariaLabel,
    ).toBe("Filters: drinks and ≤£8.00 active");
    expect(
      buildFiltersChip({
        drinkFiltersActive: false,
        priceCapActive: false,
        priceLabel: "Price",
        experienceLabel: "no-alcohol view",
      }).ariaLabel,
    ).toBe("Filters: no-alcohol view active");
  });

  it("counts Saved only as a filters refinement when on", () => {
    expect(
      buildFiltersChip({
        drinkFiltersActive: false,
        priceCapActive: false,
        priceLabel: "Price",
        savedOnlyActive: true,
      }),
    ).toMatchObject({
      refinements: 1,
      ariaLabel: "Filters: saved only active",
    });
  });

  it("counts Open now as a filters refinement when on", () => {
    expect(
      buildFiltersChip({
        drinkFiltersActive: false,
        priceCapActive: false,
        priceLabel: "Price",
        openNowActive: true,
      }),
    ).toMatchObject({
      refinements: 1,
      ariaLabel: "Filters: open now active",
    });
  });

  it("counts Saved only and Open now together as separate refinements", () => {
    expect(
      buildFiltersChip({
        drinkFiltersActive: false,
        priceCapActive: false,
        priceLabel: "Price",
        savedOnlyActive: true,
        openNowActive: true,
      }),
    ).toMatchObject({
      refinements: 2,
      ariaLabel: "Filters: saved only and open now active",
    });
  });
});

describe("buildTflCorner", () => {
  it("keeps the compact status vocabulary from the old chip", () => {
    expect(buildTflCorner("clear", 0)).toMatchObject({ statusSuffix: "OK", badge: null });
    expect(buildTflCorner("unavailable", 0).statusSuffix).toBe("?");
    expect(buildTflCorner("issues", 15)).toMatchObject({ statusSuffix: null, badge: 15 });
    expect(buildTflCorner("checking", 0)).toMatchObject({ statusSuffix: null, badge: null });
  });

  it("aria labels carry the status meaning", () => {
    expect(buildTflCorner("issues", 15).ariaLabel).toBe("TfL live: 15 updates");
    expect(buildTflCorner("clear", 3).ariaLabel).toBe("TfL live: lines running well");
  });
});
