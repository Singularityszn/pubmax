import { beforeEach, describe, expect, it, vi } from "vitest";

const reads = vi.hoisted(() => ({ pints: vi.fn(), venues: vi.fn() }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/cheapestHunt.server", () => ({ loadLondonHuntPintsOrNull: reads.pints }));
vi.mock("@/lib/venuePriceIndex", () => ({ getPricedVenues: reads.venues }));
import { readBadge } from "@/lib/embedBadge.server";

const pint = (venueId: string, priceGbp: number) => ({ venueId, priceGbp, pubName: venueId, publisher: { label: "Source" }, observedOn: "2026-11-09" });

describe("badge price selection", () => {
  beforeEach(() => {
    reads.venues.mockResolvedValue([{ id: "other", primaryBorough: "Islington" }, { id: "camden", primaryBorough: "Camden" }]);
    reads.pints.mockResolvedValue([pint("other", 2), pint("camden", 4)]);
  });

  it("selects the cheapest eligible pint in the requested borough", async () => {
    expect(await readBadge("area", "camden")).toMatchObject({ pubName: "camden", priceGbp: 4, publisher: "Source", observedOn: "2026-11-09" });
  });

  it("selects only the requested venue and returns no invented price", async () => {
    expect(await readBadge("venue", "other")).toMatchObject({ pubName: "other", priceGbp: 2 });
    expect(await readBadge("venue", "missing")).toBeNull();
    expect(await readBadge("area", "unknown")).toBeNull();
  });

  it("treats a failed price read as unavailable", async () => {
    reads.pints.mockResolvedValue(null);
    await expect(readBadge("area", "camden")).rejects.toThrow();
  });
});
