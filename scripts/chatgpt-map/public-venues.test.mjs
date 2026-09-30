import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { LONDON_BOROUGHS, publicVenuesInArea } from "./public-venues.mjs";
import { priceBand, priceBandThresholdsFor } from "../../lib/priceBand.ts";

const price = (overrides = {}) => ({
  pub_name: "Test pub", address: "Test street", latitude: 51.5, longitude: -0.1,
  primary_borough: "Camden", pint_name: "Cask ale", price_gbp: 4.2,
  app_price_id: "listed-1", boroughs_visible: "Camden", source_datasets: "",
  data_quality_notes: "", pub_url: "https://www.pint-prices.com/pub/test",
  secret: "must-not-leave", friendLocation: { latitude: 1, longitude: 2 },
  ...overrides,
});

test("returns an explicit public whitelist and the price record's publisher", () => {
  const [venue] = publicVenuesInArea([price()], "Camden");
  assert.deepEqual(Object.keys(venue).sort(), ["area", "href", "id", "latitude", "longitude", "name", "prices"]);
  assert.equal(venue.prices[0].publisher.label, "Pint Prices");
  assert.equal(new URL(venue.href).searchParams.get("sel"), venue.id);
  assert.equal(new URL(venue.href).searchParams.has("pub"), false);
  assert.ok(!JSON.stringify(venue).includes("must-not-leave"));
  assert.ok(!JSON.stringify(venue).includes("friendLocation"));
});

test("does not infer a publisher from a venue website or retire a superseded price as live", () => {
  const [venue] = publicVenuesInArea([price({ pub_url: "", website: "https://operator.test" }), price({ price_gbp: 2, price_superseded: {} })], "Camden");
  assert.equal(venue.prices.length, 1);
  assert.equal(venue.prices[0].publisher, null);
  assert.equal(venue.prices[0].priceGbp, 4.2);
});

test("filters invalid coordinates and wrong primary borough, bounds results", () => {
  assert.equal(publicVenuesInArea([price({ latitude: NaN }), price({ primary_borough: "Westminster" }), price({ primary_borough: 9 })], "Camden").length, 0);
  assert.throws(() => publicVenuesInArea([price()], "Camden", 31));
  assert.throws(() => publicVenuesInArea([price()], ""));
});

test("accepts only the dataset's exact borough names", async () => {
  const rows = JSON.parse(await readFile(new URL("../../public/data/pint_prices_app_dataset.json", import.meta.url), "utf8"));
  assert.deepEqual([...new Set(rows.map((row) => row.primary_borough))].sort(), [...LONDON_BOROUGHS].sort());
  assert.equal(LONDON_BOROUGHS.length, 33);
  for (const area of ["camden", "Soho", "Kensington & Chelsea", "City of Westminster"]) {
    assert.throws(() => publicVenuesInArea([price()], area), TypeError, area);
  }
});

test("listed pint rows carry the shared London price band", () => {
  const area = { city: "london" };
  const thresholds = priceBandThresholdsFor(area);
  for (const value of [thresholds.cheapMaxGbp, thresholds.averageMaxGbp, thresholds.averageMaxGbp + 0.5]) {
    const [venue] = publicVenuesInArea([price({ price_gbp: value })], "Camden");
    assert.equal(venue.prices[0].band, priceBand(value, area));
  }
});
