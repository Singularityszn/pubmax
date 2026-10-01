import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false, requiresSupabaseStore: () => false };
});
const { readFile, readCommunityIndex } = vi.hoisted(() => ({
  readFile: vi.fn(),
  readCommunityIndex: vi.fn(),
}));
vi.mock("fs", () => ({ promises: { readFile } }));
vi.mock("@/lib/communityPriceStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/communityPriceStore")>();
  return { ...actual, readCommunityPriceCategoryIndex: readCommunityIndex };
});

import { GET } from "@/app/api/price-submit/route";
import { resetUkPriceBundleForTests } from "@/lib/ukPriceBundle.server";

const now = Date.parse("2026-10-01T12:00:00Z");
const soft = {
  venueId: "venue-13xdb1p", name: "The Plough", category: "soft-drink", priceGbp: 4.35,
  lane: "site-harvest", standing: "listed", publisher: "theploughstjohnshill.co.uk",
  sourceUrl: "https://www.theploughstjohnshill.co.uk/the-bar/",
  observedAt: "2026-09-21T18:27:31.674Z", basis: null, sampleSize: null,
};
const alcoholFree = { ...soft, category: "alcohol-free", priceGbp: 4.95,
  drinkLabel: "Corona Cero 0.0% 330ml" };
const community = { venueId: soft.venueId, drinkCategory: "soft-drink", priceGbp: 5,
  submittedAt: now, source: "community", corroborations: 2 };
const getIndex = () => GET(new Request("http://localhost/api/price-submit?lens=no-alcohol"));

beforeEach(() => {
  vi.spyOn(Date, "now").mockReturnValue(now);
  resetUkPriceBundleForTests();
  readFile.mockReset();
  readCommunityIndex.mockReset();
  readCommunityIndex.mockResolvedValue({ prices: [], truncated: false, degraded: false });
});
afterEach(() => { vi.restoreAllMocks(); resetUkPriceBundleForTests(); });

describe("no-alcohol public index includes approved publisher prices", () => {
  it("keeps exact AF and soft quotes, excluding beer, estimates, stale and unsafe sources", async () => {
    readFile.mockResolvedValue(JSON.stringify([
      alcoholFree, soft,
      { ...soft, category: "beer", priceGbp: 6.1 },
      { ...soft, venueId: "estimate", standing: "estimate", sourceUrl: null },
      { ...soft, venueId: "stale", observedAt: "2020-01-01T00:00:00Z" },
      { ...soft, venueId: "unsafe", sourceUrl: "javascript:alert(1)" },
    ]));
    const response = await getIndex();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const body = await response.json();
    expect(body.prices).toEqual([]);
    expect(body.listedPrices).toEqual([
      expect.objectContaining({ venueId: soft.venueId, source: "listed", category: "alcohol-free",
        priceGbp: 4.95, servingSize: null, drinkLabel: "Corona Cero 0.0% 330ml",
        sourceUrl: soft.sourceUrl, observedAt: soft.observedAt }),
      expect.objectContaining({ venueId: soft.venueId, source: "listed", category: "soft-drink",
        priceGbp: 4.35, servingSize: null, sourceUrl: soft.sourceUrl, observedAt: soft.observedAt }),
    ]);
    expect(body.truncated).toBe(false);
    expect(body.degraded).not.toBe(true);
  });

  it("retains listed quotes when the community read fails and says coverage is degraded", async () => {
    readFile.mockResolvedValue(JSON.stringify([soft]));
    readCommunityIndex.mockResolvedValue({ prices: [], truncated: false, degraded: true });
    const body = await (await getIndex()).json();
    expect(body.listedPrices).toContainEqual(expect.objectContaining({ priceGbp: 4.35, source: "listed" }));
    expect(body.degraded).toBe(true);
  });

  it("retains community observations when the publisher bundle fails without claiming complete coverage", async () => {
    readFile.mockRejectedValue(new Error("publisher bundle unavailable"));
    readCommunityIndex.mockResolvedValue({ prices: [community], truncated: false, degraded: false });
    const body = await (await getIndex()).json();
    expect(body.prices).toEqual([community]);
    expect(body.listedPrices).toEqual([]);
    expect(body.degraded).toBe(true);
  });

  it("bounds the combined publisher payload and reports truncation across both categories", async () => {
    readFile.mockResolvedValue(JSON.stringify([
      ...Array.from({ length: 700 }, (_, index) => ({ ...alcoholFree, venueId: `af-${index}` })),
      ...Array.from({ length: 700 }, (_, index) => ({ ...soft, venueId: `soft-${index}` })),
    ]));
    const body = await (await getIndex()).json();
    expect(body.listedPrices).toHaveLength(1000);
    expect(body.truncated).toBe(true);
    expect(body.degraded).not.toBe(true);
  });
});
