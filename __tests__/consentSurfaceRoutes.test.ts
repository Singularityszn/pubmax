import { describe, expect, it } from "vitest";

import { routeCarriesConsentControl } from "@/lib/consentSurfaceRoutes";

describe("routeCarriesConsentControl", () => {
  it("claims the profile family, where the account settings block lives", () => {
    // /u/you is the sentinel every signed-out and signed-in reader lands on,
    // and the owner's own handle route mounts the same block.
    expect(routeCarriesConsentControl("/u/you")).toBe(true);
    expect(routeCarriesConsentControl("/u/karan")).toBe(true);
    expect(routeCarriesConsentControl("/u/you#analytics-settings")).toBe(true);
    expect(routeCarriesConsentControl("/u/you/")).toBe(true);
    expect(routeCarriesConsentControl("/u")).toBe(true);
  });

  it("leaves every other route to the arrival bar", () => {
    for (const path of ["/", "/tonight", "/today", "/map", "/plan", "/out", "/privacy"]) {
      expect(routeCarriesConsentControl(path)).toBe(false);
    }
  });

  it("does not claim a route that merely starts with the same letters", () => {
    expect(routeCarriesConsentControl("/users")).toBe(false);
    expect(routeCarriesConsentControl("/uk")).toBe(false);
  });

  it("answers false for a pathname it cannot read", () => {
    // The arrival bar staying is what every other route already does, so an
    // unreadable pathname may never be the thing that takes the ask away.
    expect(routeCarriesConsentControl(null)).toBe(false);
    expect(routeCarriesConsentControl(undefined)).toBe(false);
    expect(routeCarriesConsentControl("")).toBe(false);
  });
});

// The arrival bar reads this rule on a real route change, and spends no prompt
// budget where it does not paint: __tests__/analyticsConsentRouteRefresh.test.tsx.
