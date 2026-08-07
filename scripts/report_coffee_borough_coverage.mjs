#!/usr/bin/env node
/**
 * Coffee (and optional no-alcohol) borough coverage report — Wave 2 stretch (W2-F).
 *
 * Local / keyless ops helper. Reads a fixture JSON of venues + community price
 * rows and counts, per London borough (or night-area label when borough is
 * missing), how many venues carry at least one corroborated, in-window price
 * for each requested drink category.
 *
 * Trust gates mirror lib/communityPrice.ts (threshold 2, 30-day max age). This
 * script stays dependency-light on purpose: no network, no Supabase, no Next
 * imports. It never writes prices. Seeding prices is forbidden; growth comes
 * from real community submit + corroboration (see docs/growth/COFFEE_BOROUGH_CAMPAIGN.md).
 *
 * Fixture shape:
 *   {
 *     "venues": [{ "id": "venue-a", "borough": "Camden" },
 *                { "id": "venue-b", "nightArea": "clapham" }],
 *     "prices": [{
 *       "venueId": "venue-a",
 *       "drinkCategory": "coffee",
 *       "submittedAt": 1710000000000,
 *       "corroborations": 2
 *     }]
 *   }
 *
 * Run:
 *   node scripts/report_coffee_borough_coverage.mjs --fixture path.json
 *   npm run report:coffee-borough -- --fixture path.json
 *   npm run report:coffee-borough -- --fixture path.json --categories coffee,alcohol-free,soft-drink
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Mirrors lib/dayMs.ts / lib/communityPrice.ts COMMUNITY_PRICE_MAX_AGE_MS. */
export const DAY_MS = 86_400_000;
export const COMMUNITY_PRICE_CORROBORATION_THRESHOLD = 2;
export const COMMUNITY_PRICE_MAX_AGE_MS = 30 * DAY_MS;

/** Default report categories: coffee first; AF / soft-drink opt-in via CLI. */
export const DEFAULT_REPORT_CATEGORIES = Object.freeze(["coffee"]);
export const OPTIONAL_NO_ALCOHOL_CATEGORIES = Object.freeze([
  "alcohol-free",
  "soft-drink",
]);
export const ALL_REPORT_CATEGORIES = Object.freeze([
  ...DEFAULT_REPORT_CATEGORIES,
  ...OPTIONAL_NO_ALCOHOL_CATEGORIES,
]);

/**
 * Same gate as lib/communityPrice.ts drivesMap: second independent submitter
 * and still inside the 30-day window.
 */
export function drivesMap(price, now = Date.now()) {
  const corroborations = Number(price?.corroborations ?? 1);
  const submittedAt = Number(price?.submittedAt);
  if (!Number.isFinite(corroborations) || !Number.isFinite(submittedAt)) {
    return false;
  }
  if (corroborations < COMMUNITY_PRICE_CORROBORATION_THRESHOLD) return false;
  return now - submittedAt <= COMMUNITY_PRICE_MAX_AGE_MS;
}

/**
 * Prefer borough (map grouping). Fall back to nightArea / area when borough is
 * absent so a fixture without borough labels still groups somewhere honest.
 */
export function areaForVenue(venue) {
  if (!venue || typeof venue !== "object") {
    return { kind: "unmatched", name: "(unmatched)" };
  }
  const borough = typeof venue.borough === "string" ? venue.borough.trim() : "";
  if (borough) return { kind: "borough", name: borough };
  const nightArea =
    typeof venue.nightArea === "string" ? venue.nightArea.trim() : "";
  if (nightArea) return { kind: "night-area", name: nightArea };
  const area = typeof venue.area === "string" ? venue.area.trim() : "";
  if (area) return { kind: "area", name: area };
  return { kind: "unmatched", name: "(unmatched)" };
}

function normalizeCategories(categories) {
  const list = Array.isArray(categories) ? categories : DEFAULT_REPORT_CATEGORIES;
  const seen = new Set();
  const out = [];
  for (const raw of list) {
    if (typeof raw !== "string") continue;
    const cat = raw.trim();
    if (!cat || seen.has(cat)) continue;
    seen.add(cat);
    out.push(cat);
  }
  return out.length > 0 ? out : [...DEFAULT_REPORT_CATEGORIES];
}

/**
 * Count venues with ≥1 corroborated in-window price per area × category.
 *
 * @param {{ venues?: unknown[], prices?: unknown[] }} fixture
 * @param {{ categories?: string[], now?: number }} [options]
 */
export function reportCoffeeBoroughCoverage(fixture, options = {}) {
  const categories = normalizeCategories(options.categories);
  const now = Number.isFinite(options.now) ? options.now : Date.now();

  const venues = Array.isArray(fixture?.venues) ? fixture.venues : [];
  const prices = Array.isArray(fixture?.prices) ? fixture.prices : [];

  /** @type {Map<string, { id: string, area: ReturnType<typeof areaForVenue> }>} */
  const venueById = new Map();
  /** @type {Map<string, { kind: string, name: string, venueIds: Set<string> }>} */
  const areas = new Map();

  for (const venue of venues) {
    if (!venue || typeof venue !== "object") continue;
    const id = typeof venue.id === "string" ? venue.id.trim() : "";
    if (!id || venueById.has(id)) continue;
    const area = areaForVenue(venue);
    venueById.set(id, { id, area });
    const key = `${area.kind}:${area.name}`;
    let bucket = areas.get(key);
    if (!bucket) {
      bucket = { kind: area.kind, name: area.name, venueIds: new Set() };
      areas.set(key, bucket);
    }
    bucket.venueIds.add(id);
  }

  /** category -> areaKey -> Set<venueId> */
  const covered = new Map();
  for (const cat of categories) covered.set(cat, new Map());

  /** venueId -> category -> boolean already counted */
  const counted = new Map();

  for (const price of prices) {
    if (!price || typeof price !== "object") continue;
    const venueId = typeof price.venueId === "string" ? price.venueId.trim() : "";
    const drinkCategory =
      typeof price.drinkCategory === "string" ? price.drinkCategory.trim() : "";
    if (!venueId || !drinkCategory) continue;
    if (!covered.has(drinkCategory)) continue;
    if (!drivesMap(price, now)) continue;

    const venue = venueById.get(venueId);
    if (!venue) continue;

    let perVenue = counted.get(venueId);
    if (!perVenue) {
      perVenue = new Set();
      counted.set(venueId, perVenue);
    }
    if (perVenue.has(drinkCategory)) continue;
    perVenue.add(drinkCategory);

    const areaKey = `${venue.area.kind}:${venue.area.name}`;
    const byArea = covered.get(drinkCategory);
    let set = byArea.get(areaKey);
    if (!set) {
      set = new Set();
      byArea.set(areaKey, set);
    }
    set.add(venueId);

    // A price for a venue missing from the venue list still needs an area row
    // so the count is visible (area taken from any venue we already know).
    if (!areas.has(areaKey)) {
      areas.set(areaKey, {
        kind: venue.area.kind,
        name: venue.area.name,
        venueIds: new Set([venueId]),
      });
    }
  }

  const areaRows = [...areas.values()].sort((a, z) => {
    if (a.kind !== z.kind) return a.kind.localeCompare(z.kind);
    return a.name.localeCompare(z.name);
  });

  const rows = areaRows.map((area) => {
    const areaKey = `${area.kind}:${area.name}`;
    /** @type {Record<string, number>} */
    const counts = {};
    for (const cat of categories) {
      counts[cat] = covered.get(cat)?.get(areaKey)?.size ?? 0;
    }
    return {
      kind: area.kind,
      name: area.name,
      venues: area.venueIds.size,
      counts,
    };
  });

  /** @type {Record<string, number>} */
  const totals = {};
  for (const cat of categories) {
    totals[cat] = rows.reduce((sum, row) => sum + row.counts[cat], 0);
  }

  return {
    now,
    categories,
    maxAgeMs: COMMUNITY_PRICE_MAX_AGE_MS,
    corroborationThreshold: COMMUNITY_PRICE_CORROBORATION_THRESHOLD,
    venueCount: venueById.size,
    priceRowCount: prices.length,
    rows,
    totals,
  };
}

/** Plain-text table for stdout / ops paste. */
export function formatCoffeeBoroughReport(report) {
  const cats = report.categories;
  const header = ["Area", "Kind", "Venues", ...cats.map((c) => `≥1 ${c}`)];
  const lines = [];
  lines.push(
    `Coffee borough coverage (corroborated + in-window ≤ ${report.maxAgeMs / DAY_MS}d, threshold ${report.corroborationThreshold})`,
  );
  lines.push(
    `Categories: ${cats.join(", ")}. Venues in fixture: ${report.venueCount}. Price rows scanned: ${report.priceRowCount}.`,
  );
  lines.push("");
  lines.push(header.join(" | "));
  lines.push(header.map(() => "---").join(" | "));
  for (const row of report.rows) {
    lines.push(
      [
        row.name,
        row.kind,
        String(row.venues),
        ...cats.map((c) => String(row.counts[c] ?? 0)),
      ].join(" | "),
    );
  }
  lines.push(
    [
      "TOTAL",
      "-",
      String(report.rows.reduce((s, r) => s + r.venues, 0)),
      ...cats.map((c) => String(report.totals[c] ?? 0)),
    ].join(" | "),
  );
  lines.push("");
  lines.push(
    "A cell is the count of venues with at least one corroborated, in-window community price for that category. Never seed prices to raise these numbers.",
  );
  return lines.join("\n");
}

export function parseArgs(argv) {
  const args = { fixture: null, categories: [...DEFAULT_REPORT_CATEGORIES], now: null, help: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      args.help = true;
      continue;
    }
    if (arg === "--fixture" || arg === "-f") {
      args.fixture = argv[++i] ?? null;
      continue;
    }
    if (arg.startsWith("--fixture=")) {
      args.fixture = arg.slice("--fixture=".length) || null;
      continue;
    }
    if (arg === "--categories" || arg === "-c") {
      const raw = argv[++i] ?? "";
      args.categories = raw
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    if (arg.startsWith("--categories=")) {
      args.categories = arg
        .slice("--categories=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      continue;
    }
    if (arg === "--now") {
      const raw = argv[++i];
      const n = Number(raw);
      if (Number.isFinite(n)) args.now = n;
      continue;
    }
    if (arg.startsWith("--now=")) {
      const n = Number(arg.slice("--now=".length));
      if (Number.isFinite(n)) args.now = n;
    }
  }
  return args;
}

function printHelp() {
  console.log(`Usage:
  node scripts/report_coffee_borough_coverage.mjs --fixture <path.json> [--categories coffee,alcohol-free,soft-drink] [--now <epochMs>]

Reads a local fixture of venues + community price rows. No network. Never writes
or seeds prices. See docs/growth/COFFEE_BOROUGH_CAMPAIGN.md.
`);
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help || !args.fixture) {
    printHelp();
    process.exit(args.help ? 0 : 1);
  }
  const fixturePath = resolve(ROOT, args.fixture);
  const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));
  const report = reportCoffeeBoroughCoverage(fixture, {
    categories: args.categories,
    now: args.now ?? Date.now(),
  });
  console.log(formatCoffeeBoroughReport(report));
}

const isMain =
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href;

if (isMain) {
  main();
}
