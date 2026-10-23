import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { initialFilters } from "@/components/map/ControlRail";
import { pubsToGeoJSON } from "@/components/map/canvas/geojson";
import type { VenueSignal } from "@/components/map/canvas/types";
import { filterMapVenues } from "@/lib/filterMapVenues";
import { projectMapPintPrices } from "@/lib/mapPintPrices";
import { buildMapVenueListModel } from "@/lib/mapVenueList";
import { mergePriceUpdates } from "@/lib/priceUpdates";
import { venueUpdateKey } from "@/lib/pubMap";
import { slimVenueToPin } from "@/lib/slimPins";
import { bundleRowsByVenue, parseUkPriceBundleRows, type UkPriceBundleRow } from "@/lib/ukPriceBundle";
import { venueBundlePrices, venuePriceLane, venueSourcedPrice } from "@/lib/venuePriceLane";
import type { SlimVenue } from "@/lib/venuesSlim";
import { defined } from "@/__tests__/helpers/defined";

const now = Date.parse("2026-10-23T20:00:00Z");
const pack: { rows: SlimVenue[] } = JSON.parse(readFileSync("public/data/venues_slim.json", "utf8"));
const small = slimVenueToPin(defined(pack.rows.find((row) => row.id === "venue-19mn6ss")));
const rows = parseUkPriceBundleRows(JSON.parse(readFileSync("public/data/uk_prices/rows.json", "utf8")));
const menu = defined(rows.find((row) => row.venueId === small.id && row.priceGbp === 5 && row.category === "beer"));
const noSignals = new Map<string, VenueSignal>();

function project(bundle: readonly UkPriceBundleRow[] = rows, signals = noSignals) {
  return projectMapPintPrices([small], bundleRowsByVenue(bundle), signals, "london", now);
}

describe("published pint evidence before map consumers", () => {
  it("uses Small Beer's supported winner for pins, cluster minima, caps, sorting and dated evidence", () => {
    const projected = project();
    const venue = defined(projected[0]);
    expect(venue.cheapestPrice).toBe(5);
    expect(venue.priceObservedAt).toBe("2026-10-23T16:15:47.970Z");
    expect(venuePriceLane(venue, null, venueSourcedPrice(venue), venueBundlePrices(venue), undefined, undefined, undefined, now))
      .toMatchObject({ lane: "listed", listed: { priceGbp: 5, sourceUrl: "https://www.smallbeern8.co.uk/drinks", observedAt: "2026-10-23T16:15:47.970Z" } });
    const pin = pubsToGeoJSON(projected, noSignals, null, null, null, null, null, null, null, now).features[0]?.properties;
    expect(pin).toMatchObject({ priceLabel: "£5", clusterPrice: 5, bucket: 0 });
    expect(pin).not.toHaveProperty("aging");
    expect(filterMapVenues(projected, { ...initialFilters, maxPrice: 5.25 }, () => false).map(({ id }) => id)).toEqual([small.id]);
    const rival = { ...small, id: "venue-rival", name: "Rival", cheapestPrice: 5.25 };
    const model = buildMapVenueListModel([rival, venue], null, 2, null, "pints", "ready", "cheapest");
    expect(model.rows.map(({ id }) => id)).toEqual([small.id, rival.id]);
  });

  it("keeps corroborated contributors above listed and sourced observations", () => {
    const signals = new Map([[small.id, { hasPintDrops: true, latestContributorPrice: 4.6, latestContributorAt: now }]]);
    const projected = project(rows, signals);
    expect(projected[0]?.cheapestPrice).toBe(4.6);
    expect(projected[0]?.priceObservedAt).toBe("2026-10-23T20:00:00.000Z");
    expect(pubsToGeoJSON(projected, signals, null).features[0]?.properties)
      .toMatchObject({ priceLabel: "£4.60", clusterPrice: 4.6 });
    expect(filterMapVenues(projected, { ...initialFilters, maxPrice: 4.75 }, () => true)).toHaveLength(1);
  });

  it("retains a supported sourced winner and falls back after failed bundle reads", () => {
    const sourced = mergePriceUpdates([small], [{ venueKey: venueUpdateKey(small), price: 4.8,
      source: { label: "Pub website", url: "https://example.com/drinks" }, observedAt: "2026-10-23T16:00:00Z" }], venueUpdateKey);
    const projected = projectMapPintPrices(sourced, bundleRowsByVenue(rows), noSignals, "london", now);
    expect(projected[0]?.cheapestPrice).toBe(4.8);
    expect(projected[0]?.priceObservedAt).toBe("2026-10-23T16:00:00Z");
    expect(project([])[0]?.cheapestPrice).toBe(5.5);
    expect(pubsToGeoJSON(project([]), noSignals, null).features[0]?.properties)
      .toMatchObject({ priceLabel: "£5.50", clusterPrice: 5.5 });
  });

  it("does not promote estimates, future rows, other categories, venues or cities", () => {
    for (const row of [
      { ...menu, venueId: "another-pub" }, { ...menu, category: "wine" },
      { ...menu, observedAt: "2099-01-01T12:00:00Z" }, { ...menu, observedAt: "2020-01-01T12:00:00Z" },
      { ...menu, standing: "estimate" as const, basis: "modelled", sampleSize: 15, sourceUrl: null },
    ]) expect(project([row])[0]?.cheapestPrice).toBe(5.5);
    expect(projectMapPintPrices([small], bundleRowsByVenue(rows), noSignals, "manchester", now)[0]).toBe(small);
    const bar = { ...small, kind: "bar" as const, anchorLabel: "Cocktail", priceSource: "anchor" };
    expect(projectMapPintPrices([bar], bundleRowsByVenue(rows), noSignals, "london", now)[0]).toBe(bar);
    const provisional = new Map([[small.id, { hasPintDrops: true, latestContributorPrice: null, provisionalContributorPrice: 3 }]]);
    expect(project([menu], provisional)[0]?.cheapestPrice).toBe(5);
  });

  it("preserves favorite-pint matching and category lens figures", () => {
    const projected = project();
    const favoriteVenues = projectMapPintPrices([small], bundleRowsByVenue(rows), noSignals, "london", now, "guinness");
    const favorite = pubsToGeoJSON(favoriteVenues, noSignals, "guinness").features[0]?.properties;
    expect(favorite).toEqual(pubsToGeoJSON([small], noSignals, "guinness").features[0]?.properties);
    const lens = new Map([[small.id, { venueId: small.id, category: "wine" as const,
      categoryLabel: "Wine", priceGbp: 7.5, source: "community" as const }]]);
    expect(pubsToGeoJSON(projected, noSignals, null, "wine", null, null, lens).features[0]?.properties)
      .toMatchObject({ priceLabel: "£7.50 Wine" });
    expect(pubsToGeoJSON(projected, noSignals, null, "wine", null, null, lens).features[0]?.properties)
      .not.toHaveProperty("clusterPrice");
  });
});
