// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VenueFeatureFilters, { activeVenueFeatureCount } from "@/components/map/VenueFeatureFilters";
import { initialFilters } from "@/lib/venues";
import type { WhatsOnRow } from "@/lib/whatsOn";

function fixtureRow(row: Pick<WhatsOnRow, "id" | "title" | "startsAt"> & Partial<WhatsOnRow>): WhatsOnRow {
  return { kind: "sport", placeName: "Test pub", source: { label: "OpenFootball", url: "https://github.com/openfootball/football.json" }, observedAt: "2026-11-20T10:00:00Z", confidence: "derived", sourceId: row.id, ...row };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-20T20:00:00Z"));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("the map's shared pub feature controls", () => {
  it("shows fixtures with a screening caveat only while live sport is selected", async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [
      { id: "sport-fixture-of-one", title: "Arsenal v Chelsea", startsAt: "2026-11-20T20:00:00Z" },
      { id: "sport-fixture-of-two", title: "Arsenal v Chelsea", startsAt: "2026-11-20T20:00:00Z" },
      { id: "sport-fixture-fd-one", title: "Fulham v Brentford", startsAt: "2026-11-20T20:00:00Z" },
      { id: "sport-fixture-tsdb-one", title: "Harlequins v Bath", startsAt: "2026-11-20T20:00:00Z" },
    ].map(fixtureRow) }) });
    vi.stubGlobal("fetch", fetchMock);
    const host = document.createElement("div");
    const root = createRoot(host);
    const filters = { ...initialFilters, requireLiveSports: true };
    await act(async () => { root.render(createElement(VenueFeatureFilters, { filters, onChange: vi.fn(), resultCount: 2 })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(host.textContent).toContain("Arsenal v Chelsea");
    expect(host.textContent).toContain("Check with the pub that your match is on");
    expect(host.querySelectorAll("li")).toHaveLength(2);
    expect(host.textContent).toContain("Fulham v Brentford");
    expect(host.textContent).not.toContain("Harlequins v Bath");
    expect(host.textContent).not.toContain("TheSportsDB");
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
  it.each([
    { id: "sport-fixture-fd-one", title: "Fulham v Brentford", label: "football-data.org", url: "https://www.football-data.org/" },
  ])("shows $label fixtures when no OpenFootball fixture is available", async ({ id, title, label, url }) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [
      { id, title, startsAt: "2026-11-20T20:00:00Z" },
    ].map(fixtureRow) }) }));
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => { root.render(createElement(VenueFeatureFilters, { filters: { ...initialFilters, requireLiveSports: true }, onChange: vi.fn(), resultCount: 1 })); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(host.querySelector("li")?.textContent).toContain(title);
      expect(host.querySelector("li a")?.textContent).toBe(label);
      expect(host.querySelector("li a")?.getAttribute("href")).toBe(url);
      expect(host.textContent).not.toContain("OpenFootball");
    } finally {
      act(() => root.unmount());
      vi.unstubAllGlobals();
    }
  });
  it.each([
    { cause: "match expiry on a tick", id: "sport-fixture-of-one", before: "2026-11-20T22:29:00Z", after: "2026-11-20T22:31:00Z", startsAt: "2026-11-20T20:00:00Z", event: null },
    { cause: "match expiry on focus", id: "sport-fixture-fd-one", before: "2026-11-20T22:29:00Z", after: "2026-11-20T22:31:00Z", startsAt: "2026-11-20T20:00:00Z", event: "focus" },
    { cause: "source expiry on visibility", id: "sport-fixture-of-one", before: "2026-11-20T23:59:00Z", after: "2026-11-21T00:01:00Z", startsAt: "2026-11-21T01:00:00Z", observedAt: "2026-11-18T23:59:00Z", event: "visibilitychange" },
    { cause: "service-day rollover on restore", id: "sport-fixture-fd-one", before: "2026-11-21T03:59:00Z", after: "2026-11-21T04:01:00Z", startsAt: "2026-11-21T03:00:00Z", endsAt: "2026-11-21T08:00:00Z", event: "pageshow" },
  ])("removes fixtures after $cause without another fetch", async ({ id, before, after, startsAt, observedAt, endsAt, event }) => {
    vi.setSystemTime(new Date(before));
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows: [fixtureRow({ id, title: "Arsenal v Chelsea", startsAt, endsAt, ...(observedAt ? { observedAt } : {}) })] }) });
    vi.stubGlobal("fetch", fetchMock);
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => { root.render(createElement(VenueFeatureFilters, { filters: { ...initialFilters, requireLiveSports: true }, onChange: vi.fn(), resultCount: 1 })); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(host.textContent).toContain("Arsenal v Chelsea");
      await act(async () => {
        if (event) {
          vi.setSystemTime(new Date(after));
          (event === "visibilitychange" ? document : window).dispatchEvent(new Event(event));
        } else {
          await vi.advanceTimersByTimeAsync(Date.parse(after) - Date.parse(before));
        }
      });
      expect(host.textContent).not.toContain("Arsenal v Chelsea");
      expect(host.textContent).not.toContain("Fixtures tonight");
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally {
      act(() => root.unmount());
      vi.restoreAllMocks();
    }
  });
  it("reveals a later fixture when the first three expire", async () => {
    vi.setSystemTime(new Date("2026-11-20T22:29:00Z"));
    const rows = ["Arsenal v Chelsea", "Fulham v Brentford", "Liverpool v Everton", "Leeds v Burnley"].map((title, index) => fixtureRow({ id: `sport-fixture-fd-${index}`, title, startsAt: `2026-11-20T${index === 3 ? "22" : "20"}:00:00Z` }));
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({ rows }) }));
    const host = document.createElement("div");
    const root = createRoot(host);
    try {
      await act(async () => { root.render(createElement(VenueFeatureFilters, { filters: { ...initialFilters, requireLiveSports: true }, onChange: vi.fn(), resultCount: 1 })); });
      await act(async () => { await vi.advanceTimersByTimeAsync(0); });
      expect(host.querySelectorAll("li")).toHaveLength(3);
      expect(host.textContent).not.toContain("Leeds v Burnley");
      await act(async () => { await vi.advanceTimersByTimeAsync(120_000); });
      expect(host.querySelectorAll("li")).toHaveLength(1);
      expect(host.textContent).toContain("Leeds v Burnley");
    } finally {
      act(() => root.unmount());
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
