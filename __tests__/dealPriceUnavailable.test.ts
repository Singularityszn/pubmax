import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/communityPriceActor", () => ({ deriveCommunityPriceActor: () => "reader" }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/dealPriceStore", () => ({ dealPriceStore: () => ({ read: async () => { throw new Error("missing schema"); } }) }));

import { GET } from "@/app/api/deal-prices/route";

describe("deal storage unavailable", () => {
  it("does not report unavailable venue deals as an empty result", async () => {
    const response = await GET(new Request("http://localhost/api/deal-prices?venueId=venue-test"));
    expect(response.status).toBe(503);
    expect(await response.json()).not.toHaveProperty("deals");
  });
});
