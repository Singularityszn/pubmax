import { describe, expect, it } from "vitest";

import { hasMapLogIntent, resolveMapLogIntent, shouldRunMapLogIntent } from "@/lib/mapLogIntent";

describe("resolveMapLogIntent", () => {
  it("does nothing when the URL has no log intent", () => {
    expect(
      resolveMapLogIntent({
        hasLogIntent: false,
        loaded: true,
        selectedVenueId: "selected",
        selectedVenueResolvable: true,
        firstRouteId: "route",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "inactive" });
  });

  it("waits for the map venue list before resolving log intent", () => {
    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: false,
        selectedVenueId: "",
        selectedVenueResolvable: false,
        firstRouteId: "",
        firstFilteredVenueId: "",
      }),
    ).toEqual({ status: "pending" });
  });

  it("preserves selected, route, then first-visible venue priority", () => {
    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "selected",
        selectedVenueResolvable: true,
        firstRouteId: "route",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "open", venueId: "selected" });

    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "",
        selectedVenueResolvable: false,
        firstRouteId: "route",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "open", venueId: "route" });

    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "",
        selectedVenueResolvable: false,
        firstRouteId: "",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "open", venueId: "visible" });
  });

  it("asks for a pub selection when log intent cannot resolve a venue", () => {
    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "",
        selectedVenueResolvable: false,
        firstRouteId: "",
        firstFilteredVenueId: "",
      }),
    ).toEqual({ status: "fallback" });
  });

  it("falls back from an unresolved selected venue to route then visible venues", () => {
    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "bad-id",
        selectedVenueResolvable: false,
        firstRouteId: "route",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "open", venueId: "route" });

    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "bad-id",
        selectedVenueResolvable: false,
        firstRouteId: "",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "open", venueId: "visible" });
  });

  it("shows fallback instead of handling an unresolved selected venue with no fallback venue", () => {
    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "bad-id",
        selectedVenueResolvable: false,
        firstRouteId: "",
        firstFilteredVenueId: "",
      }),
    ).toEqual({ status: "fallback" });
  });
});

describe("hasMapLogIntent", () => {
  it("parses reactive query strings without matching lookalike params", () => {
    expect(hasMapLogIntent("?log=1")).toBe(true);
    expect(hasMapLogIntent("sel=pub-1&log=1")).toBe(true);
    expect(hasMapLogIntent("?catalog=1")).toBe(false);
    expect(hasMapLogIntent("?log=0")).toBe(false);
  });
});

describe("shouldRunMapLogIntent", () => {
  it("runs only while log intent is active and unhandled", () => {
    expect(shouldRunMapLogIntent({ hasLogIntent: true, handled: false })).toBe(true);
    expect(shouldRunMapLogIntent({ hasLogIntent: true, handled: true })).toBe(false);
    expect(shouldRunMapLogIntent({ hasLogIntent: false, handled: false })).toBe(false);
  });
});
