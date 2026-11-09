import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

const bundleRows = vi.hoisted(() => ({ rows: [] as unknown[], unavailable: false }));
vi.mock("@/lib/ukPriceBundle.server", () => ({
  ukPriceBundleRowsFor: async () => ({ status: bundleRows.unavailable ? "unavailable" : bundleRows.rows.length ? "ready" : "empty", rows: bundleRows.rows }),
}));

import { GET } from "@/app/api/harvest-overlay/route";
import { parseOverlayRow } from "@/lib/harvestFold";
import { __resetHarvestOverlayStore, harvestOverlayStore } from "@/lib/harvestOverlayStore";
import { __resetPintDrops } from "@/lib/pintDrops";

function get(query: string): Promise<Response> {
  return GET(new Request(`http://localhost/api/harvest-overlay?${query}`));
}

beforeEach(() => {
  bundleRows.rows = [];
  bundleRows.unavailable = false;
  vi.restoreAllMocks();
  __resetHarvestOverlayStore();
  __resetPintDrops();
});

describe("GET /api/harvest-overlay budget", () => {
  it("has no shared budget a handful of addresses could spend for everybody", async () => {
    // Eleven addresses each staying under their own 120 a minute used to
    // exhaust a global 1,200 and lock every other reader out.
    for (let ip = 1; ip <= 11; ip += 1) {
      for (let i = 0; i < 110; i += 1) {
        const res = await GET(
          new Request("http://localhost/api/harvest-overlay", {
            headers: { "x-forwarded-for": `198.51.100.${ip}` },
          }),
        );
        expect(res.status).toBe(400);
      }
    }
    const bystander = await GET(
      new Request("http://localhost/api/harvest-overlay", {
        headers: { "x-forwarded-for": "203.0.113.200" },
      }),
    );
    expect(bystander.status).toBe(400);
  });

  it("still holds one address to its own budget", async () => {
    let last: Response | null = null;
    for (let i = 0; i < 121; i += 1) {
      last = await GET(
        new Request("http://localhost/api/harvest-overlay", {
          headers: { "x-forwarded-for": "198.51.100.77" },
        }),
      );
    }
    expect(last?.status).toBe(429);
  });
});

describe("GET /api/harvest-overlay", () => {
  it("returns 400 when venueId is missing", async () => {
    const res = await get("");
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBeTruthy();
  });

  it("answers ready with overlay null for an unknown OSM id, never no-history", async () => {
    const res = await get("venueId=venue-uk-n999");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ready", overlay: null, listedPriceStatus: "empty" });
  });

  it("returns https website, menu, and cited web lore for a folded OSM id", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
        osmId: "node/123",
        name: "The Red Lion",
        town: "Clapham",
        website: "https://redlion.example/",
        menuUrl: "https://redlion.example/menu",
        matchedLore: {
          text: "The Red Lion in Clapham has stood on the common since the eighteenth century.",
          citations: ["https://history.example/red-lion-clapham"],
        },
        sources: ["https://redlion.example/"],
      }),
    ]);
    const res = await get("venueId=venue-uk-n123");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ready");
    expect(body.overlay.website).toBe("https://redlion.example/");
    expect(body.overlay.menuUrl).toBe("https://redlion.example/menu");
    expect(body.overlay.lore).toEqual({
      source: "web",
      fact: "The Red Lion in Clapham has stood on the common since the eighteenth century.",
      sourceRef: "https://history.example/red-lion-clapham",
    });
    expect(JSON.stringify(body)).not.toMatch(/instagram|social/i);
  });

  it("resolves a salted city id before reading its OSM overlay", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
        osmId: "way/100646638",
        name: "Peveril of the Peak",
        town: "Manchester",
        matchedLore: {
          text: "Peveril of the Peak in Manchester has a long history.",
          citations: ["https://history.example/peveril"],
        },
        sources: ["https://history.example/peveril"],
      }),
    ]);

    const res = await get("venueId=venue-mcr-1lwo5lo");
    expect(res.status).toBe(200);
    expect((await res.json()).overlay.lore.source).toBe("web");
  });

  it("merges overlays from every OSM object owned by one curated venue", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
        osmId: "node/13235500301",
        name: "The Grenadier",
        town: "London",
        website: "https://grenadier.example/",
        menuUrl: null,
        matchedLore: null,
        sources: ["https://grenadier.example/"],
      }),
      parseOverlayRow({
        osmId: "way/556177108",
        name: "The Grenadier",
        town: "London",
        website: null,
        menuUrl: "https://grenadier.example/menu",
        matchedLore: null,
        sources: ["https://grenadier.example/menu"],
      }),
    ]);

    const res = await get("venueId=venue-1ha28jc");
    expect(res.status).toBe(200);
    expect((await res.json()).overlay).toMatchObject({
      website: "https://grenadier.example/",
      menuUrl: "https://grenadier.example/menu",
    });
  });

  it("returns unknown when stored overlay fields have no public value", async () => {
    await harvestOverlayStore().upsertMany([
      parseOverlayRow({
        osmId: "node/123",
        name: "The Red Lion",
        town: "Clapham",
        website: "https://redlion.example/, https://redlion.example/alt",
        menuUrl: null,
        matchedLore: null,
        sources: ["https://redlion.example/"],
      }),
    ]);

    const res = await get("venueId=venue-uk-n123");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: "ready", overlay: null, listedPriceStatus: "empty" });
  });
});

describe("GET /api/harvest-overlay listed pint", () => {
  const row = (lane: string, standing: string, extra: Record<string, unknown> = {}) => ({
    venueId: "venue-uk-n1720298837",
    name: "Eagle Ale House",
    category: "beer",
    priceGbp: 6.75,
    lane,
    standing,
    sourceUrl: standing === "listed" ? "https://guinndex.co.uk/pub/the-eagle-ale-house-london" : null,
    publisher: standing === "listed" ? "Guinndex" : null,
    observedAt: "2026-04-23T10:00:00.000Z",
    basis: standing === "estimate" ? "london:all" : null,
    sampleSize: standing === "estimate" ? 40 : null,
    ...extra,
  });

  it.each(["venue-uk-n1720298837", "unknown-venue"])("does not cache an unread bundle for %s", async (venueId) => {
    bundleRows.unavailable = true;
    const response = await get(`venueId=${venueId}`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({ status: "degraded", listedPriceStatus: "unavailable" });
  });

  it("preserves a read price when the overlay store fails", async () => {
    bundleRows.rows = [row("listing-site", "listed")];
    vi.spyOn(harvestOverlayStore(), "getByVenueId").mockResolvedValue({ status: "degraded", overlay: null });
    const response = await get("venueId=venue-uk-n1720298837");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toMatchObject({
      status: "degraded",
      listedPriceStatus: "ready",
      listedPrice: { priceGbp: 6.75, publisher: "Guinndex" },
    });
  });

  it("carries a base pub's listed pint with its page, day and drink", async () => {
    bundleRows.rows = [row("listing-site", "listed", { drinkLabel: "Guinness", servingSize: "Pint" })];
    const body = await (await get("venueId=venue-uk-n1720298837")).json();
    expect(body.listedPrice).toEqual({
      priceGbp: 6.75,
      sourceUrl: "https://guinndex.co.uk/pub/the-eagle-ale-house-london",
      observedAt: "2026-04-23T10:00:00.000Z",
      publisher: "Guinndex",
      drinkLabel: "Guinness",
      servingSize: "Pint",
    });
  });

  it("never carries a modelled figure as a listed pint", async () => {
    bundleRows.rows = [row("estimate", "estimate")];
    const body = await (await get("venueId=venue-uk-n1720298837")).json();
    expect(body.listedPrice).toBeUndefined();
  });
});
