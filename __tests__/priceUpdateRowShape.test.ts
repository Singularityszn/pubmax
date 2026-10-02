import { describe, expect, it } from "vitest";

import {
  isFiniteNumber,
  isNonBlankString,
  isNonEmptyString,
  isValidObservedAt,
} from "@/lib/priceUpdateRowShape";

const NOW = Date.parse("2026-10-02T12:00:00.000Z");

describe("priceUpdateRowShape", () => {
  it("treats a whitespace-only string as non-empty and a non-string as empty", () => {
    expect(isNonEmptyString("a")).toBe(true);
    expect(isNonEmptyString("  ")).toBe(true);
    expect(isNonEmptyString("")).toBe(false);
    expect(isNonEmptyString(null)).toBe(false);
    expect(isNonEmptyString(1)).toBe(false);
  });

  it("treats a whitespace-only string as blank", () => {
    expect(isNonBlankString("a")).toBe(true);
    expect(isNonBlankString(" a ")).toBe(true);
    expect(isNonBlankString("  ")).toBe(false);
    expect(isNonBlankString("")).toBe(false);
    expect(isNonBlankString(null)).toBe(false);
  });

  it("accepts only finite numbers", () => {
    expect(isFiniteNumber(0)).toBe(true);
    expect(isFiniteNumber(4.2)).toBe(true);
    expect(isFiniteNumber(Number.NaN)).toBe(false);
    expect(isFiniteNumber(Number.POSITIVE_INFINITY)).toBe(false);
    expect(isFiniteNumber("4.2")).toBe(false);
    expect(isFiniteNumber(null)).toBe(false);
  });

  it("accepts an ISO timestamp at or before now", () => {
    expect(isValidObservedAt("2026-10-02T12:00:00.000Z", NOW)).toBe(true);
    expect(isValidObservedAt("2026-10-01T00:00:00.000Z", NOW)).toBe(true);
    expect(isValidObservedAt("2026-10-02T12:00:00.001Z", NOW)).toBe(false);
    expect(isValidObservedAt("", NOW)).toBe(false);
    expect(isValidObservedAt("  ", NOW)).toBe(false);
    expect(isValidObservedAt("not-a-date", NOW)).toBe(false);
    expect(isValidObservedAt(NOW, NOW)).toBe(false);
  });
});
