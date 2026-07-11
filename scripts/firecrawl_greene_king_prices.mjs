#!/usr/bin/env node
/**
 * Firecrawl-powered Greene King drink price harvester.
 *
 * Governance: first-party Greene King menus only (see data/price_sources.json).
 * Writes public/data/drink_price_updates/latest.json — sourced rows with licence.
 *
 * Usage:
 *   node scripts/firecrawl_greene_king_prices.mjs [--limit N]
 *   node scripts/firecrawl_greene_king_prices.mjs --urls-file .firecrawl/gk-london-menu-urls.txt
 *
 * Requires FIRECRAWL_API_KEY (or firecrawl CLI stored credentials).
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const OUT_DIR = join(ROOT, "public", "data", "drink_price_updates");
const MENU_CACHE = join(ROOT, ".firecrawl", "menus");
const DEFAULT_URLS = join(ROOT, "data", "greene_king_london_menu_urls.txt");
const ENRICHMENT_PATH = join(ROOT, "public", "data", "venue_menu_enrichment.json");
const DATASET_PATH = join(ROOT, "public", "data", "pint_prices_app_dataset.json");

const SOURCE = {
  label: "Greene King — official menu",
  licence:
    "All rights reserved — first-party publisher of its own pub menus/prices; read-only, attributed use only.",
};

const DRINK_CATEGORIES = new Set([
  "beer",
  "wine",
  "whisky",
  "gin",
  "vodka",
  "rum",
  "cocktail",
  "shot",
  "other",
]);

// --- parser (mirror lib/greeneKingMenuParser.ts) ----------------------------

const SECTION_HEADING = /^###\s+(.+)$/;
const ITEM_HEADING = /^####\s+(.+)$/;
const PRICE_LINE = /£\s*(\d+(?:\.\d{2})?)/;

function mapSectionToCategory(section) {
  const s = section.toLowerCase();
  if (
    s.includes("main menu") ||
    s.includes("dessert") ||
    s.includes("snack") ||
    s.includes("kids") ||
    s.includes("ciabatta") ||
    s.includes("sunday menu") ||
    s.includes("gluten")
  ) {
    return null;
  }
  if (s.includes("wine") || s.includes("champagne") || s.includes("spark")) return "wine";
  if (s.includes("cocktail") || s.includes("spritz") || s.includes("0%")) return "cocktail";
  if (
    s.includes("beer") ||
    s.includes("lager") ||
    s.includes("ale") ||
    s.includes("cider") ||
    s.includes("draught") ||
    s.includes("keg") ||
    s.includes("stout")
  ) {
    return "beer";
  }
  if (s.includes("whisk") || s.includes("whiskey")) return "whisky";
  if (s.includes("gin")) return "gin";
  if (s.includes("vodka")) return "vodka";
  if (s.includes("rum")) return "rum";
  if (s.includes("spirit") || s.includes("shot")) return "shot";
  if (s.includes("drink")) return "other";
  return "other";
}

function firstPriceFromLines(lines) {
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed === "glass" || trimmed === "bottle" || trimmed === "pint") continue;
    const prices = [...line.matchAll(/£\s*(\d+(?:\.\d{2})?)/g)].map((m) => parseFloat(m[1]));
    if (prices.length === 0) continue;
    return Math.min(...prices);
  }
  return null;
}

function parseGreeneKingMenuMarkdown(markdown) {
  const lines = markdown.split(/\r?\n/);
  const out = [];
  let section = null;
  let itemName = null;
  let itemLines = [];

  const flushItem = () => {
    if (!itemName || !section) {
      itemName = null;
      itemLines = [];
      return;
    }
    const category = mapSectionToCategory(section);
    if (!category) {
      itemName = null;
      itemLines = [];
      return;
    }
    const price = firstPriceFromLines(itemLines);
    if (price !== null) {
      out.push({ drinkName: itemName.trim(), category, priceGbp: price });
    }
    itemName = null;
    itemLines = [];
  };

  for (const line of lines) {
    const sectionMatch = line.match(SECTION_HEADING);
    if (sectionMatch) {
      flushItem();
      section = sectionMatch[1].trim();
      continue;
    }
    const itemMatch = line.match(ITEM_HEADING);
    if (itemMatch) {
      flushItem();
      itemName = itemMatch[1].trim();
      itemLines = [];
      continue;
    }
    if (itemName) itemLines.push(line);
  }
  flushItem();
  return out;
}

function slugFromMenuUrl(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const menuIdx = parts.lastIndexOf("menu");
    if (menuIdx < 1) return null;
    return parts[menuIdx - 1] ?? null;
  } catch {
    return null;
  }
}

function titleFromSlug(slug) {
  return slug
    .split("-")
    .map((w) => (w.length <= 2 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

// --- venue keys -------------------------------------------------------------

function normaliseVenueKeyPart(value) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function venueGroupingKey(row) {
  return [
    normaliseVenueKeyPart(row.pub_name),
    normaliseVenueKeyPart(row.address),
    row.latitude.toFixed(5),
    row.longitude.toFixed(5),
  ].join("|");
}

function stableVenueIdFromKey(key) {
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `venue-${(hash >>> 0).toString(36)}`;
}

function normaliseName(name) {
  return name
    .toLowerCase()
    .replace(/['']/g, "")
    .replace(/\b(the|pub|bar|tavern|arms|hotel)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildVenueIndexes(dataset) {
  const idToKey = new Map();
  const nameToKeys = new Map();
  for (const row of dataset) {
    const key = venueGroupingKey(row);
    const id = stableVenueIdFromKey(key);
    idToKey.set(id, key);
    const norm = normaliseName(row.pub_name);
    const list = nameToKeys.get(norm) ?? [];
    list.push(key);
    nameToKeys.set(norm, list);
  }
  return { idToKey, nameToKeys };
}

function menuUrlToVenueId(enrichment) {
  const map = new Map();
  for (const [venueId, rec] of Object.entries(enrichment.venues ?? {})) {
    if (rec.menuUrl) map.set(rec.menuUrl.replace(/\/$/, ""), venueId);
  }
  return map;
}

function resolveVenueKey(url, indexes, menuUrlToId) {
  const normalised = url.replace(/\/$/, "");
  const venueId = menuUrlToId.get(normalised);
  if (venueId && indexes.idToKey.has(venueId)) {
    return indexes.idToKey.get(venueId);
  }
  const slug = slugFromMenuUrl(url);
  if (!slug) return null;
  const title = titleFromSlug(slug);
  const norm = normaliseName(title);
  const keys = indexes.nameToKeys.get(norm);
  if (keys?.length === 1) return keys[0];
  if (keys && keys.length > 1) return keys[0];

  // Fuzzy: every dataset name containing all slug tokens
  const tokens = slug.split("-").filter((t) => t.length > 2 && t !== "the");
  let best = null;
  let bestScore = 0;
  for (const [name, keyList] of indexes.nameToKeys.entries()) {
    const score = tokens.filter((t) => name.includes(t)).length;
    if (score > bestScore && score >= Math.min(2, tokens.length)) {
      bestScore = score;
      best = keyList[0];
    }
  }
  return best;
}

// --- firecrawl --------------------------------------------------------------

function scrapeMenu(url, outPath) {
  if (existsSync(outPath)) {
    return readFileSync(outPath, "utf8");
  }
  mkdirSync(dirname(outPath), { recursive: true });
  execFileSync(
    "npx",
    ["-y", "firecrawl-cli@latest", "scrape", url, "-o", outPath, "--wait-for", "3000"],
    { stdio: "inherit", cwd: ROOT, env: process.env },
  );
  return readFileSync(outPath, "utf8");
}

// --- main -------------------------------------------------------------------

function parseArgs(argv) {
  let limit = 14;
  let urlsFile = DEFAULT_URLS;
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--limit" && argv[i + 1]) {
      limit = parseInt(argv[++i], 10);
    } else if (argv[i] === "--urls-file" && argv[i + 1]) {
      urlsFile = argv[++i];
    }
  }
  return { limit, urlsFile };
}

async function main() {
  const { limit, urlsFile } = parseArgs(process.argv);
  const observedAt = new Date().toISOString();

  const enrichment = JSON.parse(readFileSync(ENRICHMENT_PATH, "utf8"));
  const enrichmentUrls = Object.values(enrichment.venues ?? {})
    .map((v) => v.menuUrl)
    .filter(Boolean);

  let bulkUrls = [];
  if (existsSync(urlsFile)) {
    bulkUrls = readFileSync(urlsFile, "utf8")
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l.startsWith("http"));
  }
  // Prefer curated enrichment URLs (already venue-matched in app) before bulk list.
  const urls = [...new Set([...enrichmentUrls, ...bulkUrls])].slice(0, limit);

  const dataset = JSON.parse(readFileSync(DATASET_PATH, "utf8"));
  const indexes = buildVenueIndexes(dataset);
  const menuUrlToId = menuUrlToVenueId(enrichment);

  const updates = [];
  let scraped = 0;
  let matched = 0;
  let unmatched = 0;

  for (const url of urls) {
    const slug = slugFromMenuUrl(url) ?? "unknown";
    const cachePath = join(MENU_CACHE, `${slug}.md`);
    let markdown;
    try {
      markdown = scrapeMenu(url, cachePath);
      scraped += 1;
    } catch (err) {
      console.warn(`SKIP scrape failed ${url}:`, err.message ?? err);
      continue;
    }

    const venueKey = resolveVenueKey(url, indexes, menuUrlToId);
    if (!venueKey) {
      unmatched += 1;
      console.warn(`UNMATCHED venue for ${url}`);
      continue;
    }
    matched += 1;

    const drinks = parseGreeneKingMenuMarkdown(markdown);
    for (const d of drinks) {
      if (!DRINK_CATEGORIES.has(d.category)) continue;
      updates.push({
        venueKey,
        drinkName: d.drinkName,
        category: d.category,
        priceGbp: d.priceGbp,
        source: { ...SOURCE, url },
        observedAt,
      });
    }
    console.log(`  ${slug}: ${drinks.length} drinks → ${venueKey.slice(0, 40)}…`);
  }

  mkdirSync(OUT_DIR, { recursive: true });
  const stamp = observedAt.slice(0, 10).replace(/-/g, "");
  const payload = { version: 1, generatedAt: observedAt, updates };
  const dated = join(OUT_DIR, `prices_${stamp}.json`);
  writeFileSync(dated, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(join(OUT_DIR, "latest.json"), `${JSON.stringify(payload, null, 2)}\n`);

  console.log(
    `\nDone: scraped=${scraped} matched=${matched} unmatched=${unmatched} rows=${updates.length}`,
  );
  console.log(`Wrote ${dated} and latest.json`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
