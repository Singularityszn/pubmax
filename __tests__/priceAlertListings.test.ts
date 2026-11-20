import { describe, expect, it, vi } from "vitest";

import { listedPriceAlertEvents, dispatchListedPriceAlerts } from "@/lib/priceAlertListings.server";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";

const row: UkPriceBundleRow = {
  venueId: "venue-1", name: "Example Arms", category: "beer", priceGbp: 4.5,
  lane: "site-harvest", standing: "listed", sourceUrl: "https://example.test/menu",
  publisher: "Example menu", observedAt: "2026-11-20T13:00:00Z", basis: null, sampleSize: null,
  servingSize: "Pint", drinkLabel: "Lager",
};
const venues = new Map([["venue-1", { id: "venue-1", name: "Example Arms", borough: "Camden", lat: 51.539, lng: -0.143 }]]);

describe("listed price alerts", () => {
  it("accepts sourced pints and refuses estimates, other measures and missing evidence", () => {
    const rows = [row, { ...row, lane: "estimate" as const, standing: "estimate" as const }, { ...row, servingSize: "half" }, { ...row, servingSize: undefined }, { ...row, sourceUrl: null }];
    const events = listedPriceAlertEvents(rows, venues, Date.parse("2026-11-20T14:00:00Z"));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ pricePence: 450, sourceLabel: "Example menu", venueId: "venue-1" });
  });

  it("sends only observations recorded after opt-in and claims at most once for an area on a day", async () => {
    const claim = vi.fn().mockResolvedValue(true);
    const send = vi.fn().mockResolvedValue(undefined);
    const event = listedPriceAlertEvents([row], venues, Date.parse("2026-11-20T14:00:00Z"))[0]!;
    const recipients = [
      { userId: "before", area: "camden", thresholdPence: 500, token: "one", enabled: true as const, enabledAt: "2026-11-20T12:00:00Z" },
      { userId: "after", area: "camden", thresholdPence: 500, token: "two", enabled: true as const, enabledAt: "2026-11-20T13:30:00Z" },
    ];
    await dispatchListedPriceAlerts([event, { ...event, id: "another" }], recipients, { claim, send }, new Map([[event.id, "2026-11-20T13:01:00Z"], ["another", "2026-11-20T13:01:00Z"]]));
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[1].body).toContain("Example menu");
    expect(send.mock.calls[0]?.[1].body.match(/Example menu/g)).toHaveLength(1);
    expect(claim).toHaveBeenCalledTimes(1);
  });

  it("does not send rows from the baseline even when their source date is newer", async () => {
    const event = listedPriceAlertEvents([row], venues, Date.parse("2026-11-20T14:00:00Z"))[0]!;
    const send = vi.fn();
    const recipient = { userId: "one", area: "camden", thresholdPence: 500, token: "one", enabled: true as const, enabledAt: "2026-11-20T12:00:00Z" };
    await dispatchListedPriceAlerts([event], [recipient], { claim: vi.fn(), send }, new Map([[event.id, "2026-11-20T11:00:00Z"]]));
    expect(send).not.toHaveBeenCalled();
  });
});
