import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { parseUkBaseShard } from "@/lib/ukBasePubs";
import { buildUkBasePubListModel } from "@/lib/mapVenueList";
import { outerLondonOwnerForPub } from "@/lib/outerLondonOwnership.mjs";
import { defined } from "@/__tests__/helpers/defined";

// The UK base layer carries `amenity=pub` AND `amenity=bar`. Both packs are
// committed (data/osm/uk/VENUES.md), so these fences read the shipped files
// rather than a fixture: a seed that shrinks, a cell that outgrows one
// viewport fetch, or a bar that loses its kind are the three ways this layer
// goes wrong without anybody seeing it.

const ROOT = path.resolve(__dirname, "..");
const PUB_PACK = path.join(ROOT, "data", "osm", "uk", "uk_osm_pubs.json");
const DRINK_PACK = path.join(ROOT, "data", "osm", "uk", "uk_osm_venues_drink.json");
const UK_BASE_DIR = path.join(ROOT, "public", "data", "uk_base");

// The floors are the shipped counts rounded down, not targets. A refresh may
// add pubs; a refresh that LOSES a thousand of them is a broken pull.
const MIN_SEED_PUBS = 38_000;
const MIN_SEED_BARS = 7_000;
// One cell is one viewport-triggered fetch, so this mirrors the builder's own
// ceiling (scripts/build_uk_base_shards.mjs). It comes down, never up.
const SHARD_BUDGET_BYTES = 150 * 1024;

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(readFileSync(file, "utf8"));
}

function shardFiles(): { dir: string; files: string[] } {
  const manifest = readJson(path.join(UK_BASE_DIR, "manifest.json"));
  const urlPrefix = String(manifest.urlPrefix);
  const dir = path.join(UK_BASE_DIR, urlPrefix.replace("/data/uk_base/", ""));
  return { dir, files: readdirSync(dir).filter((name) => name.endsWith(".json")) };
}

describe("UK seed counts", () => {
  it("keeps every scraped UK pub in the committed seed", () => {
    const pack = readJson(PUB_PACK);
    const pubs = pack.pubs as unknown[];
    expect(Array.isArray(pubs)).toBe(true);
    expect(pubs.length).toBeGreaterThanOrEqual(MIN_SEED_PUBS);
    expect(pack.count).toBe(pubs.length);
  });

  it("keeps every scraped UK bar in the committed drink seed", () => {
    const pack = readJson(DRINK_PACK);
    const venues = pack.venues as Array<{ kind?: string }>;
    const bars = venues.filter((venue) => venue.kind === "bar");
    expect(bars.length).toBeGreaterThanOrEqual(MIN_SEED_BARS);
  });
});

describe("UK base shards", () => {
  it("ships the pubs and the bars, and the manifest says so", () => {
    const manifest = readJson(path.join(UK_BASE_DIR, "manifest.json"));
    const shards = manifest.shards as Array<{ count: number }>;
    const shipped = shards.reduce((total, shard) => total + shard.count, 0);
    const generatedFrom = manifest.generatedFrom as {
      count?: number;
      pubs?: number;
      bars?: number;
    };
    expect(generatedFrom.pubs).toBeGreaterThanOrEqual(MIN_SEED_PUBS);
    expect(generatedFrom.bars).toBeGreaterThanOrEqual(MIN_SEED_BARS);
    expect(generatedFrom.count).toBe(shipped);
  });

  it("holds every cell under one viewport fetch", () => {
    const { dir, files } = shardFiles();
    const over = files
      .map((name) => ({ name, bytes: statSync(path.join(dir, name)).size }))
      .filter((shard) => shard.bytes > SHARD_BUDGET_BYTES);
    expect(over).toEqual([]);
  });

  it("marks a bar as a bar in the shipped rows", () => {
    const { dir, files } = shardFiles();
    let bars = 0;
    let pubs = 0;
    for (const name of files) {
      for (const pub of parseUkBaseShard(readJson(path.join(dir, name)))) {
        if (pub.kind === "bar") bars += 1;
        else pubs += 1;
      }
    }
    expect(bars).toBeGreaterThanOrEqual(MIN_SEED_BARS);
    expect(pubs).toBeGreaterThanOrEqual(MIN_SEED_PUBS);
  });

  // The packs are cut from the London slim index, so a curated venue that
  // enters the slim (a renewed famous bar) must be owned by its OSM bar row.
  // A pack cut before it arrived leaves that row unowned, and the map draws
  // a second, unpriced pin beside the curated one.
  it("owns every shipped bar that matches a curated London venue", () => {
    const slim = readJson(path.join(ROOT, "public", "data", "venues_slim.json"));
    const curated = slim.rows as Array<{ id: string; name: string; lat: number; lng: number }>;
    const { dir, files } = shardFiles();
    const unowned: string[] = [];
    for (const name of files) {
      for (const venue of parseUkBaseShard(readJson(path.join(dir, name)))) {
        if (venue.kind !== "bar" || venue.curatedVenueId) continue;
        const owner = outerLondonOwnerForPub(venue, curated);
        if (owner) unowned.push(`${venue.name} -> ${owner}`);
      }
    }
    expect(unowned).toEqual([]);
  });
});

describe("UK base rows", () => {
  it("reads a seventh row element as the venue kind", () => {
    const pubs = parseUkBaseShard({
      version: 1,
      cell: "51.50_-0.25",
      pubs: [
        ["n1", "The Anchor", "1 Dock Road", 51.5, -0.1, ""],
        ["n2", "Nightjar", "129 City Road", 51.53, -0.09, "", "bar"],
      ],
    });
    expect(pubs.map((pub) => pub.kind)).toEqual(["pub", "bar"]);
  });

  it("never calls a bar a pub in the map list", () => {
    const model = buildUkBasePubListModel(
      [
        {
          id: "venue-uk-n2",
          name: "Nightjar",
          address: "129 City Road",
          lat: 51.53,
          lng: -0.09,
          curatedVenueId: "",
          kind: "bar",
        },
      ],
      null,
    );
    expect(defined(model.rows[0]).priceLabel).toBe("Other bar · no listed price");
  });
});
