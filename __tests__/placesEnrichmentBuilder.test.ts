import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { expect, it } from "vitest";

it("builds only exact identity records without changing observations, and removes retired runtime files", () => {
  const root = process.cwd();
  mkdirSync(path.join(root, "test-results"), { recursive: true });
  const fixture = mkdtempSync(path.join(root, "test-results/places-builder-"));
  const rows = [
    { venueId: "venue-osm-n123", googlePlaceId: "ChIJVerified0001", formattedAddress: { value: "Éléphant Street", source: "google_places", observedAt: "2026-10-04T00:00:00Z" } },
    { venueId: "Node/0123", googlePlaceId: "ChIJVerified0002" },
    { venueId: "venue-uk-w456", googlePlaceId: "ChIJVerified0003" },
  ];
  try {
    mkdirSync(path.join(fixture, "data"));
    const source = path.join(fixture, "data/places_enrichment.json");
    const output = path.join(fixture, "data/generated/places_enrichment");
    const build = () => execFileSync(process.execPath, ["--import", path.join(root, "node_modules/tsx/dist/loader.mjs"), path.join(root, "scripts/build_places_enrichment.mjs")], { cwd: fixture });
    writeFileSync(source, JSON.stringify({ version: 1, venues: rows }));
    build();
    expect(readdirSync(output).sort()).toEqual(["node-123.json", "way-456.json"]);
    expect(JSON.parse(readFileSync(path.join(output, "node-123.json"), "utf8"))).toEqual(rows.slice(0, 2));
    writeFileSync(source, JSON.stringify({ version: 1, venues: rows.slice(0, 2) }));
    build();
    expect(readdirSync(output)).toEqual(["node-123.json"]);
  } finally { rmSync(fixture, { recursive: true, force: true }); }
});
