import { describe, expect, it, vi } from "vitest";

import { dispatchPriceAlert } from "@/lib/priceAlertDispatch.server";

describe("price alert delivery", () => {
  it("sends once to matching opted-in recipients with the price source and date", async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const claims = new Set<string>();
    const deps = {
      list: async () => [
        { userId: "one", area: "camden", thresholdPence: 500, enabled: true, token: "one" },
        { userId: "two", area: "camden", thresholdPence: 450, enabled: true, token: "two" },
        { userId: "three", area: "camden", thresholdPence: 500, enabled: false, token: "three" },
      ],
      claim: async (userId: string, eventId: string) => {
        const key = `${userId}:${eventId}`;
        if (claims.has(key)) return false;
        claims.add(key);
        return true;
      },
      send,
    };
    const event = { id: "drop-1", venueId: "venue-1", venueName: "Example Arms", pricePence: 450, lat: 51.539, lng: -0.143, observedAt: "2026-11-19T12:00:00Z", sourceLabel: "Pint Drop", visibility: "public", status: "visible", measure: "pint" };
    await dispatchPriceAlert(event, deps);
    await dispatchPriceAlert(event, deps);
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith("one", expect.objectContaining({ body: expect.stringContaining("£4.50") }), "one");
    expect(send.mock.calls[0]?.[1].body).toContain("Pint Drop");
    expect(send.mock.calls[0]?.[1].body).toContain("19 Nov 2026");
  });

  it("does not disclose private, hidden or non-pint reports", async () => {
    const send = vi.fn();
    const deps = {
      list: async () => [{ userId: "one", area: "camden", thresholdPence: 500, enabled: true, token: "one" }],
      claim: async () => true,
      send,
    };
    const event = { id: "drop-1", venueId: "venue-1", venueName: "Example Arms", pricePence: 450, lat: 51.539, lng: -0.143, observedAt: "2026-11-19T12:00:00Z", sourceLabel: "Pint Drop", visibility: "public", status: "visible", measure: "pint" };
    await dispatchPriceAlert({ ...event, visibility: "friends" }, deps);
    await dispatchPriceAlert({ ...event, status: "hidden" }, deps);
    await dispatchPriceAlert({ ...event, measure: "half" }, deps);
    expect(send).not.toHaveBeenCalled();
  });
});
