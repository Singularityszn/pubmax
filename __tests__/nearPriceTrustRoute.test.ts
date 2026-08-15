import { beforeEach, describe, expect, it, vi } from "vitest";

const { getVenueDetail } = vi.hoisted(() => ({ getVenueDetail: vi.fn() }));

vi.mock("@/lib/venueDetailIndex", () => ({
  getVenueDetail,
  isVenueDetailId: (id: string) => /^venue-[a-z0-9-]+$/.test(id),
}));

import { GET } from "@/app/api/near-price-trust/route";

function request(query: string): Request {
  return new Request(`http://localhost/api/near-price-trust?${query}`);
}

function detail(id: string, price = 4.5, pubUrl = "https://www.pint-prices.com/pub/test") {
  return {
    id,
    cheapestPrice: price,
    prices: [{ app_price_id: "p1", pint_name: "Lager", price_gbp: price, pub_url: pubUrl }],
  };
}

describe("GET /api/near-price-trust", () => {
  beforeEach(() => getVenueDetail.mockReset());

  it("rejects empty, malformed, and oversized requests", async () => {
    expect((await GET(request(""))).status).toBe(400);
    expect((await GET(request("venueId=../../secret"))).status).toBe(400);
    expect((await GET(request(
      "venueId=venue-a&venueId=venue-b&venueId=venue-c&venueId=venue-d&venueId=venue-e&venueId=venue-f",
    ))).status).toBe(400);
  });

  it("deduplicates IDs and returns display-safe evidence", async () => {
    getVenueDetail.mockImplementation(async (id: string) => detail(id));

    const response = await GET(request("venueId=venue-a&venueId=venue-a&venueId=venue-b"));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, max-age=0, no-store");
    expect(await response.json()).toEqual({
      status: "ready",
      collectedAt: "2026-07-03",
      results: [
        { venueId: "venue-a", price: 4.5, publisher: "Pint Prices" },
        { venueId: "venue-b", price: 4.5, publisher: "Pint Prices" },
      ],
    });
    expect(getVenueDetail).toHaveBeenCalledTimes(2);
  });

  it("reports a failed read as degraded, never as publisher-unrecorded", async () => {
    getVenueDetail.mockRejectedValueOnce(new Error("detail store unavailable"));

    const response = await GET(request("venueId=venue-a"));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      status: "degraded",
      collectedAt: "2026-07-03",
      results: [],
    });
  });
});
