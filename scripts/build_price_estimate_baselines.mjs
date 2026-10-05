#!/usr/bin/env node
// Derive the small tables the estimate engine models from, and write them once.
//
//   npm run build:price-estimates
//
// THE ENGINE IS RUNTIME; THIS IS NOT. Estimating 38,215 UK pubs into a shipped
// artifact would put a per-pub figure on every phone and freeze it there. So
// what ships is the BASIS: a median per permitted chain and a median per
// region, a few dozen rows in total, and lib/priceEstimate.ts derives each
// pub's estimate from its own OSM-stated operator, website and postcode when a
// surface asks. One artifact, no per-pub file, no freshness problem beyond this
// table's own stamp.
//
// WHAT MAY FEED A BASIS. Only prices a permitted first-party publisher actually
// published. Permission is the NARROWER of the two governance tables: a source
// is used only when data/price_sources.json marks it permissible AND
// lib/harvest/sourcePolicy.ts does not refuse its estate. That is what keeps
// the 1,914 Nicholson's rows out today: sourcePolicy refuses Mitchells &
// Butlers on `robots-unreadable`, and the narrower rule binds.
//
// THE LONDON REGION ROWS ARE MODELLED FROM A SCRAPE, AND SAY SO. The bundled
// London dataset carries its own per-borough average in
// `estimated_average_price_text`. That figure is competitor-derived and is
// quarantined from the citable Pint Index, and it stays quarantined: it feeds
// an ESTIMATE, which `standingCarriesAuthority` already bars from every
// authority lane. Its provenance is written into the row so a reader can weigh
// it rather than having to trust it.
//
// A REGION WITH NO SAMPLE GETS NO ROW. Outside London no permitted chain menu
// has been read yet, so most of the country has no regional baseline and those
// pubs stay grey. That is the honest state, and it is what the chain harvest is
// for. Never seed a region to fill the map in.

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { boroughNameForPoint } from "../lib/londonBoroughPoint.mjs";

const ROOT = process.cwd();
const DRINK_UPDATES = path.join(ROOT, "public/data/drink_price_updates/latest.json");
const PRICE_SOURCES = path.join(ROOT, "data/price_sources.json");
const LONDON_DATASET = path.join(ROOT, "public/data/pint_prices_app_dataset.json");
const BOUNDARIES = path.join(ROOT, "data/london_boroughs_simplified.json");
const OUT_DIR = path.join(ROOT, "public/data/price_estimates");
const OUT_PATH = path.join(OUT_DIR, "baselines.json");

const MIN_SAMPLE = 3;
// A wine or cocktail borough row speaks for every pub in the borough, so one
// operator's menus cannot carry it however many of its pubs they cover.
const MIN_OPERATORS = 3;
const MIN_GBP = 2;
const MAX_GBP = 12;

// The non-beer drinks, each modelled from London borough medians only. The
// source menus do not state a serving size, so the band IS the serving claim: a
// wine line under 3 pounds is not a glass and one over 12 is a bottle, and a
// cocktail line over 15 is a jug or a sharer. Lines outside the band are
// dropped and counted, never rounded into a median.
export const DRINK_MODELS = [
  {
    category: "wine",
    minGbp: 3,
    maxGbp: 12,
    servingNote:
      "One glass. The source menus state no serving size, so lines outside this band are treated as bottles and dropped.",
  },
  {
    category: "cocktail",
    minGbp: 4,
    maxGbp: 15,
    servingNote:
      "One cocktail. The source menus state no serving size, so lines outside this band are treated as jugs or sharers and dropped.",
  },
];

// Hosts whose estate lib/harvest/sourcePolicy.ts refuses. Kept as a literal
// list rather than imported because this is a plain-node CLI and that module is
// TypeScript; __tests__/refusedEstateHosts.test.ts holds the two in step.
const REFUSED_HOSTS = [
  "nicholsonspubs.co.uk",
  "emberinns.co.uk",
  "vintageinn.co.uk",
  "oneills.co.uk",
  "sizzlingpubs.co.uk",
  "allbarone.co.uk",
  "harvester.co.uk",
  "millerandcarter.co.uk",
  "tobycarvery.co.uk",
  "browns-restaurants.co.uk",
];

// A chain's identity: the id, the OSM `operator` spellings that name it, and
// the hosts it publishes on. Operators are matched after normalisation, so
// "Greene King" and "greene king plc" land on the same row.
const CHAIN_IDENTITY = [
  {
    id: "greene-king",
    label: "Greene King",
    hosts: ["greeneking.co.uk", "hungryhorse.co.uk", "farmhouseinns.co.uk", "flaminggrill.co.uk"],
    operators: ["greene king", "hungry horse", "farmhouse inns", "flaming grill"],
  },
  {
    id: "jd-wetherspoon",
    label: "J D Wetherspoon",
    hosts: ["jdwetherspoon.com", "jdwetherspoon.co.uk"],
    operators: ["jd wetherspoon", "j d wetherspoon", "wetherspoon", "wetherspoons"],
  },
  {
    id: "youngs",
    label: "Young's",
    hosts: ["youngs.co.uk"],
    operators: ["youngs", "young and co", "young and cos brewery"],
  },
  {
    id: "fullers",
    label: "Fuller's",
    hosts: ["fullers.co.uk"],
    operators: ["fullers", "fuller smith and turner"],
  },
];

const read = (file) => JSON.parse(readFileSync(file, "utf8"));

function hostOf(url) {
  try {
    return new URL(url).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const raw = sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  return Math.round(raw * 100) / 100;
}

function permittedHosts() {
  const sources = read(PRICE_SOURCES);
  const allowed = new Set();
  for (const source of [...(sources.sources ?? []), ...(sources.drinkSources ?? [])]) {
    if (source.permissible === false) continue;
    if (typeof source.note === "string" && source.note.startsWith("PLACEHOLDER")) continue;
    const host = hostOf(source.url ?? "");
    if (host && !REFUSED_HOSTS.includes(host)) allowed.add(host);
  }
  return allowed;
}

// A pint, not a bottle and not a food line. The drink rows carry a category and
// a serving size, so this asks the row rather than guessing from the name.
function isPintRow(row) {
  if (row.category !== "beer") return false;
  if (!Number.isFinite(row.priceGbp) || row.priceGbp < MIN_GBP || row.priceGbp > MAX_GBP) return false;
  const serving = String(row.servingSize ?? "").toLowerCase();
  if (serving && !/pint|568/.test(serving)) return false;
  return true;
}

function buildChains(updates, allowedHosts, report) {
  const byChain = new Map();
  for (const row of updates) {
    const host = hostOf(row?.source?.url ?? "");
    if (!host) { report.droppedNoHost += 1; continue; }
    if (REFUSED_HOSTS.includes(host)) { report.droppedRefusedHost += 1; continue; }
    if (!allowedHosts.has(host)) { report.droppedNotPermitted += 1; continue; }
    if (!isPintRow(row)) { report.droppedNotAPint += 1; continue; }
    const identity = CHAIN_IDENTITY.find((chain) =>
      chain.hosts.some((known) => host === known || host.endsWith(`.${known}`)),
    );
    if (!identity) { report.droppedUnknownChain += 1; continue; }
    const bucket = byChain.get(identity.id) ?? { identity, prices: [], sourceUrls: new Set() };
    bucket.prices.push(row.priceGbp);
    bucket.sourceUrls.add(row.source.url);
    byChain.set(identity.id, bucket);
  }
  const chains = [];
  for (const bucket of byChain.values()) {
    if (bucket.prices.length < MIN_SAMPLE) {
      report.chainsUnderFloor.push({ id: bucket.identity.id, sampleSize: bucket.prices.length });
      continue;
    }
    chains.push({
      id: bucket.identity.id,
      label: bucket.identity.label,
      medianGbp: median(bucket.prices),
      sampleSize: bucket.prices.length,
      operators: bucket.identity.operators,
      hosts: bucket.identity.hosts,
      sourceUrls: [...bucket.sourceUrls].sort().slice(0, 8),
    });
  }
  return chains.sort((a, b) => a.id.localeCompare(b.id));
}

const boroughCode = (name) =>
  name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

// London's region rows come from the bundled dataset's own borough averages.
// The average is read off the row rather than recomputed from `price_gbp`,
// because the dataset publishes that average as its own figure and recomputing
// would invent a third number nobody stated.
function buildLondonRegions(report) {
  const dataset = read(LONDON_DATASET);
  const boundaries = read(BOUNDARIES);
  const byBorough = new Map();
  for (const row of dataset) {
    const text = String(row.estimated_average_price_text ?? "").trim();
    const match = /^£\s?(\d+(?:\.\d{1,2})?)$/.exec(text);
    if (!match) { report.londonRowsNoAverage += 1; continue; }
    const price = Number(match[1]);
    if (!Number.isFinite(price) || price < MIN_GBP || price > MAX_GBP) { report.londonRowsBadAverage += 1; continue; }
    const name = boroughNameForPoint(Number(row.latitude), Number(row.longitude), boundaries);
    if (!name) { report.londonRowsOutsideBoroughs += 1; continue; }
    const bucket = byBorough.get(name) ?? { name, prices: [] };
    bucket.prices.push(price);
    byBorough.set(name, bucket);
  }
  const regions = [];
  for (const bucket of byBorough.values()) {
    if (bucket.prices.length < MIN_SAMPLE) {
      report.regionsUnderFloor.push({ code: boroughCode(bucket.name), sampleSize: bucket.prices.length });
      continue;
    }
    regions.push({
      kind: "london_borough",
      code: boroughCode(bucket.name),
      label: bucket.name,
      medianGbp: median(bucket.prices),
      sampleSize: bucket.prices.length,
      provenance:
        "Borough averages published by the bundled London pint dataset. Competitor-derived, quarantined from the Pint Index, and used here only to model an estimate.",
    });
  }
  return regions.sort((a, b) => a.code.localeCompare(b.code));
}

// Outside London a region is only earned by permitted chain menu prices with a
// postcode on them. There are none today, so this returns nothing and says so
// rather than borrowing London's numbers for the rest of the country.
function buildPostcodeRegions(updates, allowedHosts, report) {
  const byArea = new Map();
  for (const row of updates) {
    const host = hostOf(row?.source?.url ?? "");
    if (!host || REFUSED_HOSTS.includes(host) || !allowedHosts.has(host)) continue;
    if (!isPintRow(row)) continue;
    const match = /\b([A-Z]{1,2})\d[A-Z\d]?\s*\d[A-Z]{2}\b/i.exec(String(row.venueKey ?? ""));
    if (!match) { report.postcodeRowsNoArea += 1; continue; }
    const area = match[1].toUpperCase();
    const bucket = byArea.get(area) ?? { area, prices: [] };
    bucket.prices.push(row.priceGbp);
    byArea.set(area, bucket);
  }
  const regions = [];
  for (const bucket of byArea.values()) {
    if (bucket.prices.length < MIN_SAMPLE) {
      report.regionsUnderFloor.push({ code: bucket.area, sampleSize: bucket.prices.length });
      continue;
    }
    regions.push({
      kind: "postcode_area",
      code: bucket.area,
      label: `Postcode area ${bucket.area}`,
      medianGbp: median(bucket.prices),
      sampleSize: bucket.prices.length,
      provenance: "Permitted first-party chain menu prices observed in this postcode area.",
    });
  }
  return regions.sort((a, b) => a.code.localeCompare(b.code));
}

// A venue key is `name|address|lat|lng`; the point is the only thing taken from
// it, and the borough is decided by the same point-in-polygon classifier the
// beer regions use, never from the name or the address.
function pointOfVenueKey(venueKey) {
  const parts = String(venueKey ?? "").split("|");
  const lat = Number(parts[parts.length - 2]);
  const lng = Number(parts[parts.length - 1]);
  return Number.isFinite(lat) && Number.isFinite(lng) ? { lat, lng } : null;
}

// The operator a menu page speaks for: the chain that owns its host, or the
// host itself for a pub that publishes its own menu. Every Greene King brand
// host is one operator, so a chain cannot pass for several.
function operatorOfHost(host) {
  const chain = CHAIN_IDENTITY.find((identity) =>
    identity.hosts.some((known) => host === known || host.endsWith(`.${known}`)),
  );
  return chain?.id ?? host;
}

// A non-beer drink's London borough rows. THE SAMPLE IS PUBS, NOT MENU LINES: a
// pub that lists forty wines is one pub, so each venue contributes the median of
// its own in-band lines and the borough median is taken over those. A borough
// under MIN_SAMPLE pubs or MIN_OPERATORS operators gets no row and is reported,
// not borrowed from a neighbour. Only permitted first-party hosts feed it, so a
// demo fixture or a refused estate never does.
export function buildDrinkBaselines(updates, allowedHosts, boundaries, model, report) {
  const drops = {
    droppedNoHost: 0,
    droppedNotPermitted: 0,
    droppedOutOfBand: 0,
    droppedNoPoint: 0,
    droppedOutsideBoroughs: 0,
    boroughsUnderFloor: [],
  };
  const venues = new Map();
  for (const row of updates) {
    if (row?.category !== model.category) continue;
    const host = hostOf(row?.source?.url ?? "");
    if (!host) { drops.droppedNoHost += 1; continue; }
    if (REFUSED_HOSTS.includes(host) || !allowedHosts.has(host)) { drops.droppedNotPermitted += 1; continue; }
    if (!Number.isFinite(row.priceGbp) || row.priceGbp < model.minGbp || row.priceGbp > model.maxGbp) {
      drops.droppedOutOfBand += 1;
      continue;
    }
    const point = pointOfVenueKey(row.venueKey);
    if (!point) { drops.droppedNoPoint += 1; continue; }
    const borough = boroughNameForPoint(point.lat, point.lng, boundaries);
    if (!borough) { drops.droppedOutsideBoroughs += 1; continue; }
    const venue = venues.get(row.venueKey) ?? {
      borough,
      operator: operatorOfHost(host),
      prices: [],
      sourceUrls: new Set(),
    };
    venue.prices.push(row.priceGbp);
    venue.sourceUrls.add(row.source.url);
    venues.set(row.venueKey, venue);
  }
  const byBorough = new Map();
  for (const venue of venues.values()) {
    const bucket = byBorough.get(venue.borough) ?? {
      name: venue.borough,
      medians: [],
      operators: new Set(),
      sourceUrls: new Set(),
    };
    bucket.medians.push(median(venue.prices));
    bucket.operators.add(venue.operator);
    for (const url of venue.sourceUrls) bucket.sourceUrls.add(url);
    byBorough.set(venue.borough, bucket);
  }
  const regions = [];
  for (const bucket of byBorough.values()) {
    if (bucket.medians.length < MIN_SAMPLE || bucket.operators.size < MIN_OPERATORS) {
      drops.boroughsUnderFloor.push({
        code: boroughCode(bucket.name),
        sampleSize: bucket.medians.length,
        operatorCount: bucket.operators.size,
      });
      continue;
    }
    regions.push({
      kind: "london_borough",
      code: boroughCode(bucket.name),
      label: bucket.name,
      medianGbp: median(bucket.medians),
      sampleSize: bucket.medians.length,
      operatorCount: bucket.operators.size,
      provenance: `Estimate. Median of each pub's own ${model.category} menu median over ${bucket.medians.length} pubs run by ${bucket.operators.size} operators, read from permitted first-party menus in ${bucket.name}.`,
      sourceUrls: [...bucket.sourceUrls].sort().slice(0, 8),
    });
  }
  report.drinks[model.category] = drops;
  return {
    minGbp: model.minGbp,
    maxGbp: model.maxGbp,
    servingNote: model.servingNote,
    regions: regions.sort((a, b) => a.code.localeCompare(b.code)),
  };
}

function main() {
  const report = {
    droppedNoHost: 0,
    droppedRefusedHost: 0,
    droppedNotPermitted: 0,
    droppedNotAPint: 0,
    droppedUnknownChain: 0,
    chainsUnderFloor: [],
    regionsUnderFloor: [],
    londonRowsNoAverage: 0,
    londonRowsBadAverage: 0,
    londonRowsOutsideBoroughs: 0,
    postcodeRowsNoArea: 0,
    drinks: {},
  };
  const updates = read(DRINK_UPDATES).updates ?? [];
  const allowedHosts = permittedHosts();
  const chains = buildChains(updates, allowedHosts, report);
  const regions = [
    ...buildLondonRegions(report),
    ...buildPostcodeRegions(updates, allowedHosts, report),
  ];

  const boundaries = read(BOUNDARIES);
  const drinks = {};
  for (const model of DRINK_MODELS) {
    drinks[model.category] = buildDrinkBaselines(updates, allowedHosts, boundaries, model, report);
  }

  const baselines = {
    version: 1,
    computedAt: new Date().toISOString(),
    method:
      "Chain rows are the median published pint price per permitted first-party chain menu. London region rows are the median of the bundled dataset's own per-borough average, classified point-in-polygon. Wine and cocktail rows are London borough medians over pubs, each pub counted once at the median of its own in-band menu lines, from permitted first-party menus, and a borough whose pubs are run by fewer than three operators gets no row. A basis under three prices is dropped rather than used.",
    chains,
    regions,
    drinks,
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_PATH, `${JSON.stringify(baselines, null, 2)}\n`);

  // A drop is a finding. Print every one, so a basis that quietly stops
  // qualifying is visible in the run rather than only in the empty output.
  console.log(`price estimate baselines → ${path.relative(ROOT, OUT_PATH)}`);
  console.log(`  permitted hosts: ${[...allowedHosts].sort().join(", ") || "(none)"}`);
  console.log(`  chains: ${chains.length}`);
  for (const chain of chains) console.log(`    ${chain.id}: £${chain.medianGbp} from ${chain.sampleSize} prices`);
  console.log(`  regions: ${regions.length}`);
  for (const model of DRINK_MODELS) {
    const rows = drinks[model.category].regions;
    console.log(`  ${model.category}: ${rows.length} London boroughs (band £${model.minGbp}-£${model.maxGbp})`);
  }
  console.log(`  drops: ${JSON.stringify(report)}`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) main();
