// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import VenueFeatureFilters, { activeVenueFeatureCount } from "@/components/map/VenueFeatureFilters";
import { initialFilters } from "@/lib/venues";

describe("the map's shared pub feature controls", () => {
  it("shows fixtures with a screening caveat only while live sport is selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [
      { id: "sport-fixture-of-one", title: "Arsenal v Chelsea", startsAt: "2026-11-20T20:00:00Z" },
      { id: "sport-fixture-of-two", title: "Arsenal v Chelsea", startsAt: "2026-11-20T20:00:00Z" },
      { id: "sport-fixture-fd-one", title: "Fulham v Brentford", startsAt: "2026-11-20T20:00:00Z" },
      { id: "sport-fixture-tsdb-one", title: "Harlequins v Bath", startsAt: "2026-11-20T20:00:00Z" },
    ] }) });
    vi.stubGlobal("fetch", fetchMock);
    const host = document.createElement("div");
    const root = createRoot(host);
    const filters = { ...initialFilters, requireLiveSports: true };
    await act(async () => { root.render(createElement(VenueFeatureFilters, { filters, onChange: vi.fn(), resultCount: 2 })); });
    expect(host.textContent).toContain("Arsenal v Chelsea");
    expect(host.textContent).toContain("Check with the pub that your match is on");
    expect(host.querySelectorAll("li")).toHaveLength(2);
    expect(host.textContent).toContain("Fulham v Brentford");
    expect(host.textContent).not.toContain("Harlequins v Bath");
    const fixtureLinks = [...host.querySelectorAll("li a")];
    expect(fixtureLinks.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["OpenFootball", "https://github.com/openfootball/football.json"],
      ["football-data.org", "https://www.football-data.org/"],
    ]);
    act(() => root.render(createElement(VenueFeatureFilters, { filters: initialFilters, onChange: vi.fn(), resultCount: 2 })));
    expect(host.textContent).not.toContain("Arsenal v Chelsea");
    act(() => root.unmount());
    vi.unstubAllGlobals();
  });
  it("shows football-data fixtures when no OpenFootball fixture is available", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [
      { id: "sport-fixture-fd-one", title: "Fulham v Brentford", startsAt: "2026-11-20T20:00:00Z" },
    ] }) }));
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => { root.render(createElement(VenueFeatureFilters, { filters: { ...initialFilters, requireLiveSports: true }, onChange: vi.fn(), resultCount: 1 })); });
      expect(host.querySelector("li")?.textContent).toContain("Fulham v Brentford");
      expect(host.querySelector("li a")?.textContent).toBe("football-data.org");
      expect(host.textContent).not.toContain("OpenFootball");
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });
  it("sets outdoor seating without changing the query or garden choice, and names its source", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const onChange = vi.fn();
    const filters = { ...initialFilters, query: "Camden", requireBeerGarden: true };
    act(() => root.render(createElement(VenueFeatureFilters, { filters, onChange, resultCount: 8 })));
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Outdoor seating");
    expect(button?.getAttribute("aria-pressed")).toBe("false");
    act(() => button?.click());
    expect(onChange).toHaveBeenCalledWith({ ...filters, requireOutdoorSeating: true });
    expect(host.textContent).toContain("OpenStreetMap and Google Places");
    expect(host.textContent).toContain("Live sport: OpenStreetMap.");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("8 matching places loaded on the map.");
    act(() => root.unmount());
  });
  it("clears all feature choices together and leaves other filters alone", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const onChange = vi.fn();
    const filters = { ...initialFilters, query: "Camden", maxPrice: 5, requireLiveSports: true, requireDogFriendly: true, requireDarts: true, requirePool: true, requireBeerGarden: true, requireOutdoorSeating: true, openNow: true };
    act(() => root.render(createElement(VenueFeatureFilters, { filters, onChange, resultCount: 0 })));
    expect(activeVenueFeatureCount(filters)).toBe(7);
    expect(host.textContent).toContain("Views and fireplaces: no sourced filter coverage yet.");
    expect(host.textContent).toContain("Pubs without hours stay visible");
    expect(host.querySelector('[role="status"]')?.textContent).toBe("0 matching places loaded on the map.");
    const button = [...host.querySelectorAll("button")].find((item) => item.textContent === "Clear features");
    act(() => button?.click());
    expect(onChange).toHaveBeenCalledWith({ ...filters, requireBeerGarden: false, requireOutdoorSeating: false, requireLiveSports: false, requireDogFriendly: false, requireDarts: false, requirePool: false, openNow: false });
    act(() => root.unmount());
  });
  it("claims no count, zero or loading, after a failed read, and still waits on a pending one", () => {
    const host = document.createElement("div");
    const root = createRoot(host);
    const filters = { ...initialFilters, requireDogFriendly: true, lastOrders: true };
    act(() => root.render(createElement(VenueFeatureFilters, { filters, onChange: vi.fn(), resultCount: 0, lastOrdersFailed: true })));
    expect(host.querySelector('[role="alert"]')).not.toBeNull();
    expect(host.querySelector('[role="status"]')).toBeNull();
    act(() => root.render(createElement(VenueFeatureFilters, { filters, onChange: vi.fn(), resultCount: 0, venueDataFailed: true })));
    expect(host.querySelector('[role="status"]')).toBeNull();
    act(() => root.render(createElement(VenueFeatureFilters, { filters, onChange: vi.fn(), resultCount: null })));
    expect(host.querySelector('[role="status"]')?.textContent).toBe("Loading matching places…");
    act(() => root.unmount());
  });
});
