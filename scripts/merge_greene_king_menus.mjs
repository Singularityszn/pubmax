#!/usr/bin/env node
// Merge Greene King drink (+ optional food) menus into public price-update
// layers. LOCAL FILES ONLY — no network.
//
// Inputs:
//   data/pubmaxxing/london_pub_all_beverages_expanded.csv  (London GK drinks)
//   data/greene_king/raw/*.json     optional Firecrawl menu drops
//   data/greene_king/food/*         optional interact-text food drops
//   data/greene_king/osm_city_pubs.json  city OSM GK pub metadata (keys only;
//                                       prices come from scrapes, never invented)
//   public/data/pint_prices_app_dataset.json  London venue keys
//
// Outputs:
//   public/data/drink_price_updates/prices_YYYYMMDD.json + latest.json
//   public/data/food_price_updates/prices_YYYYMMDD.json + latest.json
//
// Merge policy for drinks: keep non-GK demo rows unless a real GK update
// targets the same venueKey (then drop demo rows for that venue). Never invent
// prices — only rows with an explicit £ / base_price_gbp.

import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

const SOURCE_LABEL = "Greene King — official site";
const SOURCE_LICENCE =
  "All rights reserved — first-party publisher of its own pub menus/prices; attributed use only. No republishing of the source's own copy, only the price fact + observedAt + link back.";

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

const FOOD_CATEGORIES = new Set([
  "starters",
  "sharers",
  "mains",
  "burgers",
  "desserts",
  "sides",
  "bar-snacks",
  "other",
]);

function normalisePart(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function venueCoordsGroupingKey(name, address, lat, lng) {
  return [
    normalisePart(name),
    normalisePart(address),
    Number(lat).toFixed(5),
    Number(lng).toFixed(5),
  ].join("|");
}

function slugFromUrl(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/pubs\/([^/]+)\/([^/]+)(?:\/menu)?\/?$/i);
    if (!m) return null;
    return { locality: m[1].toLowerCase(), slug: m[2].toLowerCase() };
  } catch {
    const m = String(url).match(/\/pubs\/([^/]+)\/([^/]+)(?:\/menu)?\/?$/i);
    if (!m) return null;
    return { locality: m[1].toLowerCase(), slug: m[2].toLowerCase() };
  }
}

function websiteExactSlug(website, slug) {
  const parts = slugFromUrl(website);
  return Boolean(parts && parts.slug === slug.toLowerCase());
}

function mapCsvCategory(beverageCategory, subcategory) {
  const hay = `${beverageCategory ?? ""} ${subcategory ?? ""}`;
  if (/0\s*%|non-alcoholic|alcohol[- ]?free|soft/i.test(hay)) return "other";
  if (/cocktail|spritz/i.test(hay)) return "cocktail";
  if (/wine|prosecco|champagne|sparkling|ros[eé]/i.test(hay)) return "wine";
  if (/beer|cider|lager|ale/i.test(hay)) return "beer";
  if (/whisk/i.test(hay)) return "whisky";
  if (/\bgin\b/i.test(hay)) return "gin";
  if (/vodka/i.test(hay)) return "vodka";
  if (/\brum\b/i.test(hay)) return "rum";
  if (/spirit|shot/i.test(hay)) return "shot";
  if (/drink/i.test(hay)) return "other";
  return null;
}

function mapFoodSection(section) {
  const s = String(section ?? "");
  if (/starter|small plate|appetiser|appetizer/i.test(s)) return "starters";
  if (/sharer|to share|for the table|nachos/i.test(s)) return "sharers";
  if (/burger/i.test(s)) return "burgers";
  if (/dessert|pudding|sweet/i.test(s)) return "desserts";
  if (/side/i.test(s)) return "sides";
  if (/bar snack|nibble|bite/i.test(s)) return "bar-snacks";
  if (/main|classic|roast|ciabatta|grill|pie|fish|salad|kids/i.test(s)) return "mains";
  return "other";
}

function dietaryFromName(name) {
  const tags = [];
  if (/\bvegan\b|\(vg\)/i.test(name)) tags.push("vegan");
  if (/\bvegetarian\b|\(v\)/i.test(name) && !tags.includes("vegan")) tags.push("vegetarian");
  if (/\bgluten[- ]?free\b|\(gf\)/i.test(name)) tags.push("gluten-free");
  return tags.length ? tags : undefined;
}

function parseCsvLine(line) {
  // Minimal RFC4180-ish CSV parse for one line (handles quoted commas).
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

async function loadBeverageCsv(path) {
  const stream = createReadStream(path, { encoding: "utf8" });
  const rl = createInterface({ input: stream, crlfDelay: Infinity });
  let headers = null;
  const rows = [];
  for await (const line of rl) {
    if (!line.trim()) continue;
    const cols = parseCsvLine(line);
    if (!headers) {
      headers = cols;
      continue;
    }
    const row = {};
    headers.forEach((h, i) => {
      row[h] = cols[i] ?? "";
    });
    rows.push(row);
  }
  return rows;
}

function loadPintDatasetVenues(path) {
  const raw = JSON.parse(readFileSync(path, "utf8"));
  const byKey = new Map();
  for (const row of raw) {
    if (!row?.pub_name || !Number.isFinite(row.latitude) || !Number.isFinite(row.longitude)) continue;
    const venueKey = venueCoordsGroupingKey(row.pub_name, row.address, row.latitude, row.longitude);
    if (byKey.has(venueKey)) continue;
    byKey.set(venueKey, {
      venueKey,
      name: row.pub_name,
      address: row.address ?? "",
      website: row.website ?? "",
      lat: row.latitude,
      lng: row.longitude,
    });
  }
  return Array.from(byKey.values());
}

function findVenueBySlug(dataset, slug) {
  const hits = dataset.filter((v) => websiteExactSlug(v.website, slug));
  if (hits.length === 1) return hits[0];
  if (hits.length === 0) return null;
  // Ambiguous slug (shouldn't happen) — refuse.
  return null;
}

function gkSource(url) {
  return {
    label: SOURCE_LABEL,
    url,
    licence: SOURCE_LICENCE,
  };
}

function drinkRowKey(u) {
  return `${u.venueKey}\0${u.drinkName.toLowerCase()}\0${u.category}\0${(u.servingSize ?? "").toLowerCase()}`;
}

function foodRowKey(u) {
  return `${u.venueKey}\0${u.itemName.toLowerCase()}\0${u.category}`;
}

function isDemoDrinkUpdate(u) {
  const label = u?.source?.label ?? "";
  return /demo/i.test(label) || /pubmaxxing demo/i.test(label);
}

function isGkDrinkUpdate(u) {
  const label = u?.source?.label ?? "";
  const url = u?.source?.url ?? "";
  return /greene king/i.test(label) || /greeneking\.co\.uk/i.test(url);
}

function yyyymmdd(d = new Date()) {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}

function parseInteractFood(text) {
  const items = [];
  let section = "";
  const sectionRe = /^#{2,3}\s+\*?\*?(.+?)\*?\*?\s*$/;
  const bulletRe = /^\s*[-*]\s+\*\*(.+?)\*\*\s*:\s*£\s*(\d+(?:\.\d{1,2})?)\s*$/;
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const sec = line.match(sectionRe);
    if (sec && !line.startsWith("####")) {
      section = sec[1].replace(/\*\*/g, "").replace(/\s*\(\d+\)\s*$/, "").trim();
      continue;
    }
    const bullet = line.match(bulletRe);
    if (bullet && section) {
      const name = bullet[1].trim();
      const priceGbp = Number(bullet[2]);
      if (!name || !Number.isFinite(priceGbp) || priceGbp < 0) continue;
      items.push({ name, section, priceGbp, dietary: dietaryFromName(name) });
    }
  }
  return items;
}

/**
 * Parse #### food blocks from a GK menu markdown page (e.g. "## Main Menu" /
 * "### Small Plates"). Skips sections that map as drinks. Mirrors
 * lib/greeneking.ts parseFoodMarkdown (#### branch).
 */
function parseFoodMarkdownBlocks(markdown) {
  if (!markdown || !String(markdown).trim()) return [];
  // Prefer interact-bullet shape when present.
  const fromInteract = parseInteractFood(markdown);
  if (fromInteract.length > 0) return fromInteract;

  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  const items = [];
  let section = "";
  let itemName = null;
  let buf = [];

  const isDrinkSection = (s) => {
    if (/starter|sharer|main|burger|dessert|side|snack|small plate|roast|ciabatta|kids/i.test(s)) {
      return false;
    }
    return /wine|cocktail|beer|cider|spritz|champagne|prosecco|vodka|gin|rum|whisk|soft drink|0\s*%/i.test(
      s,
    );
  };

  const parsePrices = (text) => {
    const out = [];
    const re = /£\s*(\d+(?:\.\d{1,2})?)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0) out.push(n);
    }
    return out;
  };

  const flush = () => {
    if (!itemName || !section) {
      itemName = null;
      buf = [];
      return;
    }
    if (isDrinkSection(section)) {
      itemName = null;
      buf = [];
      return;
    }
    // Skip bare chrome headings with no food signal.
    if (/^filters?$/i.test(section) || /^main menu$/i.test(section) || /^menus?\b/i.test(section)) {
      itemName = null;
      buf = [];
      return;
    }
    const body = buf.join("\n");
    const prices = parsePrices(body);
    if (!prices.length) {
      itemName = null;
      buf = [];
      return;
    }
    items.push({
      name: itemName,
      section,
      priceGbp: prices[0],
      dietary: dietaryFromName(itemName),
    });
    itemName = null;
    buf = [];
  };

  const sectionRe = /^(#{2,3})\s+(.+?)\s*$/;
  const itemRe = /^#{4}\s+(.+?)\s*$/;
  for (const raw of lines) {
    const line = raw.trimEnd();
    const sec = line.match(sectionRe);
    if (sec && !line.startsWith("####")) {
      const title = sec[2].replace(/\*\*/g, "").replace(/\s*\(\d+\)\s*$/, "").trim();
      if (/^filters?$/i.test(title)) continue;
      flush();
      section = title;
      continue;
    }
    const item = line.match(itemRe);
    if (item) {
      flush();
      itemName = item[1].replace(/\*\*/g, "").trim();
      buf = [];
      continue;
    }
    if (itemName) buf.push(line);
  }
  flush();
  return items;
}

async function loadGreeneKingParser() {
  // Prefer the compiled-free TS via dynamic import through the project's
  // path alias isn't available in plain node — duplicate the tiny markdown
  // drink parser inline by importing the built... Actually we use a small
  // inline reimplementation mirroring lib/greeneking.ts for the merge script
  // (same as refresh_drink_prices.mjs does not import TS). Keep logic local.
  return null;
}

/** Inline drink markdown parser (mirrors lib/greeneking.ts parseDrinkMarkdown). */
function parseDrinkMarkdown(markdown) {
  if (!markdown || !String(markdown).trim()) return [];
  const lines = String(markdown).replace(/\r\n/g, "\n").split("\n");
  const items = [];
  let section = "";
  let itemName = null;
  let buf = [];

  const mapSection = (s) => {
    if (/0\s*%/.test(s) && /cocktail|spritz/i.test(s)) return "other";
    if (/0\s*%|alcohol[- ]?free|non[- ]?alcoholic|soft drink/i.test(s)) return "other";
    if (/cocktail|spritz|mocktail/i.test(s)) return "cocktail";
    if (/\bshots?\b|shooter/i.test(s)) return "shot";
    if (/whisk(e)?y|bourbon|scotch/i.test(s)) return "whisky";
    if (/\bgin\b/i.test(s)) return "gin";
    if (/vodka/i.test(s)) return "vodka";
    if (/\brum\b/i.test(s)) return "rum";
    if (/wine|prosecco|champagne|sparkling|ros[eé]/i.test(s)) return "wine";
    if (/beer|lager|ale|cider|stout|draught|pint|craft/i.test(s)) return "beer";
    return null;
  };

  const parsePrices = (text) => {
    const out = [];
    const re = /£\s*(\d+(?:\.\d{1,2})?)/g;
    let m;
    while ((m = re.exec(text)) !== null) {
      const n = Number(m[1]);
      if (Number.isFinite(n) && n >= 0) out.push(n);
    }
    return out;
  };

  const flush = () => {
    if (!itemName || !section) {
      itemName = null;
      buf = [];
      return;
    }
    const cat = mapSection(section);
    if (!cat) {
      itemName = null;
      buf = [];
      return;
    }
    const body = buf.join("\n").trim();
    const prices = parsePrices(body);
    if (!prices.length) {
      itemName = null;
      buf = [];
      return;
    }
    const abvM = body.match(/(\d+(?:\.\d+)?)\s*%/);
    const abv = abvM ? Number(abvM[1]) : undefined;
    const lower = body.toLowerCase();
    const hasGlass = /\bglass\b/.test(lower);
    const hasBottle = /\bbottle\b/.test(lower);
    const push = (priceGbp, servingSize) => {
      items.push({
        name: itemName,
        section,
        category: cat,
        priceGbp,
        abv: Number.isFinite(abv) ? abv : undefined,
        servingSize,
      });
    };
    if (hasGlass && hasBottle && prices.length >= 2) {
      push(prices[0], "glass");
      push(prices[prices.length - 1], "bottle");
    } else if (hasBottle && !hasGlass) {
      push(prices[prices.length - 1], "bottle");
    } else if (hasGlass && !hasBottle) {
      push(prices[0], "glass");
    } else {
      push(prices[0]);
    }
    itemName = null;
    buf = [];
  };

  const sectionRe = /^(#{2,3})\s+(.+?)\s*$/;
  const itemRe = /^#{4}\s+(.+?)\s*$/;

  for (const raw of lines) {
    const line = raw.trimEnd();
    const sec = line.match(sectionRe);
    if (sec && !line.startsWith("####")) {
      const title = sec[2].replace(/\*\*/g, "").replace(/\s*\(\d+\)\s*$/, "").trim();
      if (/^filters?$/i.test(title) || /^menus?\b/i.test(title)) continue;
      flush();
      section = title;
      continue;
    }
    const item = line.match(itemRe);
    if (item) {
      flush();
      itemName = item[1].replace(/\*\*/g, "").trim();
      buf = [];
      continue;
    }
    if (itemName) buf.push(line);
  }
  flush();
  return items;
}

function stampDrink(venueKey, drinkName, category, priceGbp, menuUrl, observedAt, extra = {}) {
  if (!DRINK_CATEGORIES.has(category)) return null;
  if (!Number.isFinite(priceGbp) || priceGbp < 0) return null;
  if (!drinkName || !venueKey || !menuUrl) return null;
  return {
    venueKey,
    drinkName,
    category,
    priceGbp,
    ...extra,
    source: gkSource(menuUrl),
    observedAt,
  };
}

function stampFood(venueKey, itemName, category, priceGbp, menuUrl, observedAt, extra = {}) {
  if (!FOOD_CATEGORIES.has(category)) return null;
  if (!Number.isFinite(priceGbp) || priceGbp < 0) return null;
  if (!itemName || !venueKey || !menuUrl) return null;
  return {
    venueKey,
    itemName,
    category,
    priceGbp,
    ...extra,
    source: gkSource(menuUrl),
    observedAt,
  };
}

async function main() {
  await loadGreeneKingParser();

  const beveragePath = join(ROOT, "data/pubmaxxing/london_pub_all_beverages_expanded.csv");
  const pintPath = join(ROOT, "public/data/pint_prices_app_dataset.json");
  const drinkOutDir = join(ROOT, "public/data/drink_price_updates");
  const foodOutDir = join(ROOT, "public/data/food_price_updates");
  const gkDir = join(ROOT, "data/greene_king");
  const osmPath = join(gkDir, "osm_city_pubs.json");

  mkdirSync(drinkOutDir, { recursive: true });
  mkdirSync(foodOutDir, { recursive: true });

  const dataset = loadPintDatasetVenues(pintPath);
  console.log(`Loaded ${dataset.length} unique London venues from pint dataset`);

  const drinkUpdates = [];
  const foodUpdates = [];
  const matchedSlugs = new Set();
  let csvRows = 0;
  let csvMatched = 0;
  let csvDroppedUnmatched = 0;
  let csvDroppedBad = 0;

  if (existsSync(beveragePath)) {
    const rows = await loadBeverageCsv(beveragePath);
    const gkRows = rows.filter(
      (r) =>
        /greeneking\.co\.uk/i.test(r.source_url || "") ||
        /greeneking\.co\.uk/i.test(r.website || "") ||
        /greene\s*king/i.test(r.chain_name || ""),
    );
    console.log(`Beverage CSV: ${gkRows.length} Greene King rows of ${rows.length}`);

    for (const r of gkRows) {
      csvRows += 1;
      const menuUrl = (r.source_url || "").trim();
      const parts = slugFromUrl(menuUrl);
      if (!parts) {
        csvDroppedBad += 1;
        continue;
      }
      const venue = findVenueBySlug(dataset, parts.slug);
      if (!venue) {
        csvDroppedUnmatched += 1;
        continue;
      }
      matchedSlugs.add(parts.slug);
      const category = mapCsvCategory(r.beverage_category, r.beverage_subcategory);
      const priceGbp = Number(r.base_price_gbp);
      const drinkName = (r.beverage_name || "").trim();
      const observedAt =
        r.source_observed_at ||
        (r.price_observed_date ? `${r.price_observed_date}T12:00:00.000Z` : "2026-07-07T09:53:07.214Z");
      const extra = {};
      if (r.abv && Number.isFinite(Number(r.abv))) extra.abv = Number(r.abv);
      if (r.serving_size) extra.servingSize = r.serving_size;
      const stamped = stampDrink(venue.venueKey, drinkName, category, priceGbp, menuUrl, observedAt, extra);
      if (!stamped) {
        csvDroppedBad += 1;
        continue;
      }
      drinkUpdates.push(stamped);
      csvMatched += 1;
    }
  } else {
    console.log(`SKIP missing ${beveragePath}`);
  }

  // Optional raw menu scrapes (markdown) under data/greene_king/raw/
  const rawDir = join(gkDir, "raw");
  if (existsSync(rawDir)) {
    const files = readdirSync(rawDir).filter((f) => f.endsWith(".json") || f.endsWith(".md"));
    for (const file of files) {
      const full = join(rawDir, file);
      let markdown = "";
      let menuUrl = "";
      let name = "";
      let observedAt = "2026-07-07T12:00:00.000Z";
      let city = "london";
      let lat = null;
      let lng = null;
      let address = "";

      if (file.endsWith(".md")) {
        markdown = readFileSync(full, "utf8");
        menuUrl = `https://www.greeneking.co.uk/pubs/greater-london/${file.replace(/\.md$/, "")}/menu`;
        name = file.replace(/\.md$/, "").replace(/-/g, " ");
      } else {
        const payload = JSON.parse(readFileSync(full, "utf8"));
        markdown = payload.markdown || payload.data?.markdown || "";
        menuUrl =
          payload.menuUrl ||
          payload.metadata?.sourceURL ||
          payload.metadata?.url ||
          payload.url ||
          "";
        name = payload.name || "";
        city = payload.city || "london";
        observedAt = payload.scrapedAt || payload.observedAt || observedAt;
        lat = payload.lat ?? null;
        lng = payload.lng ?? null;
        address = payload.address || "";
      }
      if (!markdown || !menuUrl) continue;
      const parts = slugFromUrl(menuUrl);
      let venueKey = null;
      if (city === "london" || !city) {
        const venue = parts ? findVenueBySlug(dataset, parts.slug) : null;
        venueKey = venue?.venueKey ?? null;
      } else if (Number.isFinite(lat) && Number.isFinite(lng) && name) {
        venueKey = venueCoordsGroupingKey(name, address, lat, lng);
      } else if (parts && existsSync(osmPath)) {
        const osm = JSON.parse(readFileSync(osmPath, "utf8"));
        const hit = osm.find((p) => {
          const s = slugFromUrl(p.menuUrl || p.website || "");
          return s && s.slug === parts.slug;
        });
        if (hit) {
          venueKey = venueCoordsGroupingKey(hit.name, hit.address, hit.lat, hit.lng);
          menuUrl = hit.menuUrl || menuUrl;
        }
      }
      if (!venueKey) {
        console.log(`  raw scrape unmatched: ${file}`);
        continue;
      }
      const parsed = parseDrinkMarkdown(markdown);
      for (const item of parsed) {
        const stamped = stampDrink(
          venueKey,
          item.name,
          item.category,
          item.priceGbp,
          menuUrl,
          observedAt,
          {
            ...(item.abv !== undefined ? { abv: item.abv } : {}),
            ...(item.servingSize ? { servingSize: item.servingSize } : {}),
          },
        );
        if (stamped) drinkUpdates.push(stamped);
      }
      // Many GK pages default to the food "Main Menu" — harvest #### food
      // items from the same markdown when present (never invent prices).
      const foodParsed = parseFoodMarkdownBlocks(markdown);
      for (const item of foodParsed) {
        const stamped = stampFood(
          venueKey,
          item.name,
          mapFoodSection(item.section),
          item.priceGbp,
          menuUrl,
          observedAt,
          item.dietary ? { dietary: item.dietary } : {},
        );
        if (stamped) foodUpdates.push(stamped);
      }
      console.log(
        `  raw ${file}: ${parsed.length} drink / ${foodParsed.length} food → ${venueKey.slice(0, 60)}`,
      );
    }
  }

  // Optional food interact drops
  const foodDir = join(gkDir, "food");
  if (existsSync(foodDir)) {
    const allFoodFiles = readdirSync(foodDir).filter(
      (f) => f.endsWith(".txt") || f.endsWith(".md") || f.endsWith(".json"),
    );
    // Prefer .json payloads over sibling .interact.txt (same slug) to avoid
    // double-counting when both were dropped from one scrape.
    const jsonSlugs = new Set(
      allFoodFiles
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, "")),
    );
    const files = allFoodFiles.filter((f) => {
      if (!f.endsWith(".json")) {
        const slugGuess = f.replace(/\.(txt|md)$/, "").replace(/\.interact$/, "");
        if (jsonSlugs.has(slugGuess)) return false;
      }
      return true;
    });
    for (const file of files) {
      const full = join(foodDir, file);
      let text = "";
      let menuUrl = "";
      let venueKey = null;
      let observedAt = "2026-07-07T12:00:00.000Z";

      if (file.endsWith(".json")) {
        const payload = JSON.parse(readFileSync(full, "utf8"));
        text = payload.text || payload.markdown || payload.interact || "";
        menuUrl = payload.menuUrl || payload.url || "";
        observedAt = payload.scrapedAt || payload.observedAt || observedAt;
        if (payload.venueKey) venueKey = payload.venueKey;
        else if (payload.name && Number.isFinite(payload.lat) && Number.isFinite(payload.lng)) {
          venueKey = venueCoordsGroupingKey(payload.name, payload.address || "", payload.lat, payload.lng);
        }
      } else {
        text = readFileSync(full, "utf8");
        const slugGuess = file.replace(/\.(txt|md)$/, "").replace(/\.interact$/, "");
        // Resolve via London dataset first, then OSM city pubs by slug.
        const venue = findVenueBySlug(dataset, slugGuess);
        if (venue) {
          venueKey = venue.venueKey;
          menuUrl = `https://www.greeneking.co.uk/pubs/greater-london/${slugGuess}/menu`;
        } else if (existsSync(osmPath)) {
          const osm = JSON.parse(readFileSync(osmPath, "utf8"));
          const hit = osm.find((p) => {
            const s = slugFromUrl(p.menuUrl || p.website || "");
            return s && s.slug === slugGuess;
          });
          if (hit) {
            venueKey = venueCoordsGroupingKey(hit.name, hit.address, hit.lat, hit.lng);
            menuUrl = hit.menuUrl || menuUrl;
          }
        }
      }
      if (!text || !venueKey || !menuUrl) {
        console.log(`  food drop skipped (need text+venue+url): ${file}`);
        continue;
      }
      const items = parseInteractFood(text);
      for (const item of items) {
        const stamped = stampFood(
          venueKey,
          item.name,
          mapFoodSection(item.section),
          item.priceGbp,
          menuUrl,
          observedAt,
          item.dietary ? { dietary: item.dietary } : {},
        );
        if (stamped) foodUpdates.push(stamped);
      }
      console.log(`  food ${file}: ${items.length} item(s)`);
    }
  }

  // Dedupe drinks (newest observedAt wins; prefer scrape over csv by keeping order — later wins if equal)
  const drinkByKey = new Map();
  for (const u of drinkUpdates) {
    const key = drinkRowKey(u);
    const existing = drinkByKey.get(key);
    if (!existing || Date.parse(u.observedAt) >= Date.parse(existing.observedAt)) {
      drinkByKey.set(key, u);
    }
  }
  let mergedDrinks = Array.from(drinkByKey.values());

  // Merge with existing latest.json: keep demo rows for venues without GK data
  const existingDrinkPath = join(drinkOutDir, "latest.json");
  if (existsSync(existingDrinkPath)) {
    const existing = JSON.parse(readFileSync(existingDrinkPath, "utf8"));
    const existingRows = Array.isArray(existing) ? existing : existing.updates || [];
    const gkVenueKeys = new Set(mergedDrinks.map((u) => u.venueKey));
    const kept = existingRows.filter((u) => {
      if (isGkDrinkUpdate(u)) return false; // replaced by this run
      if (isDemoDrinkUpdate(u) && gkVenueKeys.has(u.venueKey)) return false;
      return true;
    });
    // Drop $comment demo-only note when real GK rows exist
    mergedDrinks = [...kept, ...mergedDrinks];
    console.log(
      `Merged with existing drink updates: kept ${kept.length} non-GK rows, ${gkVenueKeys.size} GK venue(s)`,
    );
  }

  const foodByKey = new Map();
  for (const u of foodUpdates) {
    const key = foodRowKey(u);
    const existing = foodByKey.get(key);
    if (!existing || Date.parse(u.observedAt) >= Date.parse(existing.observedAt)) {
      foodByKey.set(key, u);
    }
  }
  const mergedFood = Array.from(foodByKey.values());

  const generatedAt = new Date().toISOString();
  const stamp = yyyymmdd(new Date(generatedAt));
  const hasGk = mergedDrinks.some(isGkDrinkUpdate);

  const drinkBody = {
    ...(hasGk
      ? {}
      : {
          $comment:
            "DEMO drink-price-update file. Real prices may only be added from verified PERMISSIBLE first-party sources (see data/price_sources.json drinkSources).",
        }),
    version: 1,
    generatedAt,
    updates: mergedDrinks,
  };
  if (hasGk) {
    drinkBody.$comment =
      "Greene King official-site drink prices (merged with any remaining non-GK rows). Source: greeneking.co.uk — attributed first-party use only.";
  }

  const foodBody = {
    $comment:
      "Food price updates from permissible first-party sources (Greene King official menus). Attributed use only.",
    version: 1,
    generatedAt,
    updates: mergedFood,
  };

  const drinkDated = join(drinkOutDir, `prices_${stamp}.json`);
  const foodDated = join(foodOutDir, `prices_${stamp}.json`);
  writeFileSync(drinkDated, `${JSON.stringify(drinkBody, null, 2)}\n`, "utf8");
  writeFileSync(join(drinkOutDir, "latest.json"), `${JSON.stringify(drinkBody, null, 2)}\n`, "utf8");
  writeFileSync(foodDated, `${JSON.stringify(foodBody, null, 2)}\n`, "utf8");
  writeFileSync(join(foodOutDir, "latest.json"), `${JSON.stringify(foodBody, null, 2)}\n`, "utf8");

  writeFileSync(
    join(foodOutDir, "README.md"),
    `# Permissible-source FOOD price updates

Versioned, provenance-stamped price files for food dishes on the venue Menu tab
(\`lib/food.ts\` / \`lib/foodPriceUpdates.ts\`). Parallel to
\`public/data/drink_price_updates/\`.

## File naming

\`prices_YYYYMMDD.json\` — one file per merge run (\`scripts/merge_greene_king_menus.mjs\`).
\`latest.json\` is a stable alias.

## Schema

\`\`\`jsonc
{
  "version": 1,
  "generatedAt": "2026-07-11T00:00:00.000Z",
  "updates": [
    {
      "venueKey": "prospect of whitby|57 wapping wall, e1w 3sh|51.50710|-0.05113",
      "itemName": "Fish & Chips",
      "category": "mains", // starters|sharers|mains|burgers|desserts|sides|bar-snacks|other
      "priceGbp": 19.95,
      "source": {
        "label": "Greene King — official site",
        "url": "https://www.greeneking.co.uk/pubs/greater-london/prospect-of-whitby/menu",
        "licence": "All rights reserved — first-party publisher; attributed use only."
      },
      "observedAt": "2026-07-07T12:00:00.000Z"
    }
  ]
}
\`\`\`

## City venue keys

Same formula as London \`venueGroupingKey\`:
\`\${name}|\${address}|\${lat.toFixed(5)}|\${lng.toFixed(5)}\` (lower-cased,
whitespace-collapsed) — **no city-id salt**. City slim pins recover address
from \`filterHints.searchText\` so updates attach without \`VenuePrice\` rows.
\`venue.id\` is also accepted as a lookup alias by \`venueMenuLookupKeys\`.

## Governance

First-party / permissible sources ONLY. See \`data/price_sources.json\`
\`drinkSources\` entry \`greene-king-official\`.
`,
    "utf8",
  );

  console.log(`\nCSV matched drink rows: ${csvMatched} (scanned ${csvRows}, unmatched venue ${csvDroppedUnmatched}, bad ${csvDroppedBad})`);
  console.log(`Unique GK slugs matched: ${matchedSlugs.size}`);
  console.log(`Wrote ${mergedDrinks.length} drink update(s) → ${drinkDated}`);
  console.log(`Wrote ${mergedFood.length} food update(s) → ${foodDated}`);
}

const isDirect =
  process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isDirect) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
