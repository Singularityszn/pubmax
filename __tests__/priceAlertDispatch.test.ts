import { describe, expect, it, vi } from "vitest";

import { dispatchPriceAlert, priceAlertDeliveryOutcome } from "@/lib/priceAlertDispatch.server";

describe("price alert delivery", () => {
  it("keeps uncertain network outcomes fenced while retrying provider rejections", () => {
    const summary = { targeted: 1, sent: 0, skipped: 0, pruned: 0, errors: 1 };
    expect(priceAlertDeliveryOutcome({ ...summary, results: [{ token: "one", status: "error", reason: "web_push_503" }] })).toBe("retryable");
    expect(priceAlertDeliveryOutcome({ ...summary, results: [{ token: "one", status: "error", reason: "web_push_failed" }] })).toBe("unknown");
  });
  it("sends once to matching opted-in recipients with the price source and date", async () => {
    const send = vi.fn().mockResolvedValue("delivered");
    const claims = new Set<string>();
    const deps = {
      list: async () => [
        { userId: "one", area: "camden", thresholdPence: 500, enabled: true, token: "one" },
        { userId: "two", area: "brixton", thresholdPence: 500, enabled: true, token: "two" },
        { userId: "three", area: "camden", thresholdPence: 500, enabled: false, token: "three" },
      ],
      claim: async (userId: string, eventId: string) => {
        const key = `${userId}:${eventId}`;
        if (claims.has(key)) return false;
        claims.add(key);
        return true;
      },
      settle: vi.fn(),
      send,
    };
    const event = { id: "drop-1", venueId: "venue-1", venueName: "Example Arms", pricePence: 450, lat: 51.539, lng: -0.143, observedAt: "2026-11-19T12:00:00Z", sourceLabel: "Pint Drop", visibility: "public", status: "visible", measure: "pint" };
    await dispatchPriceAlert(event, deps, event.observedAt);
    await dispatchPriceAlert(event, deps, event.observedAt);
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
      settle: vi.fn(),
      send,
    };
    const event = { id: "drop-1", venueId: "venue-1", venueName: "Example Arms", pricePence: 450, lat: 51.539, lng: -0.143, observedAt: "2026-11-19T12:00:00Z", sourceLabel: "Pint Drop", visibility: "public", status: "visible", measure: "pint" };
    await dispatchPriceAlert({ ...event, visibility: "friends" }, deps, event.observedAt);
    await dispatchPriceAlert({ ...event, status: "hidden" }, deps, event.observedAt);
    await dispatchPriceAlert({ ...event, measure: "half" }, deps, event.observedAt);
    expect(send).not.toHaveBeenCalled();
  });
});
