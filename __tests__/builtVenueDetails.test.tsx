// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { CityId } from "@/lib/cities";
import type { Venue } from "@/lib/venues";
import type { VenueDetailLookupResult } from "@/lib/warmVenueDetail";

const read = vi.hoisted(() => vi.fn());
vi.mock("@/lib/warmVenueDetail", () => ({ warmVenueDetail: read }));

import { useBuiltVenueDetails } from "@/components/map/pubmap/useBuiltVenueDetails";

const acton = { id: "venue-1u82rds", name: "The Queens Head" } as Venue;
const theobalds = { id: "venue-b85at0", name: "The Queens Head" } as Venue;
const friend = { id: "venue-yl1a48", name: "Friend At Hand" } as Venue;
const resident = { id: "venue-core", name: "Central Pub" } as Venue;
const initialVenues = new Map([[resident.id, resident]]);
const onResolved = vi.fn();
let container: HTMLDivElement;
let root: Root;

function Harness(props: { builtIds: string[]; cityId: CityId }) {
  useBuiltVenueDetails({ ...props, venueById: initialVenues, onResolved });
  return null;
}

beforeEach(() => {
  vi.resetAllMocks();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(builtIds: string[], cityId: CityId = "london") {
  await act(async () => root.render(createElement(Harness, { builtIds, cityId })));
}

it("loads the three shared stops outside the resident map cells", async () => {
  const venues = new Map([acton, theobalds, friend].map((venue) => [venue.id, venue]));
  read.mockImplementation(async (id: string) => ({ status: "found", venue: venues.get(id) }));

  await render([acton.id, theobalds.id, friend.id, resident.id]);

  expect(read.mock.calls.map(([id]) => id)).toEqual([acton.id, theobalds.id, friend.id]);
  expect(onResolved).toHaveBeenCalledExactlyOnceWith(venues);
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
});
