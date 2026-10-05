import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  indexAppDataset,
  osmDatasetRow,
} from "@/scripts/lib/londonOsmDatasetRows.mjs";
import {
  PROMOTION_BATCH_CAP,
  resolveBatchLimit,
  selectPromotions,
} from "@/scripts/lib/londonOsmPromotion.mjs";

const ROOT = process.cwd();
const boundaries = JSON.parse(
  readFileSync(join(ROOT, "data/london_boroughs_simplified.json"), "utf8"),
);

// One point well inside Camden and one well inside Havering.
const CAMDEN = { lat: 51.5392, lng: -0.1426 };
const HAVERING = { lat: 51.5779, lng: 0.2121 };

function pub(osmId: string, name: string, point: { lat: number; lng: number }, extra = {}) {
  return {
    osmId,
    name,
    amenity: "pub",
    lat: point.lat,
    lng: point.lng,
    address: `${name}, London`,
    website: `https://${name.toLowerCase().replace(/[^a-z]/g, "")}.co.uk/`,
    ...extra,
  };
}

const none = () => false;

describe("the bounded London OSM promotion", () => {
  it("holds the batch ceiling in code at 300", () => {
    expect(PROMOTION_BATCH_CAP).toBe(300);
    expect(resolveBatchLimit(undefined)).toBe(300);
    expect(resolveBatchLimit(50)).toBe(50);
    expect(resolveBatchLimit(5_000)).toBe(300);
    expect(() => resolveBatchLimit(0)).toThrow(/--limit/);
    expect(() => resolveBatchLimit("many")).toThrow(/--limit/);
  });

  it("takes only pubs that state a website, are not curated, and are not a chain's", () => {
    const osm = [
      pub("node/1", "The Plain Pub", CAMDEN),
      pub("node/2", "No Site", CAMDEN, { website: null }),
      pub("node/3", "Owned Already", CAMDEN, { curatedRef: { source: "curated-london-slim", id: "v" } }),
      pub("node/4", "Spoons Branch", CAMDEN, { website: "https://www.jdwetherspoon.com/pubs/x/" }),
      pub("node/5", "Not In London", { lat: 53.48, lng: -2.24 }),
      pub("node/6", "Bad Site", CAMDEN, { website: "not a url" }),
    ];
    const { picked, eligible } = selectPromotions(osm, [], { boundaries, isDuplicate: none });

    expect(picked.map((p) => p.pub.osmId)).toEqual(["node/1"]);
    expect(eligible).toBe(1);
  });

  it("never exceeds the cap or the requested limit", () => {
    const osm = Array.from({ length: 40 }, (_, i) =>
      pub(`node/${100 + i}`, `Pub ${String.fromCharCode(97 + (i % 26))}${i}`, CAMDEN),
    );
    expect(selectPromotions(osm, [], { boundaries, isDuplicate: none, limit: 7 }).picked).toHaveLength(7);
    expect(selectPromotions(osm, [], { boundaries, isDuplicate: none, limit: 9_999 }).picked).toHaveLength(40);
  });

  it("spreads the batch across boroughs, thinnest curated borough first", () => {
    const osm = [
      pub("node/10", "Camden One", CAMDEN),
      pub("node/11", "Camden Two", CAMDEN),
      pub("node/20", "Havering One", HAVERING),
      pub("node/21", "Havering Two", HAVERING),
    ];
    const app = Array.from({ length: 5 }, () => ({ primary_borough: "Camden" }));
    const { picked } = selectPromotions(osm, app, { boundaries, isDuplicate: none });

    expect(picked.map((p) => p.borough)).toEqual(["Havering", "Camden", "Havering", "Camden"]);
  });

  it("skips what the dataset already holds", () => {
    const osm = [pub("node/1", "Held Already", CAMDEN), pub("node/2", "Fresh Pub", CAMDEN)];
    const { picked } = selectPromotions(osm, [], {
      boundaries,
      isDuplicate: (id: string) => id === "node/1",
    });
    expect(picked.map((p) => p.pub.osmId)).toEqual(["node/2"]);
  });

  it("writes an unpriced row that names its OSM id, read time and licence", () => {
    const row = osmDatasetRow({
      seq: 7,
      pub: pub("node/99", "Evidence Arms", CAMDEN),
      borough: "Camden",
      fetchedAt: "2026-10-02T10:12:37.575Z",
      attribution: "© OpenStreetMap contributors",
      dataset: "london_osm_promotion",
      label: "London OSM promotion.",
    });

    expect(row.price_gbp).toBeNull();
    expect(row.app_price_id).toBe("app_price_000007");
    expect(row.website).toBe("https://evidencearms.co.uk/");
    expect(row.comment).toContain("node/99");
    expect(row.comment).toContain("© OpenStreetMap contributors");
    expect(row.data_quality_notes).toBe("london_osm_promotion|osm_overpass|node/99|sourced");
    expect(indexAppDataset([row]).isDuplicate("node/99", "Other", 0, 0)).toBe(true);
  });
});

describe("the committed promotion keeps its evidence", () => {
  const ledger = JSON.parse(
    readFileSync(join(ROOT, "data/london_osm_promotion/ledger.json"), "utf8"),
  ) as {
    source: string;
    licence: string;
    promotions: Array<Record<string, unknown>>;
  };
  const app = JSON.parse(
    readFileSync(join(ROOT, "public/data/pint_prices_app_dataset.json"), "utf8"),
  ) as Array<Record<string, unknown>>;
  const byId = new Map(app.map((row) => [row.app_price_id, row]));

  it("names its source and licence", () => {
    expect(ledger.source).toBe("OpenStreetMap");
    expect(ledger.licence).toBe("ODbL 1.0");
  });

  it("is about 300 pubs and one batch never passes the cap", () => {
    expect(ledger.promotions.length).toBeGreaterThan(250);
    expect(ledger.promotions.length).toBeLessThanOrEqual(PROMOTION_BATCH_CAP);
  });

  it("gives every promoted pub an OSM id, its own website, a read time and an unpriced dataset row", () => {
    for (const entry of ledger.promotions) {
      expect(entry.osmId).toMatch(/^(node|way|relation)\/\d+$/);
      expect(String(entry.website)).toMatch(/^https?:\/\//);
      expect(Number.isFinite(Date.parse(String(entry.packFetchedAt)))).toBe(true);
      expect(Number.isFinite(Date.parse(String(entry.promotedAt)))).toBe(true);
      const row = byId.get(entry.appPriceId);
      expect(row, String(entry.name)).toBeDefined();
      expect(row?.price_gbp).toBeNull();
      expect(row?.source_datasets).toBe("london_osm_promotion");
      expect(String(row?.data_quality_notes)).toContain(String(entry.osmId));
    }
  });
});
