import { createHash } from "node:crypto";
import { openSync, closeSync, readFileSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";

const FILE_HASH = "19136150ad687a83e99fcd5dfc05fca47022b085afaefa9574f592a44d82e69a";
const MARKDOWN_HASH = "b313e450df27a53988dade751ec46a948c81aa6d6732aa8c19e7b8d535369845";
const VENUE_KEY = "the eagle|215 askew rd, london w12 9az, uk|51.50060|-0.23933";
const SOURCE_URL = "https://www.theeaglew12.co.uk/food-drink";
const OBSERVED_AT = "2026-10-13T06:51:38.364Z";
const RECEIPT = "data/enrichment/firecrawl/london/menu-review-20261013.json";
const LATEST = "public/data/food_price_updates/latest.json";
const DATED = "public/data/food_price_updates/prices_20261013.json";

function requireFact(condition, message) {
  if (!condition) throw new Error(message);
}

function one(rows, predicate, label) {
  requireFact(Array.isArray(rows), `Missing ${label} collection`);
  const matches = rows.filter(predicate);
  requireFact(matches.length === 1, `Expected one ${label}`);
  return matches[0];
}

function addServing(row) {
  requireFact(row.servingSize === undefined || row.servingSize === "3 scoops", "Conflicting serving");
  row.servingSize = "3 scoops";
}

function repair(capturePath) {
  requireFact(capturePath, "Usage: node scripts/repair-eagle-food-portion.mjs <retained-capture.json>");
  const capture = readFileSync(capturePath);
  const hash = (value) => createHash("sha256").update(value).digest("hex");
  requireFact(hash(capture) === FILE_HASH, "Capture hash mismatch");
  const markdown = JSON.parse(capture).structuredContent?.markdown;
  requireFact(typeof markdown === "string" && hash(markdown) === MARKDOWN_HASH, "Markdown hash mismatch");
  requireFact(markdown.includes("Ice cream£5.50\n\n3 scoops\n\n238kcal"), "Source portion tuple mismatch");

  const files = [RECEIPT, LATEST, DATED].map((path) => {
    const before = readFileSync(path, "utf8");
    return { path, before, data: JSON.parse(before) };
  });
  const [receipt, latest, dated] = files.map((file) => file.data);
  requireFact(isDeepStrictEqual(latest, dated), "Latest and dated packs disagree");
  const venue = one(receipt.rows, (row) => row.venueId === "venue-1hz0avt", "Eagle receipt");
  requireFact(venue.venueKey === VENUE_KEY && venue.name === "The Eagle"
    && venue.sourceUrl === SOURCE_URL && venue.observedAt === OBSERVED_AT, "Venue identity mismatch");
  const permission = venue.permissionReceipt;
  requireFact(permission?.policyAllowed === true && permission.allowed === true
    && permission.reason === "allowed" && permission.url === SOURCE_URL, "Receipt permission mismatch");
  const imported = receipt.sourceInputImport;
  requireFact(imported?.latestSourceFile === LATEST && imported.datedSourceFile === DATED
    && imported.refreshLaneRetired === true, "Import binding mismatch");
  const identity = one(imported.itemIds, (row) => row.id === "food-1j3poi9" || row.itemName === "Ice cream", "Ice cream identity");
  requireFact(identity.id === "food-1j3poi9" && identity.itemName === "Ice cream"
    && identity.category === "desserts", "Item identity mismatch");
  const candidate = one(venue.candidateFoodItems, (row) => row.itemName === "Ice cream", "receipt item");
  const targets = [candidate, ...[latest, dated].map((pack) => one(pack.updates,
    (row) => row.venueKey === VENUE_KEY && row.itemName === "Ice cream", "runtime item"))];
  for (const row of targets) {
    requireFact(row.venueKey === VENUE_KEY && row.category === "desserts" && row.priceGbp === 5.5
      && row.source?.url === SOURCE_URL && row.source.label === "The Eagle - official published menu"
      && row.observedAt === OBSERVED_AT, "Item fact tuple mismatch");
    if (row !== candidate) requireFact(row.caloriesKcal === 238, "Runtime calories mismatch");
    addServing(row);
  }
  const nutrition = one(venue.sourceNutritionObservations, (row) => row.itemName === "Ice cream", "nutrition observation");
  requireFact(nutrition.sourceStatedCaloriesKcal === 238, "Receipt calories mismatch");
  requireFact(["Ice cream£5.50\n238kcal", "Ice cream£5.50\n3 scoops\n238kcal"].includes(nutrition.sourceExcerpt), "Receipt excerpt mismatch");
  addServing(nutrition);
  nutrition.sourceExcerpt = "Ice cream£5.50\n3 scoops\n238kcal";

  const changes = files.map((file) => ({ ...file, after: `${JSON.stringify(file.data, null, 2)}\n` }))
    .filter((file) => file.after !== file.before);
  const published = [];
  const staged = [];
  try {
    for (const file of changes) {
      const path = `${file.path}.tmp`;
      const descriptor = openSync(path, "wx");
      staged.push(path);
      try {
        writeFileSync(descriptor, file.after);
      } finally {
        closeSync(descriptor);
      }
    }
    for (const file of changes) {
      renameSync(`${file.path}.tmp`, file.path);
      published.push(file);
    }
  } catch (error) {
    for (const file of published) writeFileSync(file.path, file.before);
    throw error;
  } finally {
    for (const path of staged) rmSync(path, { force: true });
  }
  console.log(changes.length ? `Repaired 3 scoops in ${changes.map((file) => file.path).join(", ")}` : "Already repaired; no changes");
}

try {
  requireFact(process.argv.length === 3, "Supply exactly one retained capture path");
  repair(process.argv[2]);
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
