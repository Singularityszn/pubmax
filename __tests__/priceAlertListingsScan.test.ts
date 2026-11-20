import { beforeEach, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: [] as unknown[], send: vi.fn(), claim: vi.fn() }));
vi.mock("@/lib/ukPriceBundle.server", () => ({ ukPriceBundleRowsByVenue: async () => ({ status: "ready", byVenue: new Map([["v", state.rows]]) }) }));
vi.mock("@/lib/venueIndex", () => ({ getVenueIndexSnapshot: async () => ({ loadedCities: new Set(["london"]), index: new Map([["v", { id: "v", name: "Example Arms", borough: "Camden", lat: 51.539, lng: -0.143 }]]) }) }));
vi.mock("@/lib/priceAlertStore", () => ({ priceAlertStore: () => ({ listAll: async () => [{ userId: "a", area: "camden", thresholdPence: 500, token: "t", enabled: true, enabledAt: "2026-11-20T12:00:00Z" }], claim: state.claim, removeIfToken: vi.fn() }) }));
vi.mock("@/lib/pushSender", () => ({ sendPriceAlert: state.send }));

import { prepareListedPriceBaseline, scanListedPriceAlerts } from "@/lib/priceAlertListingsScan.server";

const row = { venueId: "v", name: "Example Arms", category: "beer", priceGbp: 4.5, lane: "site-harvest", standing: "listed", sourceUrl: "https://example.test/menu", publisher: "Example menu", observedAt: "2026-11-20T13:00:00Z", basis: null, sampleSize: null, servingSize: "Pint", drinkLabel: "Lager" };

beforeEach(() => {
  state.rows = [row];
  state.claim.mockReset().mockResolvedValue(true);
  state.send.mockReset().mockResolvedValue({ results: [] });
});

it("excludes the first backfill and sends a later new listed price", async () => {
  vi.useFakeTimers();
  try {
    vi.setSystemTime(new Date("2026-11-20T11:00:00Z"));
    await prepareListedPriceBaseline();
    vi.setSystemTime(new Date("2026-11-20T14:00:00Z"));
    await scanListedPriceAlerts();
    expect(state.send).not.toHaveBeenCalled();
    state.rows = [row, { ...row, priceGbp: 4.25, observedAt: "2026-11-20T09:00:00Z" }];
    await scanListedPriceAlerts();
    expect(state.send).toHaveBeenCalledOnce();
    expect(state.send.mock.calls[0]?.[1].body).toContain("£4.25");
    expect(state.claim).toHaveBeenCalledWith("a", expect.any(String), expect.any(Object), "2026-11-20T14:00:00.000Z");
  } finally { vi.useRealTimers(); }
});
