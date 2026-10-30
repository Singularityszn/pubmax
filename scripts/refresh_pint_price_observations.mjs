// Re-collect the bundled London pint prices from their own source and apply the
// fresh figures IN PLACE.
//
// WHY THIS EXISTS, and why it is not `npm run export:data`.
//
// The freshness registry names the pint dataset's refresh workflow as
// `export:data -> canonicalize:venues -> build:slim`. Run as named, that
// workflow cannot refresh anything and actively regresses the bundle:
//
//   * export:data re-exports data/pint_prices_app_dataset.csv, the SAME
//     committed July extract. It re-reads no page, so it produces no newer
//     observation. Stamping a fresh collection date onto its output would be
//     inventing a re-collection nobody performed.
//   * The committed artifact is LAYERED. Rows from the outer-London OSM merge,
//     the Wikipedia list, the outer-London gazetteer seed and the chain
//     gazetteer seed were added AFTER the export, and the CSV does not carry
//     them. A measured run of the named workflow took the bundle from 3,761
//     rows to 2,719: a silent loss of 1,240 committed product rows.
//
// So the collection half is here, and it is additive by construction: it only
// ever rewrites the PRICE of a row that already exists, and it can neither add
// a row nor remove one. Identity fields, venue ids, boroughs, coordinates and
// every layer are untouched, so nothing downstream that stores an app price id
// is disturbed.
//
// EVERY ROW CARRIES THE DAY IT WAS READ. A row the source still states takes
// this run's instant in `scraped_at_values`, whether or not its figure moved,
// and a row the source no longer states keeps the day it was last read. The
// app dates each price from its own row, so the registry stamp below is the
// day the dataset was last collected and never the day of a row nobody read.
//
// The registry stamp stays owned by scripts/export_app_dataset_json.py
// (--collected-at, with --stamp-only for this lane), so one writer keeps the
// single source of truth.
//
// The source is pint-prices.com, the same publisher the committed extract came
// from (data/README.md), and this reads only the pages the original extract
// read: 32 borough pages plus the pub pages the sitemap lists.
//
// NOTHING IS FETCHED WITHOUT PERMISSION, AND PERMISSION IS NOT A COMMENT.
// pint-prices.com is a price AGGREGATOR, not the pubs' own publisher, so it is
// read only under a `lib/harvest/sourceRegistry.ts` row (id `pint-prices-com`)
// that is allowed AND states its own `nonFirstPartyException`. No such row
// exists today, so this lane REFUSES before its first request. Adding the row
// is the captain's call, not a code change. With a row, every URL is taken
// from the row's own origin, every sitemap entry must stay on that host and
// pass `isHarvestableOperatorUrl`, robots.txt is asked live per page through
// `createRobotsChecker()`, a redirect is re-asked through
// `harvestRedirectLanding`, and the request names this project, not the source.
//
// A READ WE COULD NOT RUN WRITES NOTHING. If the source answers with fewer
// observations than MIN_OBSERVATION_FLOOR, or covers less than
// MIN_COVERAGE_RATIO of the priced rows we hold, the run refuses and exits
// non-zero rather than publish a thin re-collection as a full one.
//
// Usage:
//   node scripts/refresh_pint_price_observations.mjs --report-only
//   node scripts/refresh_pint_price_observations.mjs

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { createRobotsChecker } from "../lib/harvest/robots.ts";
import {
  harvestRedirectLanding,
  harvestSource,
  isHarvestableOperatorUrl,
} from "../lib/harvest/sourcePolicy.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const DATASET_JSON = path.join(ROOT, "public", "data", "pint_prices_app_dataset.json");
const DATASET_CSV = path.join(ROOT, "data", "pint_prices_app_dataset.csv");
// scripts/validate-data.mjs holds the CSV to the hash the postcode-coordinate
// build decisions were made against, so a price rewrite has to re-stamp it.
const BUILD_REPORT = path.join(ROOT, "data", "postcode_coordinate_build_report.json");
const BUILD_REPORT_OUTPUT_PATH = "data/pint_prices_app_dataset.csv";
// The only columns this lane may touch. The re-stamp asserts against this set,
// because the build report's decisions are about postcodes and coordinates: a
// row whose geography moved here would silently inherit a decision nobody made.
const WRITABLE_CSV_COLUMNS = new Set(["price_gbp", "price_text", "scraped_at_values"]);

/** The sourceRegistry row this lane needs before it may send one request. */
export const PINT_PRICES_SOURCE_ID = "pint-prices-com";
const SITEMAP_PATH = "/static/sitemap.xml";
// OUR name, our URL and our contact, the same harvest identity the other
// harvest CLIs send. The old string named the source's own site, which told it
// the bot was theirs.
const USER_AGENT = "PUBMAXXHarvest/1.0 (+https://pubmaxxing.com; hello@pubmaxxing.com)";

// Politeness between page reads: the row's own Crawl-delay when it names one,
// otherwise one second, as the chain menu lane uses.
const DEFAULT_REQUEST_DELAY_MS = 1_000;

// Refusal floors. Both are about the SOURCE answering, never about the figures
// it states: a source that has genuinely changed every price is a valid answer,
// while a source that answered with almost nothing is a failed read wearing a
// success.
const MIN_OBSERVATION_FLOOR = 2000;
const MIN_COVERAGE_RATIO = 0.85;

function normaliseKey(...parts) {
  return parts.map((part) => String(part ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "")).join("::");
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function priceToFloat(value) {
  const match = /\d+(?:\.\d+)?/.exec(String(value ?? "").replace(/[£,]/g, ""));
  return match ? Number.parseFloat(match[0]) : null;
}

/** "£5.50" - the price_text the dataset stores beside the numeric figure. */
function priceText(value) {
  return `£${value.toFixed(2)}`;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The permission this lane reads under, or a refusal that says whose call it is.
 *
 * Throws BEFORE any request when the row is absent, refused, or (because the
 * source is not first party) carries no `nonFirstPartyException`.
 */
export function permittedPintPricesSource(source = harvestSource(PINT_PRICES_SOURCE_ID)) {
  const refuse = (why) => {
    throw new Error(
      `Refusing to read pint-prices.com: ${why}. Nothing was fetched. pint-prices.com is a ` +
        `non-first-party price aggregator, so reading it needs an allowed \`${PINT_PRICES_SOURCE_ID}\` row in ` +
        "lib/harvest/sourcePolicy.ts with a `nonFirstPartyException` naming what it may take. " +
        "Adding that row is the captain's call.",
    );
  };
  if (!source) refuse(`lib/harvest/sourcePolicy.ts has no \`${PINT_PRICES_SOURCE_ID}\` row`);
  if (!source.access.allowed) refuse(`the \`${source.id}\` row is refused (${source.access.reason})`);
  if (!source.firstParty && !source.nonFirstPartyException?.trim()) {
    refuse(`the \`${source.id}\` row states no nonFirstPartyException`);
  }
  if (!isHarvestableOperatorUrl(source.url)) refuse(`the \`${source.id}\` row's url is not harvestable`);
  return source;
}

/** True when a URL is an http(s) page on the source row's own host. */
function onSourceHost(url, origin) {
  if (!isHarvestableOperatorUrl(url)) return false;
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}

/**
 * A reader bound to one permitted source: robots is asked live before each
 * page, the page must sit on the source's own host, and a redirect that lands
 * anywhere else is refused rather than read.
 */
function createSourceReader(source, { fetchImpl, robots }) {
  const origin = new URL(source.url).origin;
  return async function fetchText(url) {
    if (!onSourceHost(url, origin)) throw new Error(`${url} is not on ${origin}, so it is not read`);
    const decision = await robots(url);
    if (!decision.allowed) throw new Error(`robots.txt refuses ${url}: ${decision.evidence}`);
    const response = await fetchImpl(url, { headers: { "user-agent": USER_AGENT }, redirect: "follow" });
    const landing = harvestRedirectLanding(url, response.url);
    if (landing.outcome === "refused" || !onSourceHost(landing.url, origin)) {
      await response.body?.cancel?.();
      throw new Error(`${url} redirected outside the source to ${landing.url}`);
    }
    if (!response.ok) throw new Error(`${url} answered ${response.status}`);
    return response.text();
  };
}

async function readSitemapUrls(fetchText, origin) {
  const xml = await fetchText(`${origin}${SITEMAP_PATH}`);
  // The sitemap is the source's string, not ours: an entry off its own host is
  // dropped here and never becomes a request.
  const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)]
    .map((m) => m[1].trim())
    .filter((u) => onSourceHost(u, origin));
  return {
    boroughs: [...new Set(locs.filter((u) => u.includes("/borough-results/")))].sort(),
    pubs: [...new Set(locs.filter((u) => u.includes("/pub/")))].sort(),
  };
}

/**
 * A borough page carries every pub it lists as an embedded `pubsData` object,
 * each pub holding its own [pint name, price] pairs. Three boroughs
 * (Havering, Hillingdon, Redbridge) served that object in July and serve an
 * empty page now; their pubs are still read through the pub-page lane below,
 * so an empty borough page is counted rather than treated as a failure.
 */
function readBoroughObservations(html, observations) {
  const match = /var\s+pubsData\s*=\s*(\{[\s\S]*?\});\s*\n/.exec(html);
  if (!match) return 0;
  let data;
  try {
    data = JSON.parse(match[1]);
  } catch {
    return 0;
  }
  let count = 0;
  for (const pub of Object.values(data)) {
    for (const pint of pub?.pints ?? []) {
      const price = priceToFloat(pint?.[1]);
      if (price === null) continue;
      record(observations, pub?.name, pub?.address, pint?.[0], price);
      count += 1;
    }
  }
  return count;
}

/**
 * A pub page states its own address in the detail box and its prices in a
 * leaderboard of three-cell rows. Parsed with the same shape the original
 * Python extractor reads, so both lanes agree on what a row is.
 */
function readPubPageObservations(html, observations) {
  const detailStart = html.indexOf("detail-box");
  const boardStart = html.indexOf('class="leaderboard"');
  if (detailStart < 0 || boardStart < 0) return 0;

  const headingMatch = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html.slice(detailStart));
  const name = headingMatch ? cleanText(stripTags(headingMatch[1])) : "";
  const detail = cleanText(stripTags(html.slice(detailStart, boardStart)));
  const addressMatch = /\u{1F4CD}\s*(.*?)\s*(?:\u{1F4DE}|Not quite right\?|$)/u.exec(detail);
  const address = addressMatch ? cleanText(addressMatch[1]) : "";
  if (!name || !address) return 0;

  // The leaderboard ends with the section that holds it; slicing there keeps a
  // later `class="row"` elsewhere on the page out of the price rows.
  const boardEnd = html.indexOf("</section>", boardStart);
  const board = html.slice(boardStart, boardEnd < 0 ? html.length : boardEnd);

  let count = 0;
  for (const chunk of board.split(/<div[^>]*class="[^"]*\brow\b/)) {
    if (/^[^>]*\bheader\b/.test(chunk)) continue;
    const cells = [...chunk.matchAll(/<div[^>]*class="[^"]*\bcell\b[^"]*"[^>]*>([\s\S]*?)<\/div>/g)].map(
      (cell) => cleanText(stripTags(cell[1])),
    );
    if (cells.length < 3) continue;
    const price = priceToFloat(cells[2]);
    if (price === null) continue;
    record(observations, name, address, cells[1], price);
    count += 1;
  }
  return count;
}

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/**
 * Tags out, entities in. The entity half is load-bearing: a pub called "The
 * Bull & Gate" arrives as "&amp;", and an undecoded one leaves the letters
 * "amp" inside the identity key, so the row never matches the pub we hold.
 */
function stripTags(html) {
  return String(html)
    .replace(/<[^>]*>/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#[xX]([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-zA-Z]+);/g, (whole, name) => NAMED_ENTITIES[name.toLowerCase()] ?? whole);
}

function record(observations, name, address, pint, price) {
  const key = normaliseKey(name, address, pint);
  const held = observations.get(key);
  if (held) held.add(price);
  else observations.set(key, new Set([price]));
}

export async function collect({
  source: candidate = harvestSource(PINT_PRICES_SOURCE_ID),
  fetchImpl = fetch,
  robots = createRobotsChecker({ fetchImpl }),
  sleepImpl = sleep,
} = {}) {
  // The permission gate runs before the first request, every time.
  const source = permittedPintPricesSource(candidate);
  const delayMs = source.crawlDelaySeconds ? source.crawlDelaySeconds * 1000 : DEFAULT_REQUEST_DELAY_MS;
  const fetchText = createSourceReader(source, { fetchImpl, robots });
  const { boroughs, pubs } = await readSitemapUrls(fetchText, new URL(source.url).origin);
  const observations = new Map();
  let boroughPagesWithData = 0;

  for (const url of boroughs) {
    await sleepImpl(delayMs);
    const rows = readBoroughObservations(await fetchText(url), observations);
    if (rows > 0) boroughPagesWithData += 1;
  }
  let pubPagesWithData = 0;
  for (const url of pubs) {
    await sleepImpl(delayMs);
    const rows = readPubPageObservations(await fetchText(url), observations);
    if (rows > 0) pubPagesWithData += 1;
  }

  return {
    observations,
    boroughPages: boroughs.length,
    boroughPagesWithData,
    pubPages: pubs.length,
    pubPagesWithData,
  };
}

/** Decide the fresh figure for one held row, or null when nothing was read. */
function freshPriceFor(observations, row) {
  const observed = observations.get(normaliseKey(row.pub_name, row.address, row.pint_name));
  if (!observed) return null;
  const held = Number(row.price_gbp);
  // A pub listing the same pint at several prices keeps the figure it already
  // holds when that figure is still one of them: this refresh reports what the
  // source states, and it may not pick a cheaper one on the pub's behalf.
  if ([...observed].some((price) => Math.abs(price - held) < 0.005)) return held;
  return Math.min(...observed);
}

function splitCsvLine(line) {
  const cells = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"') {
        if (line[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      cells.push(cell);
      cell = "";
    } else cell += char;
  }
  cells.push(cell);
  return cells;
}

function joinCsvLine(cells) {
  return cells
    .map((cell) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell))
    .join(",");
}

/** Split a CSV body into records, keeping embedded newlines inside quotes. */
function splitCsvRecords(text) {
  const records = [];
  let record = "";
  let quoted = false;
  for (const char of text) {
    if (char === '"') quoted = !quoted;
    if (char === "\n" && !quoted) {
      records.push(record);
      record = "";
      continue;
    }
    record += char;
  }
  if (record !== "") records.push(record);
  return records;
}

/**
 * Prove this rewrite moved nothing but the price columns. A cell outside
 * WRITABLE_CSV_COLUMNS that changed means the CSV was rewritten by something
 * other than this lane, and the build report's postcode and coordinate
 * decisions could no longer be re-stamped honestly.
 */
function assertOnlyPriceColumnsMoved(before, after, header) {
  const beforeRecords = splitCsvRecords(before);
  const afterRecords = splitCsvRecords(after);
  if (beforeRecords.length !== afterRecords.length) {
    throw new Error(
      `Refusing to write ${DATASET_CSV}: record count moved from ${beforeRecords.length} to ${afterRecords.length}`,
    );
  }
  for (let index = 0; index < beforeRecords.length; index += 1) {
    if (beforeRecords[index] === afterRecords[index]) continue;
    const oldCells = splitCsvLine(beforeRecords[index]);
    const newCells = splitCsvLine(afterRecords[index]);
    if (oldCells.length !== newCells.length) {
      throw new Error(`Refusing to write ${DATASET_CSV}: column count moved on record ${index}`);
    }
    for (let cell = 0; cell < oldCells.length; cell += 1) {
      if (oldCells[cell] === newCells[cell]) continue;
      const column = header[cell];
      if (!WRITABLE_CSV_COLUMNS.has(column)) {
        throw new Error(
          `Refusing to write ${DATASET_CSV}: record ${index} changed "${column}", which this lane may not touch`,
        );
      }
    }
  }
}

async function main() {
  // Refuse before reading anything, local files included, when no policy row
  // permits this source.
  permittedPintPricesSource();
  const reportOnly = process.argv.includes("--report-only");
  const collectedAt = new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");

  const rows = JSON.parse(await readFile(DATASET_JSON, "utf8"));
  if (!Array.isArray(rows)) throw new Error(`Expected an array in ${DATASET_JSON}`);
  const pricedRows = rows.filter(
    (row) => typeof row.price_gbp === "number" && Number.isFinite(row.price_gbp),
  );

  const collected = await collect();
  const { observations } = collected;

  console.log(
    `Read ${collected.boroughPagesWithData}/${collected.boroughPages} borough pages with data ` +
      `and ${collected.pubPagesWithData}/${collected.pubPages} pub pages with data`,
  );
  console.log(`Fresh observations: ${observations.size} distinct pub/pint keys`);

  if (observations.size < MIN_OBSERVATION_FLOOR) {
    throw new Error(
      `Refusing to publish: the source answered ${observations.size} observations, under the ` +
        `${MIN_OBSERVATION_FLOOR} floor. A read we could not run writes nothing.`,
    );
  }

  let changed = 0;
  // Every re-observed row, with the figure the source states for it today.
  const observed = new Map();
  for (const row of pricedRows) {
    const fresh = freshPriceFor(observations, row);
    if (fresh === null) continue;
    observed.set(String(row.app_price_id), fresh);
    if (Math.abs(fresh - Number(row.price_gbp)) >= 0.005) changed += 1;
  }
  const reObserved = observed.size;

  const coverage = pricedRows.length === 0 ? 0 : reObserved / pricedRows.length;
  console.log(
    `Priced rows held: ${pricedRows.length}; re-observed today: ${reObserved} ` +
      `(${(coverage * 100).toFixed(1)}%); prices moved: ${changed}`,
  );

  if (coverage < MIN_COVERAGE_RATIO) {
    throw new Error(
      `Refusing to publish: re-observed ${(coverage * 100).toFixed(1)}% of priced rows, under the ` +
        `${(MIN_COVERAGE_RATIO * 100).toFixed(0)}% floor.`,
    );
  }

  if (reportOnly) {
    console.log("--report-only: nothing written");
    return;
  }

  for (const row of rows) {
    const fresh = observed.get(String(row.app_price_id));
    if (fresh === undefined) continue;
    row.price_gbp = Math.round(fresh * 100) / 100;
    row.price_text = priceText(row.price_gbp);
    row.scraped_at_values = collectedAt;
  }
  await writeFile(DATASET_JSON, JSON.stringify(rows), "utf8");

  // The CSV is the export's input, so it takes the same figures: leaving it
  // behind would make the next `npm run export:data` revert this collection.
  // Each record is read against the source by its OWN pub, address and pint,
  // never by the bundle's app price id: the CSV's ids were reassigned by a
  // later build and no longer name the same rows the bundle's ids name.
  const csv = await readFile(DATASET_CSV, "utf8");
  const records = splitCsvRecords(csv);
  const header = splitCsvLine(records[0]);
  const nameIndex = header.indexOf("pub_name");
  const addressIndex = header.indexOf("address");
  const pintIndex = header.indexOf("pint_name");
  const priceIndex = header.indexOf("price_gbp");
  const textIndex = header.indexOf("price_text");
  const scrapedIndex = header.indexOf("scraped_at_values");
  if ([nameIndex, addressIndex, pintIndex, priceIndex, textIndex, scrapedIndex].some((index) => index < 0)) {
    throw new Error(
      `${DATASET_CSV} is missing pub_name/address/pint_name/price_gbp/price_text/scraped_at_values`,
    );
  }
  let csvChanged = 0;
  const out = [records[0]];
  for (const record of records.slice(1)) {
    if (record === "") {
      out.push(record);
      continue;
    }
    const cells = splitCsvLine(record);
    const fresh = Number.isFinite(Number.parseFloat(cells[priceIndex]))
      ? freshPriceFor(observations, {
          pub_name: cells[nameIndex],
          address: cells[addressIndex],
          pint_name: cells[pintIndex],
          price_gbp: cells[priceIndex],
        })
      : null;
    if (fresh === null) {
      out.push(record);
      continue;
    }
    // A figure that did not move keeps its cell as written, so only the day
    // it was read changes on that record.
    if (Math.abs(fresh - Number(cells[priceIndex])) >= 0.005) {
      cells[priceIndex] = String(Math.round(fresh * 100) / 100);
      cells[textIndex] = priceText(Math.round(fresh * 100) / 100);
    }
    // The row's own evidence stamp is the day the source last stated it, so it
    // moves on every re-observed row, not only on a row whose figure moved.
    cells[scrapedIndex] = collectedAt;
    csvChanged += 1;
    out.push(joinCsvLine(cells));
  }
  // The committed file ends with a newline; joining alone would drop it and
  // rewrite the last row for no reason.
  const nextCsv = out.join("\n") + (csv.endsWith("\n") ? "\n" : "");
  assertOnlyPriceColumnsMoved(csv, nextCsv, header);
  await writeFile(DATASET_CSV, nextCsv, "utf8");

  // Re-stamp the build report's output hash. The decisions it records are
  // untouched: the assertion above proves no postcode, coordinate or identity
  // cell moved, and the report's own input hashes are of the raw extracts,
  // which this lane never writes.
  const report = JSON.parse(await readFile(BUILD_REPORT, "utf8"));
  if (report?.output?.path !== BUILD_REPORT_OUTPUT_PATH) {
    throw new Error(`${BUILD_REPORT} does not report ${BUILD_REPORT_OUTPUT_PATH} as its output`);
  }
  report.output.sha256 = createHash("sha256").update(nextCsv, "utf8").digest("hex");
  await writeFile(BUILD_REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`Dated ${observed.size} re-observed row(s) in ${DATASET_JSON}, ${changed} with a moved price`);
  console.log(`Dated ${csvChanged} re-observed record(s) in ${DATASET_CSV}`);
  console.log(`Re-stamped ${BUILD_REPORT} output hash`);
  console.log(
    "Now stamp the collection date (the registry is the single source of truth):\n" +
      `  python3 scripts/export_app_dataset_json.py --collected-at ${collectedAt} --stamp-only`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
