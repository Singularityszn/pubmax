import { spawnSync } from "node:child_process";
import { existsSync, realpathSync, readFileSync, writeFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { venueFromDetailArtifact } from "@/lib/venueDetailIndex";
import { groupVenuePrices, type VenuePrice } from "@/lib/venues";

const ROOT = path.resolve(import.meta.dirname, "..");
const roots: string[] = [];
const json = (file: string) => JSON.parse(readFileSync(file, "utf8"));
const raw = json(path.join(ROOT, "public/data/pint_prices_app_dataset.json")) as VenuePrice[];
const seed = json(path.join(ROOT, "data/osm/outer_london_osm_pubs.json"));
const abba = raw.find((row) => row.app_price_id === "app_price_003785")!;
const pub = raw.find((row) => row.app_price_id === "app_price_003480")!;
const seedRows = seed.pubs.filter((row: { osmId: string }) =>
  ["node/9829140325", "way/270582394"].includes(row.osmId),
);

function fixture(rows: VenuePrice[] = [abba, pub], pubs = seedRows): string {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "pubmax-kind-chain-")));
  roots.push(root);
  const copied = new Set<string>();
  function copy(relative: string) {
    if (copied.has(relative)) return;
    copied.add(relative);
    const source = path.join(ROOT, relative);
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    const contents = readFileSync(source);
    writeFileSync(target, contents);
    if (!relative.endsWith(".mjs")) return;
    // Copy the real CLI's local dependencies. No implementation is replaced.
    for (const match of contents.toString().matchAll(/(?:from\s+|import\s*)["']([^"']+)["']/g)) {
      if (match[1].startsWith(".")) {
        copy(path.relative(ROOT, path.resolve(path.dirname(source), match[1])));
      }
    }
  }
  for (const relative of [
    "scripts/merge_outer_london_osm.mjs", "scripts/build_slim_index.mjs",
    "data/tfl_station_zones.json", "data/famous_venues/bars.json",
    "data/famous_venues/late_food.json", "data/famous_venues/restaurants.json",
    "data/famous_venues/removed.json",
  ]) copy(relative);
  const previous = json(path.join(ROOT, "public/data/venues_slim.json"));
  for (const [relative, data] of [
    ["public/data/pint_prices_app_dataset.json", rows],
    ["data/osm/outer_london_osm_pubs.json", { ...seed, pubs }],
    ["public/data/venues_slim.json", { ...previous, rows: previous.rows.filter((row: { kind?: string }) => row.kind !== undefined) }],
  ] as const) {
    const target = path.join(root, relative);
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, JSON.stringify(data));
  }
  return root;
}

function cli(root: string, name: string) {
  return spawnSync(process.execPath, [path.join(root, "scripts", name)], {
    cwd: root, encoding: "utf8", timeout: 10000,
    env: { PATH: process.env.PATH, HOME: process.env.HOME, DEPLOYMENT_VERSION: "local", NODE_ENV: "test" },
  });
}

function withoutKindEvidence(row: Record<string, unknown>) {
  const original = { ...row };
  delete original.venue_kind;
  delete original.venue_kind_osm_id;
  delete original.venue_kind_observed_at;
  return original;
}

afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe("sourced venue kind through the real publication chain", () => {
  it("keeps the existing sourced bar's identity, price day and type through slim and detail publication", () => {
    const root = fixture();
    expect(cli(root, "merge_outer_london_osm.mjs").status).toBe(0);
    const merged = json(path.join(root, "public/data/pint_prices_app_dataset.json"));
    const bar = merged.find((row: VenuePrice) => row.app_price_id === abba.app_price_id);
    expect(bar).toMatchObject({
      venue_kind: "bar", venue_kind_osm_id: "node/9829140325", venue_kind_observed_at: seed.fetchedAt,
    });
    expect(withoutKindEvidence(bar)).toEqual(abba);
    const published = readFileSync(path.join(root, "public/data/pint_prices_app_dataset.json"));
    expect(cli(root, "merge_outer_london_osm.mjs").status).toBe(0);
    expect(readFileSync(path.join(root, "public/data/pint_prices_app_dataset.json"))).toEqual(published);
    expect(cli(root, "build_slim_index.mjs").status).toBe(0);
    const slim = json(path.join(root, "public/data/venues_slim.json")).rows;
    expect(slim.find((row: { id: string }) => row.id === "venue-16cduf6")).toMatchObject({ kind: "bar", cheapestPrice: null });
    const artifacts = readFileSync(path.join(root, "data/generated/venue_details.jsonl"), "utf8").trim().split("\n").map((line) => JSON.parse(line));
    const detail = venueFromDetailArtifact(artifacts.find((row) => row.id === "venue-16cduf6"), "venue-16cduf6");
    expect(detail).toMatchObject({ id: "venue-16cduf6", kind: "bar", cheapestPrice: null });
    expect(detail?.prices[0].scraped_at_values).toBe("2026-07-17T22:47:09.827Z");
    expect(groupVenuePrices(merged).find((row) => row.name === "Jack and Jill")).toMatchObject({ kind: "pub" });
    expect(existsSync(path.join(root, "data/generated/venue_detail_index.json"))).toBe(true);
  });
  it("publishes a new sourced pub and bar without inventing a price", () => {
    const root = fixture([]);
    expect(cli(root, "merge_outer_london_osm.mjs").status).toBe(0);
    const merged = json(path.join(root, "public/data/pint_prices_app_dataset.json"));
    expect(merged).toHaveLength(2);
    expect(merged.map((row: VenuePrice) => row.venue_kind).sort()).toEqual(["bar", "pub"]);
    expect(merged.every((row: VenuePrice) => row.price_gbp === null && row.venue_kind_observed_at === seed.fetchedAt)).toBe(true);
    expect(cli(root, "build_slim_index.mjs").status).toBe(0);
    expect(groupVenuePrices(merged).map((row) => row.kind).sort()).toEqual(["bar", "pub"]);
  });

  it("keeps sourced bar evidence when an unknown legacy price sorts first", () => {
    const root = fixture();
    expect(cli(root, "merge_outer_london_osm.mjs").status).toBe(0);
    const merged: VenuePrice[] = json(path.join(root, "public/data/pint_prices_app_dataset.json"));
    const bar = merged.find((row) => row.app_price_id === abba.app_price_id)!;
    const legacy = { ...abba, app_price_id: "legacy-price", price_gbp: 4, comment: "pub" };
    const grouped = groupVenuePrices([legacy, bar, pub]);
    expect(grouped.find((row) => row.id === "venue-16cduf6")).toMatchObject({ kind: "bar", cheapestPrice: 4 });
    expect(grouped.find((row) => row.name === "Jack and Jill")?.kind).toBeUndefined();
  });

  it("refuses conflicting canonical kinds before either CLI changes its outputs", () => {
    const bar: VenuePrice = { ...abba, venue_kind: "bar", venue_kind_osm_id: "node/9829140325", venue_kind_observed_at: seed.fetchedAt };
    const conflict: VenuePrice = { ...bar, app_price_id: "contradictory-pub", venue_kind: "pub", venue_kind_osm_id: "way/270582394", data_quality_notes: "osm_overpass|way/270582394" };
    const root = fixture([bar, conflict, pub]);
    const paths = ["public/data/pint_prices_app_dataset.json", "public/data/venues_slim.json"];
    const before = paths.map((file) => readFileSync(path.join(root, file)));
    const merge = cli(root, "merge_outer_london_osm.mjs");
    expect(merge.status).toBe(1);
    expect(merge.stderr).toContain("source venue kind refused");
    expect(merge.stderr).toContain("app_price_003785");
    expect(merge.stderr).toContain("contradictory-pub");
    const build = cli(root, "build_slim_index.mjs");
    expect(build.status).toBe(1);
    expect(build.stderr).toContain("source venue kind refused");
    expect(build.stderr.indexOf('"row":"app_price_003785"')).toBeLessThan(build.stderr.indexOf('"row":"contradictory-pub"'));
    paths.forEach((file, index) => expect(readFileSync(path.join(root, file))).toEqual(before[index]));
    expect(existsSync(path.join(root, "data/generated"))).toBe(false);
    expect(groupVenuePrices([bar, conflict, pub]).map((row) => row.name)).toEqual(["Jack and Jill"]);
    expect(venueFromDetailArtifact({ id: "venue-16cduf6", rows: [bar, conflict] }, "venue-16cduf6")).toBeNull();
  });

  it("refuses a changed kind for the same sourced element instead of overwriting it", () => {
    const stated: VenuePrice = { ...abba, venue_kind: "pub", venue_kind_osm_id: "node/9829140325", venue_kind_observed_at: seed.fetchedAt };
    const root = fixture([stated, pub]);
    const output = path.join(root, "public/data/pint_prices_app_dataset.json");
    const before = readFileSync(output);
    expect(cli(root, "merge_outer_london_osm.mjs").status).toBe(1);
    expect(readFileSync(output)).toEqual(before);
  });

  it("refuses missing or impossible kind observation dates without replacing them with today's date", () => {
    for (const fetchedAt of [undefined, "2026-02-30T12:00:00Z"]) {
      const root = fixture();
      writeFileSync(path.join(root, "data/osm/outer_london_osm_pubs.json"), JSON.stringify({ ...seed, pubs: seedRows, fetchedAt }));
      const output = path.join(root, "public/data/pint_prices_app_dataset.json");
      const before = readFileSync(output);
      expect(cli(root, "merge_outer_london_osm.mjs").status).toBe(1);
      expect(readFileSync(output)).toEqual(before);
    }
  });

  it("does not infer a type from names, comments or an absent OSM amenity", () => {
    const root = fixture([abba], seedRows.filter((row: { osmId: string }) => row.osmId === "node/9829140325").map((row: Record<string, unknown>) => ({ ...row, amenity: undefined })));
    expect(cli(root, "merge_outer_london_osm.mjs").status).toBe(0);
    expect(json(path.join(root, "public/data/pint_prices_app_dataset.json"))).toEqual([abba]);
    expect(groupVenuePrices([abba])[0].kind).toBeUndefined();
  });

});
