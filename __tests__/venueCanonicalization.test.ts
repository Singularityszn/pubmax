import { describe, it, expect } from "vitest";

import {
  canonicalizeDataset,
  clusterHasPostcodeConflict,
  hasOperatorSuffix,
  mergeAliasMaps,
  namesLikelySamePub,
  normalizeVenueIdentityName,
  postcodeOutward,
  significantNameTokens,
  stableVenueIdFromKey,
  VERIFIED_BORROWED_WEBSITES,
  venueGroupingKey,
} from "@/scripts/lib/venueCanonicalization.mjs";
import {
  groupVenuePrices,
  stableVenueIdFromKey as tsStableVenueIdFromKey,
  venueGroupingKey as tsVenueGroupingKey,
  type VenuePrice,
} from "@/lib/venues";
import { defined } from "@/__tests__/helpers/defined";

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
  price_gbp: 2.09, // the source row says £1.99, which is out of the pint band; this test is about the merge
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
    expect(prices).toEqual([2.09, 2.43]);
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
    expect(defined(venues[0]).name).toBe("The Rochester Castle");
    expect(defined(venues[0]).cheapestPrice).toBe(2.09); // cheapest across the union
    expect(defined(venues[0]).prices).toHaveLength(2); // both price rows preserved
  });
});

describe("canonicalizeDataset — safety guards", () => {
  it("keeps the verified Blackfriar identity when a third duplicate has more price rows", () => {
    const canonical = makeRow({
      pub_name: "The Blackfriar",
      address: "174 Queen Victoria St, Greater, London EC4V 4EG, UK",
      latitude: 51.5121, longitude: -0.103677, price_gbp: 6.5,
    });
    const duplicate = makeRow({
      pub_name: "The Black Friar, Blackfriars",
      address: "City of London, Greater London",
      latitude: 51.5121, longitude: -0.103751, price_gbp: null,
    });
    const richerDuplicate = makeRow({
      ...canonical,
      address: "174 Queen Victoria Street, London EC4V 4EG",
      longitude: -0.10369,
    });
    const extraPrice = { ...richerDuplicate, price_gbp: 7 };
    const result = canonicalizeDataset([canonical, duplicate, richerDuplicate, extraPrice]);

    expect(result.aliases).toEqual({
      "venue-1sw9ofl": "venue-eltcmh",
      "venue-119kvwe": "venue-eltcmh",
    });
    const venues = groupVenuePrices(result.rows);
    expect(venues).toHaveLength(1);
    expect(defined(venues[0]).id).toBe("venue-eltcmh");
    expect(result.rows.map((price) => price.price_gbp)).toEqual([6.5, null, 6.5, 7]);
  });
  it("keeps the priced Blackfriar identity and aliases its unpriced Wikipedia spelling", () => {
    const canonical = makeRow({
      pub_name: "The Blackfriar",
      address: "174 Queen Victoria St, Greater, London EC4V 4EG, UK",
      latitude: 51.5121, longitude: -0.103677, price_gbp: 6.5,
      source_datasets: "canonical_borough_leaderboard_enriched|borough_embedded_map_data_raw|individual_pub_page",
    });
    const duplicate = makeRow({
      pub_name: "The Black Friar, Blackfriars",
      address: "City of London, Greater London",
      latitude: 51.5121, longitude: -0.103751, price_gbp: null,
      source_datasets: "wikipedia_london_list",
    });
    expect(stableVenueIdFromKey(venueGroupingKey(canonical))).toBe("venue-eltcmh");
    expect(stableVenueIdFromKey(venueGroupingKey(duplicate))).toBe("venue-1sw9ofl");
    const result = canonicalizeDataset([canonical, duplicate]);
    expect(result.aliases).toEqual({ "venue-1sw9ofl": "venue-eltcmh" });
    expect(result.stats.venueIdentitiesAfter).toBe(1);
    expect(result.rows[0]).toEqual(canonical);
    expect(result.rows[1]).toEqual({
      ...duplicate,
      pub_name: canonical.pub_name, address: canonical.address,
      latitude: canonical.latitude, longitude: canonical.longitude,
    });
    expect(canonicalizeDataset(result.rows).aliases).toEqual({});
  });
  it("merges the verified Moon on the Square pair 177 m apart into its OSM pin", () => {
    const spoons = makeRow({
      pub_name: "The Moon on the Square - JD Wetherspoon",
      address: "Unit 30, The Centre, Feltham, TW13 4AU",
      latitude: 51.4452, longitude: -0.411801, price_gbp: 2.43,
      source_datasets: "borough_embedded_map_data_raw|individual_pub_page",
    });
    const osm = makeRow({
      pub_name: "The Moon on the Square",
      address: "30, High Street, Feltham, TW13 4AU",
      latitude: 51.4464358, longitude: -0.4101685, price_gbp: null,
      source_datasets: "outer_london_osm",
    });
    expect(stableVenueIdFromKey(venueGroupingKey(spoons))).toBe("venue-g9jxzs");
    expect(stableVenueIdFromKey(venueGroupingKey(osm))).toBe("venue-86sj0g");
    const result = canonicalizeDataset([spoons, { ...spoons, price_gbp: 3.73 }, osm]);
    expect(result.aliases).toEqual({ "venue-g9jxzs": "venue-86sj0g" });
    const venues = groupVenuePrices(result.rows);
    expect(venues).toHaveLength(1);
    expect(defined(venues[0]).id).toBe("venue-86sj0g");
    expect(result.rows.map((price) => price.price_gbp)).toEqual([2.43, 3.73, null]);
    expect(canonicalizeDataset(result.rows).aliases).toEqual({});
  });
  it("does not merge an unverified Moon on the Square record 177 m away", () => {
    const spoons = makeRow({
      pub_name: "The Moon on the Square - JD Wetherspoon",
      address: "Unit 31, The Centre, Feltham, TW13 4AU",
      latitude: 51.4452, longitude: -0.411801,
    });
    const osm = makeRow({
      pub_name: "The Moon on the Square",
      address: "30, High Street, Feltham, TW13 4AU",
      latitude: 51.4464358, longitude: -0.4101685, price_gbp: null,
    });
    expect(canonicalizeDataset([spoons, osm]).aliases).toEqual({});
  });

  it("joins the Young's 'Guardhouse' seed to the OSM 'Guard House' it duplicates", () => {
    // Both rows as committed in public/data/pint_prices_app_dataset.json.
    const osm = makeRow({
      pub_name: "The Guard House",
      address: "No 1 Street, London, SE18 6GH",
      latitude: 51.4918809, longitude: 0.0691701, price_gbp: null,
      source_datasets: "outer_london_osm",
    });
    const seed = makeRow({
      pub_name: "The Guardhouse",
      address: "No 1 Street, Plumstead, SE18 6GH, London",
      latitude: 51.49188, longitude: 0.06917, price_gbp: null,
      source_datasets: "london_chain_gazetteer_seed",
    });
    expect(stableVenueIdFromKey(venueGroupingKey(osm))).toBe("venue-9e93hd");
    expect(stableVenueIdFromKey(venueGroupingKey(seed))).toBe("venue-kkpnq8");
    const result = canonicalizeDataset([seed, osm]);
    expect(result.aliases).toEqual({ "venue-kkpnq8": "venue-9e93hd" });
    expect(groupVenuePrices(result.rows).map((venue) => venue.id)).toEqual(["venue-9e93hd"]);
    // The alias is for that pair only: the same spelling gap elsewhere stays two pubs.
    const elsewhere = canonicalizeDataset([
      { ...seed, address: "1 Other Road, London E1 1AA", latitude: 51.52, longitude: -0.07 },
      { ...osm, address: "1 Other Road, London E1 1AA", latitude: 51.52, longitude: -0.07 },
    ]);
    expect(elsewhere.aliases).toEqual({});
  });

  it("joins a verified pair past the fuzzy radius, and only that pair", () => {
    // Both rows as committed: 52.6 m apart, beyond the 45 m fuzzy radius.
    const kept = makeRow({
      pub_name: "The Trafalgar",
      address: "Park Row, London SE10 9NW",
      latitude: 51.4841, longitude: -0.0041379, price_gbp: 8.4,
    });
    const wikipedia = makeRow({
      pub_name: "Trafalgar Tavern",
      address: "Greenwich, Greater London",
      latitude: 51.484565, longitude: -0.004274, price_gbp: null,
    });
    expect(stableVenueIdFromKey(venueGroupingKey(kept))).toBe("venue-1lj3hj4");
    expect(stableVenueIdFromKey(venueGroupingKey(wikipedia))).toBe("venue-1clnw4x");
    expect(canonicalizeDataset([wikipedia, kept]).aliases).toEqual({ "venue-1clnw4x": "venue-1lj3hj4" });
    // The same two names at the same distance are not joined for anyone else.
    const elsewhere = canonicalizeDataset([
      { ...kept, address: "1 Other Road, London E1 1AA" },
      { ...wikipedia, address: "1 Other Road, London E1 1AA" },
    ]);
    expect(elsewhere.aliases).toEqual({});
  });

  describe("a verified misplaced record", () => {
    const pub = makeRow({
      pub_name: "The Marquis of Cornwallis",
      address: "304 Bethnal Green Rd, Bethnal Green, London E2 0AG",
      latitude: 51.5264, longitude: -0.0644607, price_gbp: 4.55,
      source_datasets: "canonical_borough_leaderboard_enriched|borough_embedded_map_data_raw|individual_pub_page",
    });
    const misplaced = makeRow({
      pub_name: "Maruquis of Cornwallis",
      address: "Bethnal Green Road",
      latitude: 51.5242, longitude: -0.0732748, price_gbp: 4.1,
      source_datasets: "canonical_borough_leaderboard_enriched|borough_embedded_map_data_raw",
    });

    it("folds the misspelt, misplaced Cornwallis into the pub at 304 Bethnal Green Road", () => {
      expect(stableVenueIdFromKey(venueGroupingKey(pub))).toBe("venue-1eyb3zz");
      expect(stableVenueIdFromKey(venueGroupingKey(misplaced))).toBe("venue-j71x23");
      const result = canonicalizeDataset([misplaced, pub]);
      expect(result.aliases).toEqual({ "venue-j71x23": "venue-1eyb3zz" });
      expect(result.rows[0]).toEqual({
        ...misplaced,
        pub_name: pub.pub_name, address: pub.address,
        latitude: pub.latitude, longitude: pub.longitude,
      });
      // The price the record carried stays its own.
      expect(result.rows[0]?.price_gbp).toBe(4.1);
      const venues = groupVenuePrices(result.rows);
      expect(venues.map((venue) => venue.id)).toEqual(["venue-1eyb3zz"]);
      expect(canonicalizeDataset(result.rows).aliases).toEqual({});
    });

    it("stops merging once either record is edited, because its id moves", () => {
      const withPostcode = { ...misplaced, address: "Bethnal Green Road, London E1 6LA" };
      expect(canonicalizeDataset([withPostcode, pub]).aliases).toEqual({});
      const movedPub = { ...pub, latitude: 51.5265 };
      expect(canonicalizeDataset([misplaced, movedPub]).aliases).toEqual({});
    });
  });

  describe("the postcode-only Three Colts Tavern", () => {
    const pub = makeRow({
      pub_name: "The Three Colts Tavern",
      address: "199 Cambridge Heath Rd, London E2 0EL",
      latitude: 51.5248, longitude: -0.0548784, price_gbp: 5.8,
    });
    const postcodeOnly = makeRow({
      pub_name: "Three Colts Tavern",
      address: "E2 0EL",
      latitude: 51.5262, longitude: -0.0556257, price_gbp: 5.5,
    });

    it("folds into the pub at 199 Cambridge Heath Road and keeps its old id resolvable", () => {
      expect(stableVenueIdFromKey(venueGroupingKey(pub))).toBe("venue-1g0y58p");
      expect(stableVenueIdFromKey(venueGroupingKey(postcodeOnly))).toBe("venue-1s1ffqx");
      const result = canonicalizeDataset([postcodeOnly, pub]);
      expect(result.aliases).toEqual({ "venue-1s1ffqx": "venue-1g0y58p" });
      expect(result.rows[0]?.price_gbp).toBe(5.5);
      expect(groupVenuePrices(result.rows).map((venue) => venue.id)).toEqual(["venue-1g0y58p"]);
    });
  });

  // The CSV the export reads still carries both links, so the pass that runs
  // straight after every export has to take them off again (Codex on #2187).
  describe("a verified borrowed website", () => {
    const owner = makeRow({
      app_price_id: "app_price_000346",
      pub_name: "The Marquis Cornwallis",
      address: "31 Marchmont St, Greater, London WC1N 1AP",
      latitude: 51.5246, longitude: -0.1247,
      website: "https://www.themarquiscornwalliswc1.co.uk/",
    });
    const namesake = makeRow({
      app_price_id: "app_price_000780",
      pub_name: "The Marquis of Cornwallis",
      address: "304 Bethnal Green Rd, Bethnal Green, London E2 0AG",
      latitude: 51.5264, longitude: -0.0644607,
      website: "https://www.themarquiscornwalliswc1.co.uk/#/",
    });

    it("comes off the namesake and stays on the pub it belongs to", () => {
      const result = canonicalizeDataset([owner, namesake]);
      expect(result.rows[0]?.website).toBe(owner.website);
      expect(result.rows[1]?.website).toBe("");
      expect(result.stats.borrowedWebsitesCleared).toBe(1);
      // Every other field of the namesake is its own.
      expect(result.rows[1]).toEqual({ ...namesake, website: "" });
    });

    it("clears the Goat Tavern page from Mayfair and keeps it in Kensington", () => {
      const site = "https://www.greeneking.co.uk/pubs/greater-london/goat-tavern";
      const kensington = makeRow({ pub_name: "Goat Tavern", address: "3a Kensington High Street, W8 5NP", latitude: 51.5017, longitude: -0.1849, website: site });
      const mayfair = makeRow({ pub_name: "The Goat Tavern", address: "3 Stafford St, London W1S 4RP", latitude: 51.5079, longitude: -0.1415, website: site });
      const result = canonicalizeDataset([kensington, mayfair]);
      expect(result.rows.map((row) => row.website)).toEqual([site, ""]);
    });

    it("leaves a different site, a near-miss URL and an empty website alone", () => {
      const ownSite = { ...namesake, website: "https://www.craftunionpubs.com/marquis-of-cornwallis-bethnal-green" };
      const mayfairOwn = makeRow({ pub_name: "The Goat Tavern", address: "3 Stafford St, London W1S 4RP", website: "https://www.greeneking-pubs.co.uk/pubs/greater-london/goat-tavern-mayfair/" });
      const none = { ...namesake, website: "" };
      const result = canonicalizeDataset([ownSite, mayfairOwn, none]);
      expect(result.rows).toEqual([ownSite, mayfairOwn, none]);
      expect(result.stats.borrowedWebsitesCleared).toBe(0);
    });

    it("names each site once, with the one postcode it belongs to", () => {
      const sites = VERIFIED_BORROWED_WEBSITES.map((entry) => entry.site);
      expect(new Set(sites).size).toBe(sites.length);
      for (const entry of VERIFIED_BORROWED_WEBSITES) {
        expect(entry.site).not.toMatch(/^https?:|^www\.|\/$/);
        expect(postcodeOutward(entry.ownerPostcode)).not.toBeNull();
      }
    });
  });

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

  it("does NOT transitively collapse an A-B-C chain when the endpoints exceed 100 m", () => {
    // A-B (~89 m) and B-C (~89 m) individually satisfy the merge predicate, but
    // A-C (~178 m) does not — single-link clustering must not chain all three
    // into one merged identity via B; C must stay a distinct venue.
    const a = makeRow({ pub_name: "The Anchor", latitude: 51.5, longitude: -0.1 });
    const b = makeRow({ pub_name: "The Anchor", latitude: 51.5008, longitude: -0.1 });
    const c = makeRow({ pub_name: "The Anchor", latitude: 51.5016, longitude: -0.1 });
    const cId = stableVenueIdFromKey(venueGroupingKey(c));

    const { aliases, stats } = canonicalizeDataset([a, b, c]);

    // At most the A-B pair merges; C is never folded into that cluster.
    expect(stats.duplicateClusters).toBeLessThanOrEqual(1);
    expect(Object.keys(aliases)).not.toContain(cId);
    expect(Object.values(aliases)).not.toContain(cId);
  });
});

describe("canonicalizeDataset — idempotency", () => {
  it("running canonicalization on its own output is a no-op (zero new clusters/aliases)", () => {
    const first = canonicalizeDataset([ROCHESTER_SEED, ROCHESTER_SPOONS]);
    expect(first.stats.duplicateClusters).toBe(1);

    const second = canonicalizeDataset(first.rows);
    expect(second.aliases).toEqual({});
    expect(second.stats.duplicateClusters).toBe(0);
    expect(second.stats.mergedRecords).toBe(0);
    expect(second.rows).toEqual(first.rows);
  });
});

describe("compareCanonical — address-completeness tiebreak", () => {
  it("prefers the record with a postcode as canonical when suffix/rows/sources/parens all tie", () => {
    const noPostcode = makeRow({
      pub_name: "The George",
      address: "1 High Street, England",
      latitude: 51.5,
      longitude: -0.1,
    });
    const withPostcode = makeRow({
      pub_name: "The George",
      address: "1 High Street, London E1 1AA",
      latitude: 51.500001,
      longitude: -0.1,
    });
    const noPostcodeId = stableVenueIdFromKey(venueGroupingKey(noPostcode));
    const withPostcodeId = stableVenueIdFromKey(venueGroupingKey(withPostcode));

    const { aliases, rows } = canonicalizeDataset([noPostcode, withPostcode]);

    expect(aliases).toEqual({ [noPostcodeId]: withPostcodeId });
    expect(rows.every((r) => r.address === "1 High Street, London E1 1AA")).toBe(true);
  });
});

describe("clusterHasPostcodeConflict", () => {
  it("flags a cluster whose members carry two different outward codes", () => {
    const a = { address: "1 High St, London N16 0NY" };
    const b = { address: "1 High St, London SW1A 1AA" };
    expect(clusterHasPostcodeConflict([a, b])).toBe(true);
  });

  it("does not flag a cluster where only one member (or none) carries a postcode", () => {
    const a = { address: "1 High St, England" };
    const b = { address: "1 High St, London N16 0NY" };
    expect(clusterHasPostcodeConflict([a, b])).toBe(false);
    expect(clusterHasPostcodeConflict([{ address: "no postcode here" }])).toBe(false);
  });
});

describe("canonicalizeDataset — postcode-bridge over-merge guard", () => {
  it("does NOT chain two postcode-conflicting records via a postcode-less bridge", () => {
    // Same normalized name, all within 100 m of each other. A (N16) and C (W1D)
    // have conflicting outward codes, so they are genuinely distinct pubs; B
    // carries no postcode. Pairwise A-B and B-C each satisfy looksSamePub (a
    // missing postcode never blocks), so a single-link/bridge cluster would
    // wrongly fold A, B and C together. The cluster-wide guard must keep the
    // two conflicting postcodes from ever landing in the same merged identity.
    const a = makeRow({
      pub_name: "The Bell",
      address: "1 Bell St, London N16 0NY",
      latitude: 51.5,
      longitude: -0.1,
    });
    const b = makeRow({
      pub_name: "The Bell",
      address: "1 Bell St, England",
      latitude: 51.5001,
      longitude: -0.1,
    });
    const c = makeRow({
      pub_name: "The Bell",
      address: "1 Bell St, London W1D 5DH",
      latitude: 51.5002,
      longitude: -0.1,
    });
    const aId = stableVenueIdFromKey(venueGroupingKey(a));
    const cId = stableVenueIdFromKey(venueGroupingKey(c));

    const { aliases } = canonicalizeDataset([a, b, c]);

    // The two conflicting-postcode records must never share a canonical id.
    const resolve = (id: string) => aliases[id] ?? id;
    expect(resolve(aId)).not.toBe(resolve(cId));
  });
});

describe("namesLikelySamePub + significantNameTokens", () => {
  it("strips generic descriptor tokens", () => {
    expect(significantNameTokens("kings head tavern")).toEqual(["kings", "head"]);
    expect(significantNameTokens("the wine bar")).toEqual(["wine"]);
    expect(significantNameTokens("ye olde cheshire cheese")).toEqual(["cheshire", "cheese"]);
  });

  it("matches identical names and rejects disjoint names", () => {
    expect(namesLikelySamePub("moon on the hill", "moon on the hill")).toBe(true);
    expect(namesLikelySamePub("red lion", "slug and lettuce")).toBe(false);
  });

  it("matches a name that is the other plus a qualifier suffix", () => {
    expect(namesLikelySamePub("kings head", "kings head tavern")).toBe(true);
    expect(namesLikelySamePub("coach and horses", "coach and horses pub")).toBe(true);
    expect(namesLikelySamePub("old hat", "old hat ealing")).toBe(true); // locality suffix
    expect(namesLikelySamePub("canonbury", "canonbury tavern")).toBe(true); // 1-token core + generic
  });

  it("rejects two distinct pubs sharing a locality but differing in type word", () => {
    // The real false-merge from the dataset: "New Cross Inn" and "The New Cross
    // House" are different pubs — neither full token set contains the other.
    expect(namesLikelySamePub("new cross inn", "new cross house")).toBe(false);
  });

  it("keeps a single shared distinctive token from collapsing distinct pubs", () => {
    // "The Bell" vs "The Bell and Crown" — the longer name adds a DISTINCTIVE
    // token ("crown"), so they are treated as different pubs.
    expect(namesLikelySamePub("bell", "bell and crown")).toBe(false);
    expect(namesLikelySamePub("crown", "crown and anchor")).toBe(false);
  });
});

describe("canonicalizeDataset — coordinate-drift + matching-ish name dedupe", () => {
  // The exact repro coverage-lane filed: an existing canonical priced venue and
  // an imported seed of the SAME pub whose coords drift ~56 m and round to a
  // different 4-dp key, slipping past a rounded-coord dedup and doubling the pin.
  const MOON_CANONICAL = makeRow({
    app_price_id: "app_price_moon_canon",
    pub_name: "The Moon on the Hill - JD Wetherspoon",
    price_gbp: 2.49,
    address: "373-375 Station Rd, Harrow HA1 2AW, UK",
    latitude: 51.5794,
    longitude: -0.3342,
    primary_borough: "Harrow",
    source_datasets: "canonical_borough_leaderboard_enriched|individual_pub_page",
  });
  const MOON_SEED = makeRow({
    app_price_id: "app_price_moon_seed",
    pub_name: "The Moon on the Hill",
    price_gbp: null,
    address: "Harrow, Greater London",
    latitude: 51.5795,
    longitude: -0.335,
    primary_borough: "Harrow",
    source_datasets: "outer_london_osm",
  });

  it("collapses the Moon on the Hill drift-duplicate into ONE venue", () => {
    const seedId = stableVenueIdFromKey(venueGroupingKey(MOON_SEED));
    const canonId = stableVenueIdFromKey(venueGroupingKey(MOON_CANONICAL));
    expect(seedId).not.toBe(canonId); // two identities before canonicalization

    const { aliases, stats, rows } = canonicalizeDataset([MOON_CANONICAL, MOON_SEED]);
    expect(stats.duplicateClusters).toBe(1);
    expect(stats.mergedRecords).toBe(1);
    expect(stats.venueIdentitiesAfter).toBe(1);
    // The clean, operator-suffix-free name wins as canonical (rule #1: never
    // surface "- JD Wetherspoon" as the pub name), so the suffixed record folds
    // onto the seed's clean identity — one venue either way.
    expect(aliases).toEqual({ [canonId]: seedId });
    expect(rows.every((r) => r.pub_name === "The Moon on the Hill")).toBe(true);
    // Both price rows survive untouched — the £2.49 canonical price is never lost
    // just because the unpriced seed row supplied the winning name.
    expect(rows.map((r) => r.price_gbp).sort()).toEqual([2.49, null]);
  });

  it("merges a matching-ish name a few doors along (Kings Head ↔ Kings Head Tavern)", () => {
    const a = makeRow({
      pub_name: "The Kings Head",
      address: "1 Market Pl, Kingston upon Thames",
      latitude: 51.4105,
      longitude: -0.3005,
      price_gbp: 4.8,
    });
    const b = makeRow({
      pub_name: "Kings Head Tavern",
      address: "Kingston upon Thames, Greater London",
      latitude: 51.41053,
      longitude: -0.30045,
      price_gbp: null,
      source_datasets: "outer_london_osm",
    });
    const { stats } = canonicalizeDataset([a, b]);
    expect(stats.duplicateClusters).toBe(1);
    expect(stats.mergedRecords).toBe(1);
  });

  it("does NOT fuzzy-merge a matching-ish name that is FAR apart", () => {
    // Same names as above but ~1 km apart — beyond the tight fuzzy radius.
    const a = makeRow({ pub_name: "The Kings Head", latitude: 51.41, longitude: -0.3, price_gbp: 4.8 });
    const b = makeRow({ pub_name: "Kings Head Tavern", latitude: 51.419, longitude: -0.3, price_gbp: null });
    const { stats } = canonicalizeDataset([a, b]);
    expect(stats.duplicateClusters).toBe(0);
  });

  it("does NOT fuzzy-merge two distinct nearby pubs sharing one generic-stripped token", () => {
    // "The Bell" and "The Bell and Crown" 20 m apart are different pubs.
    const bell = makeRow({ pub_name: "The Bell", latitude: 51.5, longitude: -0.1, price_gbp: 5 });
    const bellCrown = makeRow({
      pub_name: "The Bell and Crown",
      latitude: 51.50018,
      longitude: -0.1,
      price_gbp: 5,
    });
    const { stats } = canonicalizeDataset([bell, bellCrown]);
    expect(stats.duplicateClusters).toBe(0);
  });

  it("does NOT fuzzy-bridge two conflicting postcodes via a matching-ish name", () => {
    // Near-name, ~20 m apart, but N16 vs W1D — genuinely distinct pubs.
    const a = makeRow({
      pub_name: "Kings Head",
      address: "1 High St, London N16 0NY",
      latitude: 51.5,
      longitude: -0.1,
      price_gbp: 4,
    });
    const b = makeRow({
      pub_name: "Kings Head Tavern",
      address: "1 High St, London W1D 5DH",
      latitude: 51.50018,
      longitude: -0.1,
      price_gbp: null,
    });
    const aId = stableVenueIdFromKey(venueGroupingKey(a));
    const bId = stableVenueIdFromKey(venueGroupingKey(b));
    const { aliases } = canonicalizeDataset([a, b]);
    const resolve = (id: string) => aliases[id] ?? id;
    expect(resolve(aId)).not.toBe(resolve(bId));
  });

  it("re-running fuzzy canonicalization on its own output is a no-op", () => {
    const first = canonicalizeDataset([MOON_CANONICAL, MOON_SEED]);
    expect(first.stats.duplicateClusters).toBe(1);
    const second = canonicalizeDataset(first.rows);
    expect(second.stats.duplicateClusters).toBe(0);
    expect(second.aliases).toEqual({});
    expect(second.rows).toEqual(first.rows);
  });
});

describe("mergeAliasMaps — alias-prune with cycle detection", () => {
  it("carries forward a prior alias untouched by this run", () => {
    expect(mergeAliasMaps({ x: "y" }, { a: "b" })).toEqual({ x: "y", a: "b" });
  });

  it("rebases a prior alias through this run's new winner (multi-hop chain)", () => {
    // Prior run recorded b -> a; this run separately merges a -> c (a new,
    // richer record won). "b" must resolve through to the CURRENT canonical
    // id "c", not the now-stale "a".
    const merged = mergeAliasMaps({ b: "a" }, { a: "c" });
    expect(merged).toEqual({ a: "c", b: "c" });
  });

  it("drops a mapping that rebases into a cycle rather than persist it", () => {
    // Prior: a -> b. This run: b -> a (canonical choice flipped). Naively
    // spreading both maps would leave a live cycle (a -> b -> a); the prior
    // mapping must be dropped instead of poisoning alias resolution.
    const merged = mergeAliasMaps({ a: "b" }, { b: "a" });
    expect(merged).toEqual({ b: "a" });
  });

  it("this run's mapping always wins over a conflicting prior mapping for the same id", () => {
    const merged = mergeAliasMaps({ x: "stale" }, { x: "fresh" });
    expect(merged).toEqual({ x: "fresh" });
  });

  it("drops a pre-existing historical cycle carried in the prior map alone", () => {
    // A 2-cycle living entirely in the prior map, untouched by this run. The
    // traversal must follow the prior map too, or the cycle survives unnoticed.
    expect(mergeAliasMaps({ a: "b", b: "a" }, {})).toEqual({});
  });

  it("drops a longer historical cycle carried in the prior map alone", () => {
    expect(mergeAliasMaps({ a: "b", b: "c", c: "a" }, {})).toEqual({});
  });

  it("flattens a prior-only chain to its terminal id (single-hop resolve)", () => {
    // b -> a -> c in history; both must resolve straight to terminal c so a
    // single-hop lookup (lib/venueAliases.ts) never lands on a non-terminal id.
    expect(mergeAliasMaps({ b: "a", a: "c" }, {})).toEqual({ b: "c", a: "c" });
  });
});

// scripts/lib/venueCanonicalization.mjs's venueGroupingKey/stableVenueIdFromKey
// are a manually-mirrored copy of lib/venues.ts's (plain-Node scripts can't
// import the .ts runtime module). If the two implementations ever drift —
// e.g. a new field folded into one side's key but not the other's —
// canonicalization/validate-data would silently pass while runtime grouping
// computes a DIFFERENT venue identity, defeating the whole guarantee without
// erroring anywhere. This test fuzzes both implementations across varied
// inputs (including edge cases: mixed case, extra whitespace, unicode,
// boundary coordinates) and fails the moment they disagree, so a future
// one-sided edit is caught here instead of shipping silently.
describe("venueGroupingKey / stableVenueIdFromKey — parity with lib/venues.ts", () => {
  const cases: Array<Partial<VenuePrice>> = [
    {},
    { pub_name: "  The   ROCHESTER Castle  ", address: "12 High St" },
    { pub_name: "café münchen", address: "Straße 1, München" },
    { pub_name: "The Crown", latitude: 0, longitude: 0 },
    { pub_name: "The Crown", latitude: -51.5, longitude: 179.999999 },
    { pub_name: "", address: "" },
    { pub_name: "UPPER-Case-Pub", address: "Tab\tSeparated\nAddress" },
    { latitude: 51.500001, longitude: -0.099999 },
    { latitude: 51.5000049, longitude: -0.0999949 }, // rounds differently at 5dp boundary
  ];

  it.each(cases)("matches for row %#", (overrides) => {
    const row = makeRow(overrides);

    const scriptsKey = venueGroupingKey(row);
    const libKey = tsVenueGroupingKey(row);
    expect(scriptsKey).toBe(libKey);

    const scriptsId = stableVenueIdFromKey(scriptsKey);
    const libId = tsStableVenueIdFromKey(libKey);
    expect(scriptsId).toBe(libId);
  });
});
