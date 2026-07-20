import { describe, expect, it } from "vitest";

// Pure gate logic for the native-shell first-run redirect to onboarding
// (lib/nativeFirstRun.ts). Must never route on the web, must never route
// twice, and must never override a viewer who already has a preferred-city
// choice persisted (has state).
import { shouldRouteNativeFirstRun } from "@/lib/nativeFirstRun";

describe("shouldRouteNativeFirstRun", () => {
  it("never routes on the web", () => {
    expect(
      shouldRouteNativeFirstRun({
        isNative: false,
        alreadyRouted: false,
        hasCityPreference: false,
      }),
    ).toBe(false);
  });

  it("routes on a genuine first native launch with no city preference", () => {
    expect(
      shouldRouteNativeFirstRun({
        isNative: true,
        alreadyRouted: false,
        hasCityPreference: false,
      }),
    ).toBe(true);
  });

  it("does not route again once it has already fired", () => {
    expect(
      shouldRouteNativeFirstRun({
        isNative: true,
        alreadyRouted: true,
        hasCityPreference: false,
      }),
    ).toBe(false);
  });

  it("does not route when the viewer already has a preferred city (has state)", () => {
    expect(
      shouldRouteNativeFirstRun({
        isNative: true,
        alreadyRouted: false,
        hasCityPreference: true,
      }),
    ).toBe(false);
  });

  it("does not route when both already-routed and city-preference state exist", () => {
    expect(
      shouldRouteNativeFirstRun({
        isNative: true,
        alreadyRouted: true,
        hasCityPreference: true,
      }),
    ).toBe(false);
  });
});
