import { describe, expect, it } from "vitest";

import {
  hasDedicatedOnboarding,
  isTourEligiblePathname,
  shouldShowFirstRunTour,
} from "@/lib/firstRunTour";

describe("isTourEligiblePathname", () => {
  it("is eligible on /map and any /map/[city] surface", () => {
    expect(isTourEligiblePathname("/map")).toBe(true);
    expect(isTourEligiblePathname("/map/london")).toBe(true);
    expect(isTourEligiblePathname("/map/new-york")).toBe(true);
  });

  it("is not eligible on landing, tonight, feed, pint-index, or other content pages", () => {
    expect(isTourEligiblePathname("/")).toBe(false);
    expect(isTourEligiblePathname("/tonight")).toBe(false);
    expect(isTourEligiblePathname("/feed")).toBe(false);
    expect(isTourEligiblePathname("/pint-index")).toBe(false);
    expect(isTourEligiblePathname("/discover")).toBe(false);
    expect(isTourEligiblePathname("/mapping")).toBe(false);
  });
});

describe("hasDedicatedOnboarding", () => {
  it("flags Pub Pal and profile surfaces", () => {
    expect(hasDedicatedOnboarding("/pal")).toBe(true);
    expect(hasDedicatedOnboarding("/u/somehandle")).toBe(true);
  });

  it("does not flag map or other surfaces", () => {
    expect(hasDedicatedOnboarding("/map")).toBe(false);
    expect(hasDedicatedOnboarding("/")).toBe(false);
  });
});

describe("shouldShowFirstRunTour", () => {
  const base = { mounted: true, seen: false, pathname: "/map" };

  it("shows once mounted, unseen, and on a map surface", () => {
    expect(shouldShowFirstRunTour(base)).toBe(true);
    expect(shouldShowFirstRunTour({ ...base, pathname: "/map/london" })).toBe(true);
  });

  it("never shows before mount (SSR-safe gate)", () => {
    expect(shouldShowFirstRunTour({ ...base, mounted: false })).toBe(false);
  });

  it("never shows once seen (at most once per device)", () => {
    expect(shouldShowFirstRunTour({ ...base, seen: true })).toBe(false);
  });

  it("never shows off the map surfaces — landing, tonight, feed, pint-index", () => {
    expect(shouldShowFirstRunTour({ ...base, pathname: "/" })).toBe(false);
    expect(shouldShowFirstRunTour({ ...base, pathname: "/tonight" })).toBe(false);
    expect(shouldShowFirstRunTour({ ...base, pathname: "/feed" })).toBe(false);
    expect(shouldShowFirstRunTour({ ...base, pathname: "/pint-index" })).toBe(false);
  });

  it("never shows over Pub Pal or You's dedicated onboarding, even on their own routes", () => {
    expect(shouldShowFirstRunTour({ ...base, pathname: "/pal" })).toBe(false);
    expect(shouldShowFirstRunTour({ ...base, pathname: "/u/somehandle" })).toBe(false);
  });
});
