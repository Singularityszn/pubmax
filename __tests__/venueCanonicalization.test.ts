import { describe, it, expect } from "vitest";

import {
  canonicalizeDataset,
  hasOperatorSuffix,
  normalizeVenueIdentityName,
  postcodeOutward,
  stableVenueIdFromKey,
  venueGroupingKey,
} from "@/scripts/lib/venueCanonicalization.mjs";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

// A row factory mirroring __tests__/venues.test.ts so canonicalized rows can be
// fed straight into groupVenuePrices for the regression assertion.
function makeRow(overrides: Partial<VenuePrice> = {}): VenuePrice {
  return {
    app_price_id: "",
    pub_name: "The Test Arms",
    pint_name: "Lager",
    price_gbp: 6,
    price_text: "",
    address: "1 Test Street",
    latitude: 51.5,
    longitude: -0.1,
    boroughs_visible: "",
    boroughs_raw_embedded_non_anomaly: "",
    boroughs_raw_embedded_site_anomaly: "",
    primary_borough: "Camden",
    rank_visible_borough: "",
    estimated_average_price_text: "",
    pub_url: "",
    constructed_pub_url: "",
    borough_urls: "",
    phone_number: "",
    email: "",
    website: "",
    booking_link: "",
    image_url: "",
    description: "",
    comment: "",
    food: "",
    cocktails: "",
    beer_garden: "",
    live_sports: "",
    live_music: "",
    pub_quiz: "",
    darts: "",
    pool: "",
    happy_hour: "",
    karaoke: "",
    cool: "",
    source_datasets: "",
    source_row_count: 1,
    has_visible_borough_row: false,
    has_raw_embedded_map_row: false,
    has_individual_pub_page_row: false,
    is_clean_canonical_app_row: true,
    data_quality_notes: "",
    ...overrides,
  };
}

// The verified real-world duplicate pair: the same Stoke Newington pub carried
// twice — a seed record and a Wetherspoons-directory record — with different
// addresses, geocodes and price sets.
const ROCHESTER_SEED = makeRow({
  app_price_id: "app_price_001091",
  pub_name: "The Rochester Castle",
  pint_name: "BUD LIGHT",
  price_gbp: 1.99,
  address: "143-145 Stoke Newington High Street, , Stoke Newington, England",
  latitude: 51.561,
  longitude: -0.073976,
  primary_borough: "Hackney",
  source_datasets: "canonical_borough_leaderboard_enriched|borough_embedded_map_data_raw",
});
const ROCHESTER_SPOONS = makeRow({
  app_price_id: "app_price_001099",
  pub_name: "The Rochester Castle - JD Wetherspoon",
  pint_name: "BUD LIGHT",
  price_gbp: 2.43,
  address: "143-145 Stoke Newington High St, London N16 0NY, UK",
  latitude: 51.5609,
  longitude: -0.074042,
  primary_borough: "Hackney",
  source_datasets:
    "canonical_borough_leaderboard_enriched|borough_embedded_map_data_raw|individual_pub_page",
});

describe("normalizeVenueIdentityName", () => {
  it("collapses the Wetherspoons lineage onto the clean pub name", () => {
    expect(normalizeVenueIdentityName("The Rochester Castle")).toBe("rochester castle");
    expect(normalizeVenueIdentityName("The Rochester Castle - JD Wetherspoon")).toBe(
      "rochester castle",
    );
    expect(normalizeVenueIdentityName("The Furze Wren (Wetherspoons)")).toBe("furze wren");
  });

  it("drops locality qualifiers and folds punctuation / articles", () => {
    expect(normalizeVenueIdentityName("George (Southwark)")).toBe("george");
    expect(normalizeVenueIdentityName("The George")).toBe("george");
    expect(normalizeVenueIdentityName("Hope & Anchor")).toBe("hope and anchor");
    expect(normalizeVenueIdentityName("McGlynn’s Free House")).toBe(
      normalizeVenueIdentityName("McGlynn's Free House"),
    );
  });
});

describe("hasOperatorSuffix", () => {
  it("flags brewery/operator marketing suffixes only", () => {
    expect(hasOperatorSuffix("The Rochester Castle - JD Wetherspoon")).toBe(true);
    expect(hasOperatorSuffix("The Furze Wren (Wetherspoons)")).toBe(true);
    expect(hasOperatorSuffix("The Rochester Castle")).toBe(false);
    expect(hasOperatorSuffix("George (Southwark)")).toBe(false);
  });
});

describe("postcodeOutward", () => {
  it("extracts the outward code, or null when absent", () => {
    expect(postcodeOutward("143-145 Stoke Newington High St, London N16 0NY, UK")).toBe("N16");
    expect(postcodeOutward("29 Greek St, London W1D 5DH")).toBe("W1D");
    expect(postcodeOutward("143-145 Stoke Newington High Street, , Stoke Newington, England")).toBe(
      null,
    );
  });
});

describe("canonicalizeDataset — Rochester Castle merge", () => {
  it("merges the pair into the clean-named canonical id with an alias", () => {
    const seedKey = venueGroupingKey(ROCHESTER_SEED);
    const spoonsKey = venueGroupingKey(ROCHESTER_SPOONS);
    const seedId = stableVenueIdFromKey(seedKey);
    const spoonsId = stableVenueIdFromKey(spoonsKey);
    expect(seedId).not.toBe(spoonsId); // two identities before canonicalization

    const { rows, aliases, stats } = canonicalizeDataset([ROCHESTER_SEED, ROCHESTER_SPOONS]);

    // The clean seed name (no operator suffix) wins as canonical.
    expect(aliases).toEqual({ [spoonsId]: seedId });
    expect(stats.duplicateClusters).toBe(1);
    expect(stats.mergedRecords).toBe(1);
    expect(stats.venueIdentitiesAfter).toBe(1);

    // Both rows now carry the canonical identity fields...
    expect(rows.every((r) => r.pub_name === "The Rochester Castle")).toBe(true);
    expect(rows.every((r) => r.latitude === 51.561 && r.longitude === -0.073976)).toBe(true);
    // ...but each keeps its own price + provenance (no averaging, no invention).
    const prices = rows.map((r) => r.price_gbp).sort((a, b) => (a ?? 0) - (b ?? 0));
    expect(prices).toEqual([1.99, 2.43]);
    const spoonsRow = rows.find((r) => r.app_price_id === "app_price_001099")!;
    expect(spoonsRow.source_datasets).toContain("individual_pub_page");
    expect(spoonsRow.price_gbp).toBe(2.43);
  });

  it("regression: grouping the canonicalized rows yields ONE venue, never two", () => {
    const { rows } = canonicalizeDataset([ROCHESTER_SEED, ROCHESTER_SPOONS]);
    const venues = groupVenuePrices(rows);

    expect(venues).toHaveLength(1);
    const ids = venues.map((v) => v.id);
    expect(new Set(ids).size).toBe(ids.length); // no two entries share a canonical id
    expect(venues[0].name).toBe("The Rochester Castle");
    expect(venues[0].cheapestPrice).toBe(1.99); // cheapest across the union
    expect(venues[0].prices).toHaveLength(2); // both price rows preserved
  });
});

describe("canonicalizeDataset — safety guards", () => {
  it("does NOT merge same-named pubs with conflicting postcodes (bad coords)", () => {
    // Two "Coach & Horses" mis-geocoded within 100 m but in different postcode
    // areas (Soho W1D vs Rickmansworth WD3) — genuinely distinct pubs.
    const soho = makeRow({
      pub_name: "The Coach & Horses",
      address: "29 Greek St, London W1D 5DH",
      latitude: 51.5133,
      longitude: -0.130129,
    });
    const rickmansworth = makeRow({
      pub_name: "The Coach & Horses",
      address: "Rickmansworth WD3 1ER",
      latitude: 51.5139,
      longitude: -0.129688,
    });
    const { aliases, stats } = canonicalizeDataset([soho, rickmansworth]);
    expect(aliases).toEqual({});
    expect(stats.duplicateClusters).toBe(0);
  });

  it("does NOT merge same-named pubs more than 100 m apart", () => {
    const a = makeRow({ pub_name: "The Crown", latitude: 51.5, longitude: -0.1 });
    const b = makeRow({ pub_name: "The Crown", latitude: 51.52, longitude: -0.1 }); // ~2.2 km
    const { aliases, stats } = canonicalizeDataset([a, b]);
    expect(aliases).toEqual({});
    expect(stats.duplicateClusters).toBe(0);
  });

  it("leaves a duplicate-free dataset untouched (idempotent shape)", () => {
    const rows = [makeRow({ pub_name: "The Solo Arms", address: "1 Only Rd, London E1 1AA" })];
    const { rows: out, aliases, stats } = canonicalizeDataset(rows);
    expect(aliases).toEqual({});
    expect(stats.venueIdentitiesAfter).toBe(1);
    expect(out).toEqual(rows);
  });
});
