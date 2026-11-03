import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { tonightCheapPintCandidates, tonightCheapPints } from "@/lib/tonightCheapPints";
import type { UkPriceBundleRow } from "@/lib/ukPriceBundle";
import type { Venue } from "@/lib/venues";

const reads = vi.hoisted(() => ({
  venues: vi.fn(),
  bundle: vi.fn(),
  catalog: vi.fn(),
}));
vi.mock("@/lib/venuePriceIndex", () => ({ getPricedVenues: reads.venues }));
vi.mock("@/lib/ukPriceBundle.server", () => ({ ukPriceBundleRowsByVenue: reads.bundle }));
vi.mock("@/lib/ukNationalPubSearch.server", () => ({ getUkNationalPubCatalog: reads.catalog }));

function londonVenue(id: string, price: number, ownPage = true): Venue {
  return {
    id, name: "The London Lion", address: "1 Test Street, London",
    latitude: 51.5, longitude: -0.1, primaryBorough: "Southwark",
    visibleBoroughs: ["Southwark"], cheapestPrice: price, cheapestPint: "London lager",
    averagePrice: price, hasStory: false,
    prices: [{
      app_price_id: id, pub_name: "The London Lion", pint_name: "London lager",
      price_gbp: price, price_text: "£" + price, address: "1 Test Street, London",
      latitude: 51.5, longitude: -0.1, pub_url: "https://lion.example/drinks",
      scraped_at_values: "2026-10-02T12:00:00.000Z", has_individual_pub_page_row: ownPage,
      data_quality_notes: "",
    }],
  } as Venue;
}

function row(overrides: Partial<UkPriceBundleRow> = {}): UkPriceBundleRow {
  return {
    venueId: "venue-uk-london", name: "The Selected Arms", category: "beer",
    priceGbp: 3, lane: "site-harvest", standing: "listed",
    sourceUrl: "https://winner.example/menu", publisher: "Winner",
    observedAt: "2026-10-02T10:00:00.000Z", drinkLabel: "Selected lager",
    servingSize: "568ml", basis: null, sampleSize: null, ...overrides,
  };
}

function setBundle(rows: UkPriceBundleRow[]) {
  const byVenue = new Map<string, UkPriceBundleRow[]>();
  for (const entry of rows) byVenue.set(entry.venueId, [...(byVenue.get(entry.venueId) ?? []), entry]);
  reads.bundle.mockResolvedValue({ status: "ready", byVenue });
  reads.catalog.mockReturnValue({
    status: "ready",
    pubs: [...byVenue.keys()].map((id) => ({
      id, name: "The Selected Arms", address: "1 Test Street",
      lat: id === "venue-uk-manchester" ? 53.48 : 51.5,
      lng: id === "venue-uk-manchester" ? -2.24 : -0.1, closed: false,
    })),
  });
}

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-01T12:00:00.000Z"));
  reads.venues.mockResolvedValue([londonVenue("venue-london", 4)]);
  setBundle([]);
});
afterEach(() => vi.useRealTimers());

describe("Tonight's public London hunt loader", () => {
  it("keeps only qualified London pints in price order with the selected row's complete evidence", async () => {
    reads.venues.mockResolvedValue([
      londonVenue("venue-london", 4), londonVenue("venue-uncorroborated", 0.5, false),
    ]);
    setBundle([
      row({ drinkLabel: "Older beer", sourceUrl: "https://old.example/menu", publisher: "Old", observedAt: "2026-09-01T10:00:00.000Z" }),
      row(),
      row({ drinkLabel: "Other equal-price beer", sourceUrl: "https://other.example/menu", publisher: "Other" }),
      row({ venueId: "venue-uk-manchester", priceGbp: 1 }),
      row({ venueId: "venue-half", priceGbp: 0.5, servingSize: "half" }),
      row({ venueId: "venue-estimate", priceGbp: 0.5, standing: "estimate", lane: "estimate", basis: "test", sampleSize: 40 }),
      row({ venueId: "venue-unnamed", priceGbp: 0.5, drinkLabel: undefined, servingSize: undefined }),
      row({ venueId: "venue-undated", priceGbp: 0.5, observedAt: "not a day" }),
      row({ venueId: "venue-unpublished", priceGbp: 0.5, publisher: null }),
      row({ venueId: "venue-wrong-branch", priceGbp: 0.5, sourceUrl: "https://chain.example/locations/barnsley/" }),
    ]);
    const { loadLondonHuntPints } = await import("@/lib/cheapestHunt.server");
    const pints = await loadLondonHuntPints();
    expect(pints.map((pint) => [pint.venueId, pint.priceGbp, pint.cityId])).toEqual([
      ["venue-uk-london", 3, "london"], ["venue-london", 4, "london"],
    ]);
    expect(pints[0]).toMatchObject({
      drinkLabel: "Selected lager", servingSize: "568ml", priceGbp: 3,
      publisher: { label: "Winner", url: "https://winner.example/menu" }, observedOn: "2026-10-02",
    });
    const shown = tonightCheapPints(tonightCheapPintCandidates(pints, new Map(), new Set()));
    expect(shown.map((pint) => pint.venueId)).toEqual(["venue-uk-london", "venue-london"]);
    expect(shown[0]).toMatchObject({
      drinkLabel: "Selected lager", servingSize: "568ml", priceGbp: 3,
      publisher: { label: "Winner", url: "https://winner.example/menu" }, observedAt: "2026-10-02T12:00:00.000Z",
    });
  });

  it.each([
    [" Selected lager ", undefined, "Selected lager", "pint"],
    [undefined, "568ml", null, "568ml"],
    ["   ", "pint", null, "pint"],
  ] as const)("normalises drink %s and serving %s on the selected row", async (drinkLabel, servingSize, drink, serving) => {
    setBundle([row({ drinkLabel, servingSize })]);
    const { loadLondonHuntPints } = await import("@/lib/cheapestHunt.server");
    expect((await loadLondonHuntPints())[0]).toMatchObject({
      venueId: "venue-uk-london", drinkLabel: drink, servingSize: serving,
      publisher: { label: "Winner", url: "https://winner.example/menu" }, observedOn: "2026-10-02",
    });
  });

  it("does not attach a quarantined menu item's drink to an eligible pint", async () => {
    setBundle([
      row(),
      row({
        priceGbp: 4.5, drinkLabel: "Pint Pint London Pride 4.1%",
        servingSize: "pint", sourceUrl: "https://theblacksmithsse16.com/drink",
        publisher: "The Blacksmiths", observedAt: "2026-10-03T10:00:00.000Z",
      }),
    ]);
    const { loadLondonHuntPints } = await import("@/lib/cheapestHunt.server");
    expect((await loadLondonHuntPints())[0]).toMatchObject({
      venueId: "venue-uk-london", priceGbp: 3, drinkLabel: "Selected lager", servingSize: "568ml",
      publisher: { label: "Winner", url: "https://winner.example/menu" }, observedOn: "2026-10-02",
    });
  });

  it("makes no London claim when the bundle read fails", async () => {
    reads.bundle.mockRejectedValue(new Error("bundle unavailable"));
    const { loadLondonHuntPints } = await import("@/lib/cheapestHunt.server");
    expect(await loadLondonHuntPints()).toEqual([]);
  });
});
