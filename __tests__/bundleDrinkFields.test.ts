import { describe, expect, it } from "vitest";

import {
  bundleDrinkFieldsFromPrintedName,
  normalizeUkPriceBundleDrinkLabel,
  UK_PRICE_BUNDLE_DRINK_LABEL_MAX,
} from "@/lib/bundleDrinkFields";

describe("normalizeUkPriceBundleDrinkLabel", () => {
  it("trims and caps length", () => {
    expect(normalizeUkPriceBundleDrinkLabel("  Diet Coke  ")).toBe("Diet Coke");
    const long = "x".repeat(UK_PRICE_BUNDLE_DRINK_LABEL_MAX + 10);
    expect(normalizeUkPriceBundleDrinkLabel(long)?.length).toBe(UK_PRICE_BUNDLE_DRINK_LABEL_MAX);
  });

  it("returns null for empty input", () => {
    expect(normalizeUkPriceBundleDrinkLabel("")).toBeNull();
    expect(normalizeUkPriceBundleDrinkLabel(null)).toBeNull();
  });
});

describe("bundleDrinkFieldsFromPrintedName", () => {
  it("classifies soft-drink launch names", () => {
    expect(bundleDrinkFieldsFromPrintedName("Pepsi Max", "soft-drink")).toEqual({
      drinkLabel: "Pepsi Max",
      drinkSubtype: "soft-drink-pepsi-max",
    });

    expect(bundleDrinkFieldsFromPrintedName("Coke Zero", "soft-drink")).toEqual({
      drinkLabel: "Coke Zero",
      drinkSubtype: "soft-drink-coke-zero",
    });
    expect(bundleDrinkFieldsFromPrintedName("Still water 500ml", "soft-drink")).toMatchObject({
      drinkSubtype: "soft-drink-still-water",
    });
  });

  it("omits subtype when the label does not classify", () => {
    expect(bundleDrinkFieldsFromPrintedName("House cola", "soft-drink")).toEqual({
      drinkLabel: "House cola",
    });
  });
});
