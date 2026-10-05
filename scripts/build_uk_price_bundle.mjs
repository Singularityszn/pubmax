#!/usr/bin/env node
// Bundle every UK drink price we hold into ONE dataset, each row carrying the
// pub it is about, the drink, the figure, where it came from, the day it was
// observed, and the standing lib/priceTier.ts gives it.
//
//   npm run build:uk-price-bundle
//   npm run build:uk-price-bundle -- --dry-run
//
// WHY A BUNDLE. Prices reach this tree down several lanes and each lane already
// owns its own rules. What did not exist was one place to ask "what do we hold
// about this pub, and how good is it", so a coverage question could only be
// answered by counting four files by hand. The bundle answers it, and answers
// it honestly: an estimate is in the file, labelled an estimate, because a
// coverage report that omits the modelled figures is not a coverage report.
//
// THIS BUILDER INVENTS NOTHING. Every row is a row a lane already produced. It
// carries that lane's own source URL and its own observation day through
// unchanged, and asks lib/priceTier.ts what the row is worth rather than
// deciding for itself.
//
// FOUR RULES.
//
// 1. THE NARROWER GOVERNANCE TABLE BINDS. A row whose source host is refused on
//    permission by lib/harvest/sourcePolicy.ts is dropped and counted, whatever
//    the allowlist says about it. That is what keeps the 1,914 Nicholson's rows
//    already sitting in public/data/drink_price_updates out of this file: the
//    estate answers robots.txt with a challenge page, so we may not read it, and
//    a bundle that republished those rows would re-commit the contradiction the
//    governance fence exists to stop.
//
// 2. A DEMO FIXTURE IS NOT A PRICE. lib/drinks.ts already knows how to spot a
//    seeded demo row, and one is never carried into a dataset that claims to say
//    what a pint costs.
//
// 3. A HARVESTED LISTING BEATS AN ESTIMATE FOR THE SAME PUB AND DRINK, and the
//    thing that says so is priceStandingFor, not this file. Both rows are
//    written; the reader asks the decider which one speaks.
//
// 4. EVERY ROW OWES A DAY, AND EVERY PUBLISHED ROW OWES A URL.
//    isValidUkPriceBundleRow refuses the rest and validate-data refuses the file
//    over it.
//
// The estimate engine is imported here deliberately, and this script is named in
// __tests__/priceEstimateAuthorityFence.test.ts for it: the bundle PRESENTS an
// estimate as an estimate, which is exactly the exception that list exists for.

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import {
  bundleDrinkFieldsFromPrintedName,
} from "@/lib/bundleDrinkFields";
import { isDemoDrinkProvenance } from "@/lib/drinks";
import {
  isHarvestableDrinkUpdateUrl,
} from "@/lib/harvest/sourcePolicy";
import { ESTIMATE_DRINK_CATEGORIES, estimateForPub } from "@/lib/priceEstimate";
import { normalizeSiteHarvestLedgerRow } from "@/lib/siteHarvestLedgerCore";
import { estimateBaselines } from "@/lib/priceEstimateBaselines";
import {
  bundleRowSupersedes,
  isCategoryQuarantined,
  isValidUkPriceBundleRow,
  ukPriceBundleCollectKey,
  UK_PRICE_BUNDLE_VERSION,
} from "@/lib/ukPriceBundle";
import { stableVenueIdFromKey } from "@/lib/venues";
import { boroughNameForPoint } from "../lib/londonBoroughPoint.mjs";
import {
  haversineMeters,
  namesLikelySamePub,
  normalizeVenueIdentityName,
} from "./lib/venueCanonicalization.mjs";

const ROOT = process.cwd();
const OSM_PUBS = path.join(ROOT, "data/osm/uk/uk_osm_pubs.json");
const UK_BASE_MANIFEST = path.join(ROOT, "public/data/uk_base/manifest.json");
const DRINK_UPDATES = path.join(
  ROOT,
  "public/data/drink_price_updates/latest.json",
);
const BOUNDARIES = path.join(ROOT, "data/london_boroughs_simplified.json");
const HARVEST_LEDGER_ROWS = path.join(
  ROOT,
  "data-harvest/uk_prices/rows.jsonl",
);
const PUBLISHED_HARVEST_ROWS = path.join(
  ROOT,
  "data/uk_prices/site_harvest.jsonl",
);
const OUT_DIR = path.join(ROOT, "public/data/uk_prices");

const DRY_RUN = process.argv.includes("--dry-run");

const read = (file) => JSON.parse(readFileSync(file, "utf8"));

const boroughCode = (name) =>
  name
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

function ukBaseVenueId(osmId) {
  if (typeof osmId !== "string") return null;
  const match = /^(node|way|relation)\/(\d+)$/.exec(osmId.trim());
  return match ? `venue-uk-${match[1][0]}${match[2]}` : null;
}

/** Every pub the shipped base shards serve, read once. */
function basePubs() {
  if (!existsSync(UK_BASE_MANIFEST)) return [];
  const manifest = read(UK_BASE_MANIFEST);
  const pubs = [];
  for (const shard of manifest.shards ?? []) {
    const file = path.join(
      ROOT,
      "public",
      manifest.urlPrefix,
      `${shard.id}.json`,
    );
    if (!existsSync(file)) continue;
    for (const pub of read(file).pubs ?? []) {
      pubs.push({ ref: pub[0], name: pub[1], lat: pub[3], lng: pub[4], curatedVenueId: pub[5] });
    }
  }
  return pubs;
}

/**
 * The curated venue that owns each base pub, read off the shipped shards. A
 * promoted pub is one pub with two ids, and writing a row under each would
 * double every count this bundle exists to report.
 */
function curatedOwners(pubs) {
  const owners = new Map();
  for (const pub of pubs) {
    if (typeof pub.curatedVenueId === "string" && pub.curatedVenueId.length > 0) {
      owners.set(pub.ref, pub.curatedVenueId);
    }
  }
  return owners;
}

// A pub OSM redrew as a new object is the same pub only this close and under
// the same name: the radius scripts/fetch_city_osm_pubs.mjs collapses two
// objects of one pub at.
const REDRAWN_PUB_METERS = 30;

/**
 * The base pub a harvested row's pub was redrawn as. A row is keyed by the OSM
 * object it was read against, and when OSM redraws that pub as a new object
 * the old ref leaves the base layer, so the row follows the same pub to its
 * new object: the same name within REDRAWN_PUB_METERS of the row's own point.
 * Null when the pub left OSM altogether.
 */
function redrawnBasePub(row, pubs) {
  const name = normalizeVenueIdentityName(row.name);
  const lat = Number(row.lat);
  const lng = Number(row.lng);
  if (!name || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  let best = null;
  let bestMetres = Number.POSITIVE_INFINITY;
  for (const pub of pubs) {
    const metres = haversineMeters(lat, lng, pub.lat, pub.lng);
    if (metres > REDRAWN_PUB_METERS || metres >= bestMetres) continue;
    if (!namesLikelySamePub(name, normalizeVenueIdentityName(pub.name))) continue;
    best = pub;
    bestMetres = metres;
  }
  return best;
}

/**
 * The venue each harvested ref is served as: its curated owner, and for a ref
 * that left the base layer, whatever serves the pub it was redrawn as, so a
 * price read before the redraw stays on the pub it was read for.
 */
function siteHarvestOwners(harvestRows, pubs, owners) {
  const served = new Set(pubs.map((pub) => pub.ref));
  const resolved = new Map(owners);
  for (const ledgerRow of harvestRows) {
    const ref =
      typeof ledgerRow?.venueId === "string" ? ledgerRow.venueId.replace(/^venue-uk-/, "") : null;
    if (!ref || served.has(ref) || resolved.has(ref)) continue;
    const successor = redrawnBasePub(ledgerRow, pubs);
    if (successor) resolved.set(ref, owners.get(successor.ref) ?? `venue-uk-${successor.ref}`);
  }
  return resolved;
}

/** The site-harvest rows, preferring the live ledger and falling back to the published copy. */
function siteHarvestRows() {
  const file = existsSync(HARVEST_LEDGER_ROWS)
    ? HARVEST_LEDGER_ROWS
    : PUBLISHED_HARVEST_ROWS;
  if (!existsSync(file)) return { rows: [], from: null };
  const rows = readFileSync(file, "utf8")
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter((row) => row && typeof row === "object");
  return { rows, from: path.relative(ROOT, file) };
}

/** Every lane's rows, gathered once, with the drops counted into `report`. */
function collectRows(report) {
  const notes = [];
  const held = new Map();

  // ONE ROW PER PUB, DRINK AND LANE. What decides is the FRESHEST READING
  // first, and the cheapest figure within it second.
  //
  // Each half answers a different question. A lane states many lines for one
  // pub's beer in ONE reading, and the figure a drinker can walk in and pay is
  // the lowest of them, so the cheapest wins there; keeping whichever happened
  // to be read first would publish an arbitrary one. Across two readings of the
  // same page, though, cheapest-wins publishes LAST YEAR'S price the moment a
  // pub puts a figure up, and dates it to the day it was cheap. A reading is
  // stamped once per page, so the rows of one page share an instant and tie
  // into the cheapest rule, and a later reading supersedes an earlier one whole.
  const push = (row) => {
    if (isCategoryQuarantined(row)) {
      report.droppedCategoryContradiction += 1;
      return;
    }
    if (!isValidUkPriceBundleRow(row)) {
      report.droppedInvalidRow += 1;
      return;
    }
    const key = ukPriceBundleCollectKey(row);
    if (!bundleRowSupersedes(row, held.get(key))) return;
    held.set(key, row);
  };

  // --- lane 1: the pub's own site, read by scripts/harvest/uk-prices --------
  const harvest = siteHarvestRows();
  const pubs = basePubs();
  const owners = curatedOwners(pubs);
  addSiteHarvestRows(
    harvest.rows,
    siteHarvestOwners(harvest.rows, pubs, owners),
    new Set(pubs.map((pub) => pub.ref)),
    push,
    report,
  );
  notes.push(
    harvest.from
      ? `site-harvest: ${harvest.rows.length} row(s) read from ${harvest.from}`
      : "site-harvest: no crawl output present, so this lane contributed nothing",
  );

  // --- lane 2: the reviewed drink-price publish ----------------------------
  if (existsSync(DRINK_UPDATES)) {
    const updates = read(DRINK_UPDATES).updates ?? [];
    addDrinkPriceUpdateRows(updates, push, report);
    notes.push(`drink-price-update: ${updates.length} row(s) considered`);
  }

  // --- lane 3: the modelled figures, labelled as modelled ------------------
  const pubCount = addEstimateRows(owners, push, report);
  notes.push(
    `estimate: ${pubCount} UK pub(s) offered to the engine, ${report.pubsWithNoBasis} with no basis`,
  );

  const rows = [...held.values()];
  rows.sort(
    (a, b) =>
      a.venueId.localeCompare(b.venueId) ||
      a.category.localeCompare(b.category) ||
      a.lane.localeCompare(b.lane),
  );
  return { rows, notes, harvest };
}

/** Lane one: the prices a pub's or a chain's own site stated. */
function addSiteHarvestRows(harvestRows, owners, servedRefs, push, report) {
  for (const ledgerRow of harvestRows) {
    const row = normalizeSiteHarvestLedgerRow(ledgerRow);
    if (!isHarvestableDrinkUpdateUrl(row.sourceUrl ?? "")) {
      report.droppedRefusedHost += 1;
      continue;
    }
    const osmRef =
      typeof row.venueId === "string"
        ? row.venueId.replace(/^venue-uk-/, "")
        : null;
    // A base pub that left OSM, and was not redrawn as another object, is no
    // pin any reader can open, so its price has nowhere honest to sit.
    const leftTheBase =
      servedRefs.size > 0 &&
      typeof row.venueId === "string" &&
      row.venueId.startsWith("venue-uk-") &&
      !servedRefs.has(osmRef) &&
      !owners.has(osmRef);
    const venueId = (osmRef && owners.get(osmRef)) || row.venueId;
    if (leftTheBase || typeof venueId !== "string" || venueId.length === 0) {
      report.droppedUnresolvedVenue += 1;
      continue;
    }
    push({
      venueId,
      name: row.name ?? null,
      category: row.category,
      priceGbp: row.priceGbp,
      lane: "site-harvest",
      standing: "listed",
      sourceUrl: row.sourceUrl,
      publisher: row.host ?? null,
      observedAt: row.observedAt,
      basis: null,
      sampleSize: null,
      ...(row.servingSize !== undefined ? { servingSize: row.servingSize } : {}),
      ...bundleDrinkFieldsFromPrintedName(
        row.drinkLabel ?? row.drinkName ?? null,
        row.category,
      ),
    });
  }
}

/** Lane two: the reviewed drink-price publish. */
function addDrinkPriceUpdateRows(updates, push, report) {
  for (const update of updates) {
    const provenance = {
      source: update?.source?.label ?? "",
      licence: update?.source?.licence ?? "",
      observedAt: update?.observedAt ?? "",
    };
    if (isDemoDrinkProvenance(provenance)) {
      report.droppedDemoFixture += 1;
      continue;
    }
    if (!isHarvestableDrinkUpdateUrl(update?.source?.url ?? "")) {
      report.droppedRefusedHost += 1;
      continue;
    }
    push({
      venueId: stableVenueIdFromKey(update.venueKey),
      name: null,
      category: update.category,
      priceGbp: update.priceGbp,
      lane: "drink-price-update",
      standing: "listed",
      sourceUrl: update.source.url,
      publisher: update.source.label ?? null,
      observedAt: update.observedAt,
      basis: null,
      sampleSize: null,
      ...(update.servingSize !== undefined ? { servingSize: update.servingSize } : {}),
      ...bundleDrinkFieldsFromPrintedName(update.drinkName, update.category),
    });
  }
}

/** Lane three: the modelled figures, labelled as modelled. */
function addEstimateRows(owners, push, report) {
  const baselines = estimateBaselines();
  const boundaries = existsSync(BOUNDARIES) ? read(BOUNDARIES) : null;
  const snapshot = read(OSM_PUBS);
  const pubs = Array.isArray(snapshot) ? snapshot : (snapshot.pubs ?? []);
  for (const pub of pubs) {
    const baseId = ukBaseVenueId(pub.osmId);
    if (!baseId) continue;
    const osmRef = baseId.replace(/^venue-uk-/, "");
    const venueId = owners.get(osmRef) || baseId;
    const boroughName =
      boundaries && Number.isFinite(pub.lat) && Number.isFinite(pub.lng)
        ? boroughNameForPoint(pub.lat, pub.lng, boundaries)
        : null;
    const modelled = {
      operator: pub.operator ?? null,
      website: pub.website ?? null,
      postcode: pub.postcode ?? null,
      londonBoroughCode: boroughName ? boroughCode(boroughName) : null,
    };
    // The engine models a PINT first, then each non-beer drink it holds a
    // London basis for. Every row is filed under the drink it was modelled for.
    let modelledAny = false;
    for (const category of ["beer", ...ESTIMATE_DRINK_CATEGORIES]) {
      const estimate = estimateForPub(modelled, baselines, category);
      if (!estimate) continue;
      modelledAny = true;
      push({
        venueId,
        name: pub.name ?? null,
        category,
        priceGbp: estimate.priceGbp,
        lane: "estimate",
        standing: "estimate",
        sourceUrl: null,
        publisher: null,
        observedAt: estimate.computedAt,
        basis: `${estimate.basis}:${estimate.basisKey}`,
        sampleSize: estimate.sampleSize,
      });
    }
    if (!modelledAny) report.pubsWithNoBasis += 1;
  }
  return pubs.length;
}

function main() {
  const report = {
    droppedRefusedHost: 0,
    droppedDemoFixture: 0,
    droppedUnresolvedVenue: 0,
    droppedInvalidRow: 0,
    droppedCategoryContradiction: 0,
    pubsWithNoBasis: 0,
  };
  const { rows, notes, harvest } = collectRows(report);

  const byStanding = {};
  const byLane = {};
  for (const row of rows) {
    byStanding[row.standing] = (byStanding[row.standing] ?? 0) + 1;
    byLane[row.lane] = (byLane[row.lane] ?? 0) + 1;
  }

  const manifest = {
    version: UK_PRICE_BUNDLE_VERSION,
    generatedAt: new Date().toISOString(),
    rowsPath: "/data/uk_prices/rows.json",
    counts: {
      rows: rows.length,
      venues: new Set(rows.map((row) => row.venueId)).size,
      byStanding,
      byLane,
    },
    notes: [
      ...notes,
      `dropped: ${report.droppedRefusedHost} on a host refused on permission, ${report.droppedDemoFixture} demo fixture(s), ${report.droppedUnresolvedVenue} with no resolvable venue, ${report.droppedInvalidRow} failing the row shape, ${report.droppedCategoryContradiction} evidenced category contradiction(s)`,
    ],
  };

  if (DRY_RUN) {
    console.log(JSON.stringify(manifest, null, 2));
    return;
  }

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(path.join(OUT_DIR, "rows.json"), `${JSON.stringify(rows)}\n`);
  writeFileSync(
    path.join(OUT_DIR, "manifest.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );

  // The published copy of the crawl's own rows, so the bundle is reproducible
  // from the tree rather than from a working directory nobody commits.
  if (harvest.rows.length > 0) {
    mkdirSync(path.dirname(PUBLISHED_HARVEST_ROWS), { recursive: true });
    writeFileSync(
      PUBLISHED_HARVEST_ROWS,
      `${harvest.rows.map((row) => JSON.stringify(row)).join("\n")}\n`,
    );
  }

  console.log(
    `uk price bundle: ${rows.length} row(s) over ${manifest.counts.venues} venue(s)`,
  );
  for (const note of manifest.notes) console.log(`  ${note}`);
  console.log(`  standings: ${JSON.stringify(byStanding)}`);
}

main();
