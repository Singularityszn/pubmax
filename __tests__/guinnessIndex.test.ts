import { describe, expect, it, vi } from "vitest";
import { buildGuinnessIndex } from "@/lib/guinnessIndex";
import { loadGuinnessIndex } from "@/lib/guinnessIndex.server";
import { loadPintPriceLandingVenues } from "@/lib/pintPriceLandingDataset.server";
import type { Venue, VenuePrice } from "@/lib/venues";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/pintPriceLandingDataset.server", () => ({ loadPintPriceLandingVenues: vi.fn() }));

const row = (venueId: string, priceGbp: number, borough = "Camden") => ({
  venueId, venueName: venueId, borough, priceGbp,
  publisher: { label: "Example", url: "https://example.com" },
  observedAt: "2026-01-01",
});

describe("Guinness index", () => {
  it.each([
    { pint_name: "Guinness 0.0" },
    { pint_name: "Guinness 0%" },
    { pint_name: "Guinness AF" },
    { pint_name: "Guinness Zero Alcohol" },
    { pint_name: "Guinness half pint", measure: "half-pint" },
    { pint_name: "Guinness 330ml bottle" },
    { pub_url: "" },
    { scraped_at_values: "" },
    { scraped_at_values: "2999-01-01" },
  ])("retains the cheapest eligible pint when a cheaper row is ineligible: %j", async (invalid) => {
    const price = (priceGbp: number, overrides: Partial<VenuePrice> = {}) => ({
      app_price_id: String(priceGbp), pint_name: "Guinness", measure: "pint", price_gbp: priceGbp,
      pub_url: "https://example.com/menu", scraped_at_values: "2026-01-01", ...overrides,
    } as VenuePrice);
    const venues = Array.from({ length: 10 }, (_, i) => ({
      id: String(i), name: `Pub ${i}`, primaryBorough: "Camden",
      prices: i === 9 ? [price(3, invalid), price(9), price(10)] : [price(4 + i / 2)],
    } as Venue));
    venues.push({
      id: "ineligible-only", name: "Ineligible Pub", primaryBorough: "Brent",
      prices: [price(2, invalid)],
    } as Venue);
    vi.mocked(loadPintPriceLandingVenues).mockResolvedValue(venues);

    // Ten eligible pubs priced at 4, 4.5, ..., 8 and 9 have middle prices 6 and 6.5.
    const index = await loadGuinnessIndex();
    expect(index).toMatchObject({ count: 10, medianGbp: 6.25 });
    expect(index.dearest).toMatchObject({ venueId: "9", priceGbp: 9, publisher: { label: "example.com" }, observedAt: "2026-01-01T00:00:00.000Z" });
    expect(index.boroughs).toMatchObject([{ name: "Camden", count: 10, medianGbp: 6.25 }]);
  });

  it("counts each pub once and withholds thin borough medians", () => {
    const rows = Array.from({ length: 10 }, (_, i) => row(String(i), i + 1));
    const index = buildGuinnessIndex([...rows, row("0", 9), row("other", 20, "Brent")]);
    expect(index.count).toBe(11);
    expect(index.medianGbp).toBe(6);
    expect(index.cheapest?.priceGbp).toBe(1);
    expect(index.dearest?.priceGbp).toBe(20);
    expect(index.boroughs.find((area) => area.name === "Camden")).toMatchObject({ count: 10, medianGbp: 5.5 });
    expect(index.boroughs.find((area) => area.name === "Brent")).toMatchObject({ count: 1, medianGbp: null });
  });
  it("withholds the London median when the sample is thin", () => {
    expect(buildGuinnessIndex([row("one", 5)])).toMatchObject({ count: 1, medianGbp: null });
  });
  it("does not invent an answer when no prices exist", () => {
    expect(buildGuinnessIndex([])).toMatchObject({ count: 0, medianGbp: null, cheapest: null, dearest: null });
  });
});
