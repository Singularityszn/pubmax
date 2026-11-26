import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import path from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import { isFairPint } from "@/lib/fairPintPricing";
import { createSlimShardLoader } from "@/lib/slimShards";
import { getNightArea } from "@/lib/nightAreas";
import type { SlimVenue } from "@/lib/venuesSlim";

const root = path.resolve(__dirname, "..");
const revision = "0bde0a9d65b04ccbee5a985c6b327fedd848ebed";
afterEach(() => vi.unstubAllGlobals());

it("builds full-revision cells within the fixed budgets and reads every venue losslessly", async () => {
  const staging = mkdtempSync(path.join(root, ".test-slim-budget-"));
  try {
    mkdirSync(path.join(staging, "scripts"));
    mkdirSync(path.join(staging, "data"));
    mkdirSync(path.join(staging, "public/data"), { recursive: true });
    copyFileSync(path.join(root, "scripts/build_slim_index.mjs"), path.join(staging, "scripts/build_slim_index.mjs"));
    // Inputs are read-only links. All generated outputs belong to this isolated build.
    for (const file of ["lib", "node_modules", "scripts/lib"]) {
      symlinkSync(path.join(root, file), path.join(staging, file));
    }
    for (const file of ["famous_venues", "osm", "amenities", "places_enrichment.json", "places_enrichment_uk_cities.json", "places_enrichment_london_extras.json", "places_enrichment_uk_cities_extras.json"]) {
      symlinkSync(path.join(root, "data", file), path.join(staging, "data", file));
    }
    for (const file of ["pint_prices_app_dataset.json", "venue_menu_enrichment.json", "venue_id_aliases.json", "uk_prices"]) {
      symlinkSync(path.join(root, "public/data", file), path.join(staging, "public/data", file));
    }
    copyFileSync(path.join(root, "public/data/venues_slim.json"), path.join(staging, "public/data/venues_slim.json"));
    execFileSync(process.execPath, ["scripts/build_slim_index.mjs"], {
      cwd: staging,
      env: { ...process.env, TSX_TSCONFIG_PATH: path.join(root, "tsconfig.json"), NEXT_PUBLIC_SW_VERSION: revision, DEPLOYMENT_VERSION: revision, GITHUB_SHA: revision },
      stdio: "pipe",
    });
    const text = (url: string) => readFileSync(path.join(staging, "public", url), "utf8");
    const manifestText = text("/data/venues_slim.manifest.json");
    const manifest = JSON.parse(manifestText);
    const canonical = JSON.parse(text("/data/venues_slim.json"));
    const expected = canonical.rows as SlimVenue[];
    const expectedById = new Map(expected.map((row) => [row.id, row]));
    let bytes = Buffer.byteLength(manifestText);
    const decoded: SlimVenue[] = [];
    const payloads = new Map<string, unknown>();
    payloads.set("/data/venues_slim.manifest.json", manifest);
    expect(manifest.revision).toBe(revision);
    for (const shard of manifest.shards) {
      const raw = text(shard.url);
      bytes += Buffer.byteLength(raw);
      expect(Buffer.byteLength(raw)).toBeLessThan(150 * 1024);
      const payload = JSON.parse(raw);
      payloads.set(shard.url, payload);
      expect(payload.revision).toBe(revision);
      expect(payload.d).toBe(canonical.d);
      // The codec is lossless over the shipped rows; expiry is judged by readers.
      const rows = rowsFromSlimPayload(payload, null) as SlimVenue[];
      expect(rows).toHaveLength(shard.count);
      for (const row of rows) expect(row).toEqual(expectedById.get(row.id));
      decoded.push(...rows);
    }
    // The oracle is the unencoded monolithic output, not the compacting function.
    expect(bytes).toBeLessThan(1200 * 1024);
    expect(decoded).toHaveLength(expected.length);
    expect(new Set(decoded.map((row) => row.id)).size).toBe(expected.length);

    // Exercise the map's browser consumer at the actual network boundary.
    vi.stubGlobal("fetch", vi.fn(async (input: string) => {
      const payload = payloads.get(new URL(input, "https://pubmaxxing.com").pathname);
      return new Response(JSON.stringify(payload), { status: payload ? 200 : 404 });
    }));
    const loader = createSlimShardLoader("london", { bypassInFlight: true });
    const bounds = { west: -0.55, south: 51.26, east: 0.3, north: 51.72 };
    const loaded = await loader.inBounds(bounds);
    expect(loader.coverageComplete(bounds)).toBe(true);
    const visibleExpected = expected.filter((row) => row.id !== "venue-1fabngq");
    expect(loaded).toHaveLength(visibleExpected.length);
    expect(loaded.some((row) => row.id === "venue-1fabngq")).toBe(false);
    const now = Date.parse("2026-11-17T12:00:00Z");
    for (const ceiling of [400, 550, 700]) {
      const eligible = (rows: SlimVenue[]) => rows.filter((row) => isFairPint(row, ceiling, now)).map((row) => row.id).sort();
      expect(eligible(loaded)).toEqual(eligible(visibleExpected));
      expect(eligible(loaded).length).toBeGreaterThanOrEqual(3);
    }
    const area = getNightArea("camden");
    const nearby = await loader.nearPoint(area.centre.lat, area.centre.lng, area.radiusKm);
    expect(nearby.status).toBe("ready");
    const inDrawCircle = (row: SlimVenue) => {
      const rad = Math.PI / 180;
      const a = Math.sin((row.lat - area.centre.lat) * rad / 2) ** 2
        + Math.cos(row.lat * rad) * Math.cos(area.centre.lat * rad) * Math.sin((row.lng - area.centre.lng) * rad / 2) ** 2;
      return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)) <= area.radiusKm;
    };
    const drawIds = (rows: SlimVenue[]) => rows.filter((row) => inDrawCircle(row) && isFairPint(row, 550, now)).map((row) => row.id).sort();
    expect(drawIds(nearby.rows)).toEqual(drawIds(visibleExpected));
    expect(drawIds(nearby.rows).length).toBeGreaterThanOrEqual(3);
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
});
