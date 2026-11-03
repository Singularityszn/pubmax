import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { HistoricPub } from "@/lib/historic";
import { slimVenueToPin } from "@/lib/slimPins";
import type { Venue } from "@/lib/venues";

const data = vi.hoisted(() => ({ venues: [] as Venue[], historic: [] as HistoricPub[] }));
vi.mock("@/lib/venuePriceIndex", () => ({ getPricedVenues: async () => data.venues }));
vi.mock("@/lib/historic", () => ({ loadHistoricPubs: async () => data.historic }));
vi.mock("@/lib/weatherFreshness.server", () => ({ loadFreshWeatherSnapshot: async () => null }));
vi.mock("@/lib/venueMenuEnrichment", () => ({ loadVenueMenuEnrichmentIndex: async () => new Map() }));
vi.mock("@/app/today/todayDaytime.server", () => ({
  loadTodayCoffeePilot: async () => [], loadTodayDeskPack: async () => ({ status: "empty" }),
}));
vi.mock("@/lib/tflDisruption", () => ({ fetchLineStatuses: async () => [], disruptionForPatch: () => null }));
vi.mock("@/lib/mapEagerVenueIndex.server", () => ({ loadMapSelectableVenueIds: async () => new Set() }));
vi.mock("@/lib/hypedPubs.server", () => ({ loadHypedPubs: async () => ({ rows: [] }) }));
vi.mock("@/lib/spoonsValue.server", () => ({ readSpoonsValue: async () => ({ byVenueId: new Map() }) }));
vi.mock("@/lib/todayListings.server", () => ({
  loadTodayWhatsOnAnswer: async () => ({ body: null }), loadTodayOutAnswer: async () => ({ body: null }),
}));
vi.mock("@/lib/tonightOperatorFacts.server", () => ({ loadTonightOperatorFacts: async () => [] }));
vi.mock("@/lib/cheapestHunt.server", () => ({ loadLondonHuntPints: async () => [] }));
vi.mock("@/lib/wetherspoonsMatch.server", () => ({ matchedWetherspoonsVenueIds: async () => new Set() }));
vi.mock("@/app/today/TodayClient", () => ({ default: () => null }));
vi.mock("@/app/tonight/TonightClient", () => ({ default: () => null }));

import TodayPage from "@/app/today/page";
import TonightPage from "@/app/tonight/page";

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-03T10:00:00Z"));
  data.venues = [
    { id: "a-half", cheapestPrice: 3.4, cheapestPint: "Half-pint lager" },
    { id: "b-dear", cheapestPrice: 6 },
    { id: "z-cheap", cheapestPrice: 4.2 },
  ].map((row) => slimVenueToPin({ name: row.id, lat: 51.51, lng: -0.13, borough: "Westminster",
    priceSource: "Pub menu", priceObservedAt: "2026-01-01", ...row }));
  data.historic = [...data.venues.map((venue) => venue.id), "c-unpriced"].map((id): HistoricPub => ({
    venueId: id, name: id, slug: id, borough: "Westminster", lat: 51.51, lng: -0.13,
    hook: "A cited historic pub.", era: "1700", listed: "II", sourced: true,
    facts: [{ source: "wikipedia", fact: "A cited historic pub.", sourceRef: "https://en.wikipedia.org/wiki/Example" }],
  }));
});
afterEach(() => { vi.useRealTimers(); });

describe("the quiet-pub prices passed to the public pages", () => {
  it.each([["Today", TodayPage], ["Tonight", TonightPage]] as const)("%s prefers the qualified cheaper pint and retains other rows and prices", async (_, page) => {
    const document = await page();
    const quiet = document.props.quietPint;
    expect(quiet?.rows.map((row: { id: string }) => row.id)).toEqual(["z-cheap", "b-dear", "a-half", "c-unpriced"]);
    expect(quiet?.rows[0]).toMatchObject({ priceGbp: 4.2, priceLabel: "£4.20" });
    expect(quiet?.rows[2]).toMatchObject({ priceGbp: 3.4, priceLabel: "£3.40" });
    expect(quiet?.rows[3]).toMatchObject({ priceGbp: null, priceLabel: null });
  });
});
