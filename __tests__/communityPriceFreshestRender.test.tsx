// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { useCommunityPrices } from "@/components/map/useCommunityPrices";
import { usePublicPriceVenues } from "@/components/map/pubmap/usePublicPriceVenues";
import type { CommunityPrice } from "@/lib/communityPrice";
import type { PintDrop } from "@/lib/pintDrops";
import type { PriceUpdate } from "@/lib/priceUpdates";
import { slimVenueToPin } from "@/lib/slimPins";
import { venueBundlePrices } from "@/lib/venuePriceLane";
import type { Venue } from "@/lib/venues";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// The freshest-pint map rides into every pin. It must keep its identity across
// a pub's first, empty price read, and holding the previous answer must never
// cost the host a second run of its render: the map's host is a 7k-line
// component, and a state write during render ran it twice on every read
// (map-selection-inp).

type CommunityPrices = ReturnType<typeof useCommunityPrices>;

let root: Root;
// Called once per run of the host's render, with what the hook answered.
const onRender = vi.fn<(state: CommunityPrices) => void>();
const latest = (): CommunityPrices => onRender.mock.calls.at(-1)![0];

function Probe() {
  onRender(useCommunityPrices());
  return null;
}

beforeEach(async () => {
  onRender.mockClear();
  onVenues.mockClear();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(
    JSON.stringify({ prices: [], signals: [] }),
    { status: 200, headers: { "content-type": "application/json" } },
  )));
  root = createRoot(document.createElement("div"));
  await act(async () => root.render(createElement(Probe)));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("keeps the freshest-pint map, and one host run per commit, when a pub's first read is empty", async () => {
  const freshestBefore = latest().freshestByVenueId;
  const byVenueBefore = latest().byVenueId;
  const rendersBefore = onRender.mock.calls.length;

  await act(async () => latest().loadVenue("venue-empty"));
  await act(async () => { await Promise.resolve(); });

  // The read did land: the raw per-venue store changed.
  expect(latest().byVenueId).not.toBe(byVenueBefore);
  expect(latest().venuePriceStatus.get("venue-empty")).toBe("ready");
  // Nothing a pin carries changed, so neither did the map the pins key on.
  expect(latest().freshestByVenueId).toBe(freshestBefore);
  // Two commits - the read starting ("loading") and landing ("ready") - and
  // one run of the host per commit. Holding the answer in state ran the host
  // a second time on the landing: three runs for this read.
  expect(onRender.mock.calls.length - rendersBefore).toBe(2);
});

const baseVenues = [{
  ...slimVenueToPin({ id: "venue-empty", name: "The Test Arms", lat: 51.5, lng: -0.1,
    borough: "Camden", zone: 2, cheapestPrice: null, hasRecordedPrice: false }),
  bundlePrices: { estimate: { priceGbp: 6, computedAt: "2026-11-01", basis: "regional_baseline:camden", sampleSize: 8 } },
}];
const noDrops = new Map<string, PintDrop[]>();
const noUpdates: PriceUpdate[] = [];
const noCommunityPrices = new Map<string, CommunityPrice[]>();
const winePrice: CommunityPrice = { venueId: "venue-empty", drinkCategory: "wine", priceGbp: 7,
  submittedAt: Date.parse("2026-11-01"), source: "community", corroborations: 1 };
const onVenues = vi.fn<(venues: Venue[]) => void>();

function PublicPriceProbe({ prices }: { prices: ReadonlyMap<string, readonly CommunityPrice[]> }) {
  onVenues(usePublicPriceVenues(baseVenues, noDrops, noUpdates, "london", prices));
  return null;
}

function CommunityPricePresenceProbe() {
  const community = useCommunityPrices();
  onRender(community);
  return createElement(PublicPriceProbe, { prices: community.byVenueId });
}

const latestVenue = () => onVenues.mock.calls.at(-1)![0][0]!;

it("suppresses a pint estimate when the wine index discovers a public row", async () => {
  vi.mocked(fetch).mockImplementation(async () => new Response(JSON.stringify({ prices: [winePrice] })));
  await act(async () => root.render(createElement(CommunityPricePresenceProbe)));
  expect(venueBundlePrices(latestVenue()).estimate?.priceGbp).toBe(6);
  await act(async () => latest().loadDrinkCategoryIndex("wine"));
  expect(latest().byVenueId.get("venue-empty")).toMatchObject([winePrice]);
  expect(latest().freshestByVenueId.size).toBe(0);
  expect(latestVenue().publicPricePresence).toBe("present");
  expect(venueBundlePrices(latestVenue()).estimate).toBeNull();
});

it("returns the estimate when the community row rolls back", async () => {
  await act(async () => root.render(createElement(PublicPriceProbe, { prices: new Map([["venue-empty", [winePrice]]]) })));
  expect(venueBundlePrices(latestVenue()).estimate).toBeNull();
  await act(async () => root.render(createElement(PublicPriceProbe, { prices: noCommunityPrices })));
  expect(latestVenue().publicPricePresence).toBeUndefined();
  expect(venueBundlePrices(latestVenue()).estimate?.priceGbp).toBe(6);
});
