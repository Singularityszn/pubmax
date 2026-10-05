import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";
import { defined } from "@/__tests__/helpers/defined";

it("builds only exact identity records and a freshness stamp dated by the oldest row of every pack without changing observations, and removes retired runtime files", () => {
  const root = process.cwd();
  mkdirSync(path.join(root, "test-results"), { recursive: true });
  const fixture = mkdtempSync(path.join(root, "test-results/places-builder-"));
  const rows = [
    { venueId: "venue-osm-n123", googlePlaceId: "ChIJVerified0001", observedAt: "2026-10-04T00:00:00Z", formattedAddress: { value: "Éléphant Street", source: "google_places", observedAt: "2026-10-04T00:00:00Z" } },
    { venueId: "Node/0123", googlePlaceId: "ChIJVerified0002", observedAt: "2026-09-01T00:00:00Z" },
    { venueId: "venue-uk-w456", googlePlaceId: "ChIJVerified0003", observedAt: "2026-10-02T00:00:00Z" },
  ];
  const head = { inputHash: "fixture-hash", spend: { attemptedCalls: 3 }, summary: { venues: 3 } };
  const stamp = () => JSON.parse(readFileSync(path.join(fixture, "data/places_enrichment_stamp.json"), "utf8"));
  try {
    mkdirSync(path.join(fixture, "data"));
    const source = path.join(fixture, "data/places_enrichment.json");
    const output = path.join(fixture, "data/generated/places_enrichment");
    const build = () => execFileSync(process.execPath, ["--import", path.join(root, "node_modules/tsx/dist/loader.mjs"), path.join(root, "scripts/build_places_enrichment.mjs")], { cwd: fixture });
    writeFileSync(source, JSON.stringify({ version: 1, ...head, venues: rows }));
    build();
    expect(readdirSync(output).sort()).toEqual(["node-123.json", "way-456.json"]);
    expect(JSON.parse(readFileSync(path.join(output, "node-123.json"), "utf8"))).toEqual(rows.slice(0, 2));
    expect(stamp()).toEqual({ version: 1, observedAt: "2026-09-01T00:00:00Z", packs: { places_enrichment: { ...head, observedAt: "2026-09-01T00:00:00Z" } } });
    writeFileSync(source, JSON.stringify({ version: 1, ...head, venues: [rows[0]] }));
    writeFileSync(path.join(fixture, "data/places_enrichment_uk_cities.json"), JSON.stringify({ version: 1, venues: [rows[2]] }));
    writeFileSync(path.join(fixture, "data/places_enrichment_london_extras.json"), JSON.stringify({ version: 1, venues: [{
      venueId: defined(rows[0]).venueId, googlePlaceId: defined(rows[0]).googlePlaceId, observedAt: "2026-10-05T00:00:00Z",
      rating: { value: 4.2, source: "google_places", observedAt: "2026-10-05T00:00:00Z" },
    }] }));
    build();
    expect(readdirSync(output).sort()).toEqual(["node-123.json", "way-456.json"]);
    const merged = JSON.parse(readFileSync(path.join(output, "node-123.json"), "utf8"));
    expect(merged).toHaveLength(1);
    expect(merged[0].rating.value).toBe(4.2);
    expect(merged[0].formattedAddress).toEqual(defined(rows[0]).formattedAddress);
    writeFileSync(path.join(fixture, "data/places_enrichment_uk_cities_extras.json"), JSON.stringify({ version: 1, venues: [{
      venueId: "venue-uk-n123", googlePlaceId: defined(rows[0]).googlePlaceId, observedAt: "2026-10-06T00:00:00Z",
      rating: { value: 4.7, source: "google_places", observedAt: "2026-10-06T00:00:00Z" },
      formattedAddress: { value: "Older address", source: "google_places", observedAt: "2026-10-01T00:00:00Z" },
    }] }));
    build();
    const aliases = JSON.parse(readFileSync(path.join(output, "node-123.json"), "utf8"));
    expect(aliases).toHaveLength(1);
    expect(aliases[0].rating).toEqual({ value: 4.7, source: "google_places", observedAt: "2026-10-06T00:00:00Z" });
    expect(aliases[0].formattedAddress).toEqual(defined(rows[0]).formattedAddress);
    expect(aliases[0].observedAt).toBe("2026-10-06T00:00:00Z");
    expect(stamp().observedAt).toBe("2026-10-02T00:00:00Z");
    expect(Object.fromEntries(Object.entries(stamp().packs).map(([name, row]) => [name, (row as { observedAt: string }).observedAt]))).toEqual({
      places_enrichment: "2026-10-04T00:00:00Z", places_enrichment_uk_cities: "2026-10-02T00:00:00Z", places_enrichment_london_extras: "2026-10-05T00:00:00Z",
      places_enrichment_uk_cities_extras: "2026-10-06T00:00:00Z",
    });
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
