import { beforeEach, describe, expect, it, vi } from "vitest";

const sources = vi.hoisted(() => ({
  drops: vi.fn(), community: vi.fn(), bundle: vi.fn(), detail: vi.fn(), updates: vi.fn(), aliases: vi.fn(),
}));
vi.mock("@/lib/pintDropsStore", () => ({ pintDropsStore: () => ({ publicPricedVenueIds: sources.drops }) }));
vi.mock("@/lib/communityPriceStore", () => ({ communityPriceStore: () => ({ publicPricedVenueIds: sources.community }) }));
vi.mock("@/lib/ukPriceBundle.server", () => ({ ukPriceBundleRowsByVenue: sources.bundle }));
vi.mock("@/lib/venueDetailIndex", () => ({ lookupVenueDetail: sources.detail }));
vi.mock("@/lib/priceUpdates.server", () => ({ venuePriceUpdatesFor: sources.updates }));
vi.mock("@/lib/venueAliases", () => ({ loadVenueAliasResolver: sources.aliases }));
import { readPublicPricePresence } from "@/lib/publicPricePresence.server";

beforeEach(() => {
  vi.resetAllMocks();
  sources.drops.mockResolvedValue(new Set());
  sources.community.mockResolvedValue(new Set());
  sources.bundle.mockResolvedValue({ status: "ready", byVenue: new Map() });
  sources.detail.mockImplementation(async (id) => ({ status: "found", venue: {
    id, name: "The Test Arms", address: "Somewhere", latitude: 51, longitude: 0, cheapestPrice: null, prices: [],
  } }));
  sources.updates.mockResolvedValue({ drink: [], food: [] });
  sources.aliases.mockResolvedValue({ status: "ready", canonical: (id: string) => id === "old" ? "current" : id,
    storedIds: (id: string) => ["old", "current"].includes(id) ? ["current", "old"] : [id] });
});

describe("complete public-price presence", () => {
  it("establishes absence only after every source answers", async () => {
    expect(await readPublicPricePresence(["empty"])).toEqual({ empty: "absent" });
  });
  it.each(["drops", "community", "bundle", "detail", "updates", "aliases"] as const)("keeps a failed %s source unknown", async (source) => {
    sources[source].mockRejectedValue(new Error("unavailable"));
    expect(await readPublicPricePresence(["empty"])).toEqual({ empty: "unknown" });
  });
  it.each(["drops", "community"] as const)("finds a %s price under an old venue ID", async (source) => {
    sources[source].mockResolvedValue(new Set(["old"]));
    expect(await readPublicPricePresence(["current", "old"])).toEqual({ current: "present", old: "present" });
  });
  it("recognises an observed bundle price even when a dynamic source fails", async () => {
    sources.drops.mockRejectedValue(new Error("unavailable"));
    sources.bundle.mockResolvedValue({ status: "ready", byVenue: new Map([["current", [{ standing: "listed" }]]]) });
    expect(await readPublicPricePresence(["old"])).toEqual({ old: "present" });
  });
  it("does not mistake a bundle estimate for a recorded price", async () => {
    sources.bundle.mockResolvedValue({ status: "ready", byVenue: new Map([["empty", [{ standing: "estimate" }]]]) });
    expect(await readPublicPricePresence(["empty"])).toEqual({ empty: "absent" });
  });
  it("keeps an unavailable bundle or detail unknown", async () => {
    sources.bundle.mockResolvedValue({ status: "unavailable", byVenue: new Map() });
    expect(await readPublicPricePresence(["empty"])).toEqual({ empty: "unknown" });
    sources.bundle.mockResolvedValue({ status: "ready", byVenue: new Map() });
    sources.detail.mockResolvedValue({ status: "unavailable" });
    expect(await readPublicPricePresence(["empty"])).toEqual({ empty: "unknown" });
  });
  it("recognises a listed zero price and a non-beer menu price", async () => {
    sources.detail.mockResolvedValueOnce({ status: "found", venue: { cheapestPrice: 0, prices: [] } });
    expect(await readPublicPricePresence(["free"])).toEqual({ free: "present" });
    sources.updates.mockResolvedValue({ drink: [{ category: "wine", lane: "publisher" }], food: [] });
    expect(await readPublicPricePresence(["wine"])).toEqual({ wine: "present" });
  });
  it("cannot establish absence without aliases or a recognised venue", async () => {
    sources.aliases.mockResolvedValueOnce({ status: "unavailable" });
    expect(await readPublicPricePresence(["empty"])).toEqual({ empty: "unknown" });
    sources.detail.mockResolvedValue({ status: "missing" });
    expect(await readPublicPricePresence(["missing"])).toEqual({ missing: "unknown" });
  });
});
