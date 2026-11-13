// Re-collect the bundled London pint prices from their own source and apply the
// fresh figures IN PLACE.
//
// The bundle contains rows and fields absent from the CSV. Re-exporting the
// CSV cannot preserve those layers, so this lane updates held rows in place.
// Collection and publication instructions: data/README.md#re-collecting-the-prices.
//
// A ROW IS READ AGAINST ITS OWN LISTING PAGE. The venue canonicalizer rewrites
// a merged row's name, address and point to another listing's, and leaves
// `pub_url` alone. So a held row is matched by the listing its `pub_url` (or
// `constructed_pub_url`) names, never by its display name, and a row with no
// pint-prices listing is not this lane's to re-read.
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
// MIN_COVERAGE_RATIO of held priced rows with a pint-prices listing URL,
// the run refuses and exits non-zero rather than publish a thin read as a full one.
//
// A CAPTURE IS REPLAYED, NOT FETCHED. `--capture <dir>` reads the pages an
// earlier collection saved (see `readCapture`) instead of the network, so the
// policy row is not asked: nothing is fetched. Its rows are dated by the
// capture's own last request.
//
// Usage:
//   node scripts/refresh_pint_price_observations.mjs --report-only
//   node scripts/refresh_pint_price_observations.mjs
//   node scripts/refresh_pint_price_observations.mjs --capture <dir> \
//     --attach-matched-listings --unmatched-report <path>

import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path, { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

import { createRobotsChecker } from "../lib/harvest/robots.ts";
import {
  harvestRedirectLanding,
  harvestSource,
  isHarvestableOperatorUrl,
} from "../lib/harvest/sourcePolicy.ts";
import {
  attachMatchedListings,
  listingFromPubUrl,
  normaliseKey,
  rowListing,
  rowObservationKey,
} from "./lib/pintPricesListings.mjs";

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
// The origin a capture replay reads its sitemap from: the host it was read on.
const PINT_PRICES_ORIGIN = "https://www.pint-prices.com";
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
function readBoroughObservations(html, observations, listings) {
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
      recordListing(listings, { ...pub, url: null }, pint?.[0], price);
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
function readPubPageObservations(html, observations, listings, pageUrl) {
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
  const page = listingFromPubUrl(pageUrl);
  const listing = {
    ...(page ?? { name, address }),
    latitude: /var lat = "([^"]+)"/.exec(html)?.[1],
    longitude: /var lon = "([^"]+)"/.exec(html)?.[1],
    url: pageUrl,
  };
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
    // The page's own URL names the listing a held row points at, and the
    // heading can spell it differently, so the price is filed under both.
    if (page && normaliseKey(page.name, page.address) !== normaliseKey(name, address)) {
      record(observations, page.name, page.address, cells[1], price);
    }
    recordListing(listings, listing, cells[1], price);
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

/** A listing with its own point and page, for the rows no held row states. */
function recordListing(listings, pub, pint, price) {
  const name = cleanText(pub?.name);
  const address = cleanText(pub?.address);
  const pintName = cleanText(pint);
  if (!name || !address || !pintName) return;
  const key = normaliseKey(name, address);
  let listing = listings.get(key);
  if (!listing) {
    listing = {
      name,
      address,
      latitude: Number(pub?.latitude),
      longitude: Number(pub?.longitude),
      url: pub?.url ?? null,
      pints: new Map(),
    };
    listings.set(key, listing);
  }
  const pintKey = normaliseKey(pintName);
  const held = listing.pints.get(pintKey);
  if (held) held.prices.add(price);
  else listing.pints.set(pintKey, { pint: pintName, prices: new Set([price]) });
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
  return readPintPricesPages(fetchText, new URL(source.url).origin, () => sleepImpl(delayMs));
}

/**
 * Pages read on an earlier, permitted collection, replayed from disk. Nothing
 * is fetched. `dir` holds `fetch_log.jsonl` (one `{url, status, at}` per
 * request) and `raw/<first 16 hex of sha1(url)>.html.gz`. Only a page the log
 * records as answered 200 is read, and `collectedAt` is the last request's
 * instant. Re-observed and attached rows share that capture timestamp.
 */
export async function readCapture(dir) {
  const log = new Map();
  for (const line of (await readFile(path.join(dir, "fetch_log.jsonl"), "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const entry = JSON.parse(line);
    log.set(entry.url, entry);
  }
  const instants = [...log.values()].map((entry) => Date.parse(entry.at)).filter(Number.isFinite);
  if (instants.length === 0) throw new Error(`${dir}/fetch_log.jsonl records no request`);
  return {
    collectedAt: new Date(Math.max(...instants)).toISOString().replace(/\.\d{3}Z$/, "+00:00"),
    async fetchText(url) {
      if (log.get(url)?.status !== 200) throw new Error(`${url} is not an answered page in ${dir}`);
      const name = `${createHash("sha1").update(url).digest("hex").slice(0, 16)}.html.gz`;
      return gunzipSync(await readFile(path.join(dir, "raw", name))).toString("utf8");
    },
  };
}

/** Read every borough and pub page the source's sitemap lists. */
export async function readPintPricesPages(fetchText, origin, pause = async () => {}) {
  const { boroughs, pubs } = await readSitemapUrls(fetchText, origin);
  const observations = new Map();
  const listings = new Map();
  let boroughPagesWithData = 0;

  for (const url of boroughs) {
    await pause();
    const rows = readBoroughObservations(await fetchText(url), observations, listings);
    if (rows > 0) boroughPagesWithData += 1;
  }
  let pubPagesWithData = 0;
  for (const url of pubs) {
    await pause();
    const rows = readPubPageObservations(await fetchText(url), observations, listings, url);
    if (rows > 0) pubPagesWithData += 1;
  }

  return {
    observations,
    listings,
    boroughPages: boroughs.length,
    boroughPagesWithData,
    pubPages: pubs.length,
    pubPagesWithData,
  };
}

/** Decide the fresh figure for one held row, or null when nothing was read. */
export function freshPriceFor(observations, row) {
  // A row is read against the listing page its price came from, never its
  // display name: the canonicalizer rewrites a merged row's name and address
  // to another listing's, and that listing's price is not this row's.
  const key = rowObservationKey(row);
  const observed = key ? observations.get(key) : undefined;
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

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index < 0 ? null : (process.argv[index + 1] ?? null);
}

async function main() {
  const captureDir = argValue("--capture");
  // Refuse before reading anything, local files included, when no policy row
  // permits this source. A capture replay fetches nothing.
  if (!captureDir) permittedPintPricesSource();
  const reportOnly = process.argv.includes("--report-only");
  const attach = process.argv.includes("--attach-matched-listings");
  const unmatchedPath = argValue("--unmatched-report");

  const capture = captureDir ? await readCapture(path.resolve(captureDir)) : null;
  const collectedAt = capture?.collectedAt ?? new Date().toISOString().replace(/\.\d{3}Z$/, "+00:00");

  const rows = JSON.parse(await readFile(DATASET_JSON, "utf8"));
  if (!Array.isArray(rows)) throw new Error(`Expected an array in ${DATASET_JSON}`);
  // Only a row read from a pint-prices listing is this lane's to re-read.
  const pricedRows = rows.filter(
    (row) => typeof row.price_gbp === "number" && Number.isFinite(row.price_gbp) && rowListing(row),
  );

  const collected = capture
    ? await readPintPricesPages(capture.fetchText, PINT_PRICES_ORIGIN)
    : await collect();
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

  const { added, unmatched } = attach
    ? attachMatchedListings(rows, collected.listings, collectedAt)
    : { added: [], unmatched: [] };
  if (attach) {
    const reasons = Object.entries(Object.groupBy(unmatched, (row) => row.reason))
      .map(([reason, list]) => `${reason} ${list.length}`)
      .join(", ");
    console.log(`Attached ${added.length} new pint row(s) to held venues; unmatched: ${reasons || "none"}`);
    if (unmatchedPath) {
      await writeFile(unmatchedPath, unmatched.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
      console.log(`Wrote ${unmatched.length} unmatched row(s) to ${unmatchedPath}`);
    }
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
  await writeFile(DATASET_JSON, JSON.stringify([...rows, ...added]), "utf8");

  // The CSV is the export's input, so it takes the same figures: leaving it
  // behind would make the next `npm run export:data` revert this collection.
  // Each record is read against the source by its OWN listing and pint, never
  // by the bundle's app price id: the CSV's ids were reassigned by a later
  // build and no longer name the same rows the bundle's ids name.
  const csv = await readFile(DATASET_CSV, "utf8");
  const records = splitCsvRecords(csv);
  const header = splitCsvLine(records[0]);
  const pubUrlIndex = header.indexOf("pub_url");
  const constructedUrlIndex = header.indexOf("constructed_pub_url");
  const pintIndex = header.indexOf("pint_name");
  const priceIndex = header.indexOf("price_gbp");
  const textIndex = header.indexOf("price_text");
  const scrapedIndex = header.indexOf("scraped_at_values");
  if (
    [pubUrlIndex, constructedUrlIndex, pintIndex, priceIndex, textIndex, scrapedIndex].some((index) => index < 0)
  ) {
    throw new Error(
      `${DATASET_CSV} is missing pub_url/constructed_pub_url/pint_name/price_gbp/price_text/scraped_at_values`,
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
          pub_url: cells[pubUrlIndex],
          constructed_pub_url: cells[constructedUrlIndex],
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
