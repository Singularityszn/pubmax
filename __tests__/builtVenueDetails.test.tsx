// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CityId } from "@/lib/cities";
import type { Venue } from "@/lib/venues";
import type { VenueDetailLookupResult } from "@/lib/warmVenueDetail";
import { slimVenueToPin } from "@/lib/slimPins";
import {
  CRAWL_CELEBRATION_KEY,
  CRAWL_PROGRESS_KEY,
  CRAWL_QUEST_KEY,
  hasCelebrationBeenShown,
  markCrawlComplete,
  startCrawl,
} from "@/lib/crawlCompletion";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/warmVenueDetail", () => ({ warmVenueDetail: read }));
vi.mock("@/components/map/route/RouteActions", () => ({ default: () => null }));
vi.mock("@/components/crawl/SaveCrawlStory", () => ({ default: () => null }));

import { hasUnresolvedBuiltStops, useBuiltVenueDetails } from "@/components/map/pubmap/useBuiltVenueDetails";
import RoutePanel from "@/components/map/RoutePanel";

const acton = { id: "venue-1u82rds", name: "The Queens Head" } as Venue;
const theobalds = { id: "venue-b85at0", name: "The Queens Head" } as Venue;
const friend = { id: "venue-yl1a48", name: "Friend At Hand" } as Venue;
const resident = { id: "venue-core", name: "Central Pub" } as Venue;
const initialVenues = new Map([[resident.id, resident]]);
const onResolved = vi.fn();
let container: HTMLDivElement;
let root: Root;

function Harness(props: { builtIds: string[]; cityId: CityId; venueById: ReadonlyMap<string, Venue> }) {
  const state = useBuiltVenueDetails({ ...props, onResolved });
  return createElement("div", null,
    createElement("output", null, JSON.stringify(state)),
    createElement("button", { onClick: state.retry }, "Retry"),
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  for (const key of [CRAWL_CELEBRATION_KEY, CRAWL_PROGRESS_KEY, CRAWL_QUEST_KEY]) localStorage.removeItem(key);
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(builtIds: string[], cityId: CityId = "london", venueById = initialVenues) {
  await act(async () => root.render(createElement(Harness, { builtIds, cityId, venueById })));
}

function readState() {
  return JSON.parse(container.querySelector("output")!.textContent!);
}

it("blocks only incomplete built routes, leaving suggested routes available", () => {
  const pending = { loadingCount: 1, failedCount: 0, missingCount: 0, retry: vi.fn() };
  expect(hasUnresolvedBuiltStops("build", pending)).toBe(true);
  expect(hasUnresolvedBuiltStops("suggest", pending)).toBe(false);
  expect(hasUnresolvedBuiltStops("build", { ...pending, loadingCount: 0, failedCount: 1 })).toBe(true);
  expect(hasUnresolvedBuiltStops("build", { ...pending, loadingCount: 0, missingCount: 1 })).toBe(true);
  expect(hasUnresolvedBuiltStops("build", { ...pending, loadingCount: 0 })).toBe(false);
  expect(hasUnresolvedBuiltStops("build")).toBe(false);
});

it("loads the three shared stops outside the resident map cells", async () => {
  const venues = new Map([acton, theobalds, friend].map((venue) => [venue.id, venue]));
  read.mockImplementation(async (id: string) => ({ status: "found", venue: venues.get(id) }));

  await render([acton.id, theobalds.id, friend.id, resident.id]);

  expect(read.mock.calls.map(([id]) => id)).toEqual([acton.id, theobalds.id, friend.id]);
  expect(onResolved.mock.calls.map(([found]) => [...found])).toEqual(
    [acton, theobalds, friend].map((venue) => [[venue.id, venue]]),
  );
  expect(readState()).toEqual({ loadingCount: 0, failedCount: 0, missingCount: 0 });
});

it("keeps the requested id beside a canonical result for route reconciliation", async () => {
  read.mockResolvedValue({ status: "found", venue: acton });
  await render(["venue-oldid", "venue-oldid"]);
  expect(read).toHaveBeenCalledOnce();
  expect(onResolved).toHaveBeenCalledExactlyOnceWith(new Map([["venue-oldid", acton]]));
});

it("does not commit a completed read after the plan is cleared", async () => {
  let finish!: (result: VenueDetailLookupResult) => void;
  read.mockReturnValue(new Promise<VenueDetailLookupResult>((resolve) => { finish = resolve; }));
  await render([acton.id]);
  await render([]);
  await act(async () => finish({ status: "found", venue: acton }));
  expect(onResolved).not.toHaveBeenCalled();
});

it("does not commit a previous city's read after changing city", async () => {
  let finish!: (result: VenueDetailLookupResult) => void;
  read.mockReturnValue(new Promise<VenueDetailLookupResult>((resolve) => { finish = resolve; }));
  await render([acton.id]);
  await render([acton.id], "manchester");
  await act(async () => finish({ status: "found", venue: acton }));
  expect(read).toHaveBeenCalledOnce();
  expect(onResolved).not.toHaveBeenCalled();
});

it("leaves failed, missing, and non-pub stops unresolved", async () => {
  read.mockResolvedValueOnce({ status: "failed" });
  read.mockResolvedValueOnce({ status: "missing" });
  read.mockResolvedValueOnce({ status: "found", venue: { ...friend, kind: "bar" } });
  await render([acton.id, theobalds.id, friend.id, "venue-mcr-123", "venue-uk-n123"]);
  expect(read).toHaveBeenCalledTimes(3);
  expect(onResolved).not.toHaveBeenCalled();
  expect(readState()).toEqual({ loadingCount: 0, failedCount: 1, missingCount: 4 });
});

it("keeps resident non-pub and absent out-of-city stops unavailable without fetching them", async () => {
  const bar = { ...friend, kind: "bar" as const };
  const venues = new Map([acton, theobalds, bar].map((venue) => [venue.id, venue]));
  await render([acton.id, theobalds.id, bar.id, "venue-mcr-123", "venue-uk-n123"], "london", venues);
  expect(read).not.toHaveBeenCalled();
  expect(readState()).toEqual({ loadingCount: 0, failedCount: 0, missingCount: 3 });
  expect(hasUnresolvedBuiltStops("build", readState())).toBe(true);
});

it("shows each successful stop while another read remains pending", async () => {
  let finish!: (result: VenueDetailLookupResult) => void;
  const pending = new Promise<VenueDetailLookupResult>((resolve) => { finish = resolve; });
  read.mockImplementation((id: string) => id === acton.id
    ? pending
    : Promise.resolve({ status: "found", venue: friend }));
  await render([acton.id, friend.id]);
  expect(onResolved).toHaveBeenCalledExactlyOnceWith(new Map([[friend.id, friend]]));
  expect(readState()).toEqual({ loadingCount: 1, failedCount: 0, missingCount: 0 });
  await act(async () => finish({ status: "failed" }));
  expect(readState()).toEqual({ loadingCount: 0, failedCount: 1, missingCount: 0 });
});

it("retries failed stops on request and keeps already loaded stops", async () => {
  read.mockResolvedValueOnce({ status: "failed" });
  await render([acton.id, resident.id]);
  await render([acton.id, resident.id], "london", new Map(initialVenues));
  expect(read).toHaveBeenCalledOnce();
  let finish!: (result: VenueDetailLookupResult) => void;
  read.mockReturnValueOnce(new Promise<VenueDetailLookupResult>((resolve) => { finish = resolve; }));
  await act(async () => container.querySelector("button")!.click());
  expect(read.mock.calls.map(([id]) => id)).toEqual([acton.id, acton.id]);
  expect(readState()).toEqual({ loadingCount: 1, failedCount: 0, missingCount: 0 });
  await act(async () => finish({ status: "found", venue: acton }));
  expect(onResolved).toHaveBeenCalledExactlyOnceWith(new Map([[acton.id, acton]]));
  expect(readState()).toEqual({ loadingCount: 0, failedCount: 0, missingCount: 0 });
});

it("clears a failed stop's status when independent map data supplies it", async () => {
  read.mockResolvedValue({ status: "failed" });
  await render([acton.id]);
  expect(readState().failedCount).toBe(1);
  await render([acton.id], "london", new Map([[acton.id, acton]]));
  expect(readState()).toEqual({ loadingCount: 0, failedCount: 0, missingCount: 0 });
  expect(read).toHaveBeenCalledOnce();
});

it("does not retain failure state when the plan or city changes", async () => {
  read.mockResolvedValue({ status: "failed" });
  await render([acton.id]);
  expect(readState().failedCount).toBe(1);
  await render([]);
  expect(readState()).toEqual({ loadingCount: 0, failedCount: 0, missingCount: 0 });
  await render([acton.id], "manchester");
  expect(readState()).toEqual({ loadingCount: 0, failedCount: 0, missingCount: 1 });
});

it("keeps the completion celebration unclaimed until every crawl stop resolves", async () => {
  const route = [acton, theobalds, friend].map(({ id, name }, index) => slimVenueToPin({
    id, name, lat: 51.52 + index * 0.001, lng: -0.12, cheapestPrice: 5, borough: "Camden",
  }));
  const progressKey = "My hand-built crawl";
  startCrawl(progressKey, route.map(({ id }) => id));
  markCrawlComplete(progressKey);
  const props = {
    mode: "build" as const,
    crawlStyle: "balanced" as const,
    altStyle: "pint" as const,
    onAltStyleChange: vi.fn(),
    filteredVenues: [],
    builtIds: route.map(({ id }) => id),
    activeVenueId: undefined,
    venueSignals: new Map(),
    routeMapped: false,
    onMapRoute: vi.fn(),
    onHideRoute: vi.fn(),
    onSelectVenue: vi.fn(),
    onToggleStop: vi.fn(),
    poisPath: null,
  };
  const stopLoad = { loadingCount: 1, failedCount: 0, missingCount: 0, retry: vi.fn() };
  await act(async () => root.render(createElement(RoutePanel, { ...props, route: route.slice(0, 2), stopLoad })));
  expect(container.querySelectorAll(".routeList > li")).toHaveLength(2);
  expect(hasCelebrationBeenShown(progressKey)).toBe(false);
  expect(container.querySelector('[data-testid="crawl-celebration"]')).toBeNull();

  await act(async () => root.render(createElement(RoutePanel, {
    ...props, route, stopLoad: { ...stopLoad, loadingCount: 0 },
  })));
  expect(hasCelebrationBeenShown(progressKey)).toBe(true);
  expect(container.querySelector('[data-testid="crawl-celebration"]')?.textContent).toContain("You walked it");
});
