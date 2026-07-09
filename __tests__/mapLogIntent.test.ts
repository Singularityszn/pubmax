import { describe, expect, it } from "vitest";

import {
  buildLogNearbyCandidates,
  hasMapLogIntent,
  resolveMapLogIntent,
  shouldRunMapLogIntent,
} from "@/lib/mapLogIntent";

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

  it("preserves selected venue for auto-open, otherwise shows the nearby picker", () => {
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

    // Wave H2: never auto-pick first route / first filtered venue.
    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "",
        selectedVenueResolvable: false,
        firstRouteId: "route",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "fallback" });

    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "",
        selectedVenueResolvable: false,
        firstRouteId: "",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "fallback" });
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

  it("falls back when the selected venue is unresolved (Wave H2 trust)", () => {
    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "bad-id",
        selectedVenueResolvable: false,
        firstRouteId: "route",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "fallback" });

    expect(
      resolveMapLogIntent({
        hasLogIntent: true,
        loaded: true,
        selectedVenueId: "bad-id",
        selectedVenueResolvable: false,
        firstRouteId: "",
        firstFilteredVenueId: "visible",
      }),
    ).toEqual({ status: "fallback" });
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

describe("buildLogNearbyCandidates", () => {
  it("formats nearby pubs for the log-intent picker", () => {
    expect(
      buildLogNearbyCandidates(
        [
          { id: "a", name: "Alpha Arms", cheapestPrice: 4.5 },
          { id: "b", name: "Beta Bar", cheapestPrice: null },
          { id: "c", name: "Gamma", cheapestPrice: 6 },
          { id: "d", name: "Delta", cheapestPrice: 5 },
          { id: "e", name: "Echo", cheapestPrice: 5.2 },
          { id: "f", name: "Foxtrot", cheapestPrice: 5.5 },
        ],
        5,
      ),
    ).toEqual([
      { id: "a", name: "Alpha Arms", priceLabel: "£4.50" },
      { id: "b", name: "Beta Bar", priceLabel: "Price TBD" },
      { id: "c", name: "Gamma", priceLabel: "£6.00" },
      { id: "d", name: "Delta", priceLabel: "£5.00" },
      { id: "e", name: "Echo", priceLabel: "£5.20" },
    ]);
  });
});
