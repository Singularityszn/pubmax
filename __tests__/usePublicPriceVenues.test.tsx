/** @vitest-environment jsdom */

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { usePublicPriceVenues } from "@/components/map/pubmap/usePublicPriceVenues";
import type { PintDrop } from "@/lib/pintDropShared";
import { venueBundlePrices } from "@/lib/venuePriceLane";
import type { Venue } from "@/lib/venues";

// The map decides an estimate from what it already holds. It asks the server
// nothing per pub, so an estimate never waits for, or vanishes with, a read.

type Drops = Parameters<typeof usePublicPriceVenues>[1];

let root: Root;
const onVenues = vi.fn<(venues: Venue[]) => void>();
const latestVenue = () => onVenues.mock.calls.at(-1)![0][0]!;
const noDrops: Drops = new Map();
const community = new Map();

function MapPrices({ venues, drops }: { venues: Venue[]; drops: Drops }) {
  onVenues(usePublicPriceVenues(venues, drops, [], "london", community));
  return null;
}

async function show(venues: Venue[], drops: Drops = noDrops) {
  await act(async () => root.render(createElement(MapPrices, { venues, drops })));
}

const estimated = [{
  id: "venue-0", name: "Pub 0", zone: 1, cheapestPrice: null, hasRecordedPrice: false, prices: [],
  bundlePrices: { estimate: { priceGbp: 6, computedAt: "2026-11-19", basis: "regional_baseline:camden", sampleSize: 8 } },
} as unknown as Venue];

function halfPint(): PintDrop {
  return {
    id: "half-pint", venueId: "venue-0", drink: "Lager", measure: "half", priceGbp: 3,
    handle: "drinker", passedDownNote: "", era: "", provenance: "contributor",
    status: "visible", visibility: "public", createdAt: "2026-11-19T12:00:00Z",
  };
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.stubGlobal("fetch", vi.fn());
  root = createRoot(document.createElement("div"));
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
});

it("shows an estimate at once and asks the server nothing", async () => {
  await show(estimated);
  expect(venueBundlePrices(latestVenue()).estimate?.priceGbp).toBe(6);
  expect(fetch).not.toHaveBeenCalled();
});

it.each(["public", "anonymous", undefined] as const)("withholds the estimate beside a %s priced drop, then returns it on rollback", async (visibility) => {
  await show(estimated, new Map([["venue-0", [{ ...halfPint(), visibility }]]]));
  expect(latestVenue().cheapestPrice).toBeNull();
  expect(latestVenue().publicPricePresence).toBe("present");
  expect(venueBundlePrices(latestVenue()).estimate).toBeNull();

  await show(estimated);
  expect(venueBundlePrices(latestVenue()).estimate?.priceGbp).toBe(6);
});

it.each([
  { visibility: "friends" }, { visibility: "legacy" }, { status: "hidden" }, { provenance: "demo" }, { priceGbp: null },
] as const)("keeps the estimate beside a drop the public cannot read as a price: %o", async (excluded) => {
  await show(estimated, new Map([["venue-0", [{ ...halfPint(), ...excluded }]]]));
  expect(latestVenue().publicPricePresence).toBeUndefined();
  expect(venueBundlePrices(latestVenue()).estimate?.priceGbp).toBe(6);
});
