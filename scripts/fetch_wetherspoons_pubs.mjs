#!/usr/bin/env node
/**
 * Refresh the J D Wetherspoon first-party pub directory.
 *
 *   npm run fetch:wetherspoons-pubs
 *
 * THE SOURCE TABLE DECIDES, NOT THIS SCRIPT. The endpoint and the crawl delay
 * come from the `wetherspoon-pub-directory` entry in lib/harvest/sourcePolicy.ts,
 * robots.txt is asked again live before the first read, and a redirect that
 * lands outside the allow-list is refused. This file names no URL of its own.
 *
 * NO KEY. The WP REST endpoint used to answer a plain read with a
 * Cloudflare-cached page of about 10 pubs, so this refresh went through
 * Firecrawl. On 2026-09-14 it answered 827 pubs over 9 pages, so the read is
 * direct. A read that disagrees with the endpoint's own `x-wp-total`, or that is
 * far smaller than the committed directory, is refused rather than published.
 *
 * Output:
 *   public/data/wetherspoons/pubs.json (single committed source; the app
 *     fetches this path at runtime) + pubs.geojson (kept in both locations)
 *   data/wetherspoons/ (facilities/region/pub_status taxonomies)
 *
 * Does NOT invent food/drink prices: the website does not publish them.
 */

import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createRobotsChecker, fetchHarvestedPage } from "../lib/harvest/robots.ts";
import {
  harvestSource,
  isHarvestSourceAllowed,
} from "../lib/harvest/sourcePolicy.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "data", "wetherspoons");
const PUBLIC_OUT = join(ROOT, "public", "data", "wetherspoons");
const PUBLIC_PUBS = join(PUBLIC_OUT, "pubs.json");

export const WETHERSPOON_DIRECTORY_SOURCE_ID = "wetherspoon-pub-directory";

const PER_PAGE = 100;
/** A run may never become a crawl: 20 pages of 100 is more than twice the estate. */
const MAX_PAGES = 20;
const PAGE_TIMEOUT_MS = 30_000;
const USER_AGENT = "PUBMAXXHarvest/1.0 (+https://pubmaxxing.com; hello@pubmaxxing.com)";
/**
 * The smallest read, as a share of the committed directory, that may replace
 * it. The estate moves by a handful of pubs a quarter; a read that loses a
 * tenth of it is a broken read, not a closure wave.
 */
const MIN_SHARE_OF_COMMITTED = 0.9;

/**
 * Coordinates the directory states wrongly, corrected here so a refresh cannot
 * quietly undo them. Each is keyed by the pub's WP id and names the evidence.
 */
const COORDINATE_CORRECTIONS = [
  {
    wpId: 23414,
    name: "The William Chambers",
    postcode: "EH1 1HU",
    correct: (pub) => ({ ...pub, longitude: -Math.abs(pub.longitude) }),
    note: "1 corrected coordinate: The William Chambers (Edinburgh, EH1 1HU) longitude sign-flip +3.19099 → -3.19099 (lat + postcode confirm Edinburgh).",
  },
];

function directorySource() {
  const source = harvestSource(WETHERSPOON_DIRECTORY_SOURCE_ID);
  if (!source) throw new Error(`No ${WETHERSPOON_DIRECTORY_SOURCE_ID} entry in lib/harvest/sourcePolicy.ts`);
  return source;
}

/** One page of one collection on the directory's API, derived from the register entry. */
export function wetherspoonDirectoryEndpoint(collection, page) {
  const base = directorySource().url.replace(/\/pubs$/, "");
  return `${base}/${collection}?per_page=${PER_PAGE}&page=${page}`;
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms));

const NAMED_ENTITIES = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

/** WP REST renders a title as HTML (`The Swan &amp; Angel`); the directory stores text. */
function decodeHtmlEntities(value) {
  return value.replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (entity, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : entity;
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity;
  });
}

function text(value) {
  if (value && typeof value === "object") return decodeHtmlEntities(String(value.rendered || "")).trim();
  return decodeHtmlEntities(String(value || "")).trim();
}

function textOrNull(value) {
  return text(value) || null;
}

function toFloat(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function byTermId(ids) {
  return [...(ids || [])].sort((a, b) => a - b);
}

function createReader(source) {
  const robots = createRobotsChecker();
  const delayMs = (source.crawlDelaySeconds ?? 1) * 1000;
  let requests = 0;

  return async function read(url) {
    if (requests === 0) {
      const decision = await robots(url);
      if (!decision.allowed) {
        throw new Error(`robots.txt refuses ${url}: ${decision.evidence}`);
      }
    } else {
      await sleep(delayMs);
    }
    requests += 1;

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
    try {
      const result = await fetchHarvestedPage(url, robots, {
        headers: { accept: "application/json", "user-agent": USER_AGENT },
        signal: controller.signal,
      });
      if (!result.ok) throw new Error(`${url} was refused by outbound page fence (${result.reason})`);
      const { response } = result;
      if (!response.ok) throw new Error(`${url} answered HTTP ${response.status}`);
      return {
        items: await response.json(),
        total: Number(response.headers.get("x-wp-total")),
        totalPages: Number(response.headers.get("x-wp-totalpages")),
      };
    } finally {
      clearTimeout(timer);
    }
  };
}

async function readCollection(read, collection) {
  const byId = new Map();
  let total = Number.NaN;
  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = wetherspoonDirectoryEndpoint(collection, page);
    const answer = await read(url);
    if (!Array.isArray(answer.items)) throw new Error(`${url} did not answer a JSON array`);
    for (const item of answer.items) byId.set(item.id, item);
    total = answer.total;
    console.log(`  ${collection} page ${page}/${answer.totalPages}: ${answer.items.length} (running ${byId.size})`);
    if (!Number.isFinite(answer.totalPages) || page >= answer.totalPages) break;
  }
  // The endpoint states its own size. A read that disagrees with it is the
  // cached-page failure this script used to route around, and it is refused.
  if (Number.isFinite(total) && byId.size !== total) {
    throw new Error(`${collection}: read ${byId.size} items but the endpoint states x-wp-total ${total}`);
  }
  return [...byId.values()];
}

function normalize(pubs, source, facById, regionById, statusById) {
  const corrections = new Map(COORDINATE_CORRECTIONS.map((row) => [row.wpId, row]));
  return pubs
    .map((p) => {
      const acf = p.acf || {};
      const pub = {
        wpId: p.id,
        jdwPubId: String(acf.jdw_pub_id || "") || null,
        slug: p.slug,
        name: text(p.title),
        pageUrl: p.link,
        menuUrl: p.slug ? `https://www.jdwetherspoon.com/pub-menus/${p.slug}/` : null,
        phone: textOrNull(acf.phone_number),
        fullAddress: textOrNull(acf.full_address),
        addressLine1: textOrNull(acf.address_line_1),
        addressLine2: textOrNull(acf.address_line_2),
        townCity: textOrNull(acf.towncity),
        county: textOrNull(acf.county),
        postcode: textOrNull(acf.postcode),
        country: textOrNull(acf.country),
        latitude: toFloat(acf.latitude),
        longitude: toFloat(acf.longitude),
        bookATableLink: textOrNull(acf.book_a_table_link),
        regularOpeningTimes: acf.regular_opening_times || [],
        holidayOpeningTimes: acf.holiday_opening_times ?? null,
        childrensOpeningHour: acf.childrens_opening_hour || null,
        childrensTerminalHour: acf.childrens_terminal_hour || null,
        openingTimeNotes: acf.opening_time_notes || null,
        pubStatusNotes: acf.pub_status_notes || null,
        pubWithHotel: Boolean(acf.pub_with_hotel),
        pubHotelLink: textOrNull(acf.pub_hotel_link),
        // The API returns a pub's terms in no fixed order: two reads a month
        // apart gave 352 pubs the same facilities in a new order. Taxonomy id
        // order is one the next refresh keeps.
        facilities: byTermId(p.facilities).map((id) => facById.get(id) || `facility:${id}`),
        regions: byTermId(p.region).map((id) => regionById.get(id) || `region:${id}`),
        statuses: byTermId(p["pub-status"]).map((id) => statusById.get(id) || `status:${id}`),
        modified: p.modified,
        menuPricesAvailableOnWeb: false,
        source: {
          label: source.label,
          url: p.link || "https://www.jdwetherspoon.com/",
          licence: "first-party public website / REST API",
        },
      };
      const correction = corrections.get(pub.wpId);
      if (!correction) return pub;
      if (pub.name !== correction.name || pub.postcode !== correction.postcode) {
        throw new Error(`Coordinate correction for wpId ${pub.wpId} no longer names ${correction.name}, ${correction.postcode}`);
      }
      return correction.correct(pub);
    })
    // One stable order, with the WP id as the last word, so a refresh diff
    // shows only what changed.
    .sort(
      (a, b) =>
        `${a.country}|${a.townCity}|${a.name}`.localeCompare(`${b.country}|${b.townCity}|${b.name}`) ||
        a.wpId - b.wpId,
    );
}

function committedCount() {
  if (!existsSync(PUBLIC_PUBS)) return 0;
  try {
    return Number(JSON.parse(readFileSync(PUBLIC_PUBS, "utf8")).count) || 0;
  } catch {
    return 0;
  }
}

function taxonomy(items) {
  return new Map(items.map((item) => [item.id, text(item.name) || item.slug]));
}

async function main() {
  const source = directorySource();
  if (!isHarvestSourceAllowed(source)) {
    throw new Error(`${source.id} is refused in lib/harvest/sourcePolicy.ts: ${source.access.evidence}`);
  }
  const read = createReader(source);

  console.log(`Reading ${source.label} (${source.url}), ${source.crawlDelaySeconds ?? 1}s between requests`);
  const pubs = await readCollection(read, "pubs");
  const facilities = await readCollection(read, "facilities");
  const regions = await readCollection(read, "region");
  const statuses = await readCollection(read, "pub-status");

  const floor = Math.floor(committedCount() * MIN_SHARE_OF_COMMITTED);
  if (pubs.length < floor) {
    throw new Error(`Read ${pubs.length} pubs, under ${floor} (${MIN_SHARE_OF_COMMITTED} of the committed directory); refusing to publish`);
  }

  const facById = taxonomy(facilities);
  const regionById = taxonomy(regions);
  const statusById = taxonomy(statuses);
  const slim = normalize(pubs, source, facById, regionById, statusById);

  const observedAt = new Date().toISOString();
  // Provenance invariant: every pub carries {source, observedAt}. This is
  // scraped/observed directory data, never presented as community data.
  for (const pub of slim) pub.observedAt = observedAt;
  const provenance = { source: source.url, observedAt, kind: "scraped-directory" };

  const payload = {
    generatedAt: observedAt,
    source: source.url,
    discoveredVia: `First-party WP REST read under lib/harvest/sourcePolicy.ts \`${source.id}\``,
    count: slim.length,
    notes: [
      "Full UK+Spain Wetherspoon pub directory from first-party WP REST API.",
      "Fields: name, address, lat/lng, phone, opening hours, facilities, booking links, hotel flags.",
      "Lists the pubs the chain runs today: a pub the chain has sold leaves the directory.",
      "Per-pub food/drink ITEM PRICES are NOT on the website (see data/wetherspoons/README.md).",
      "menuPricesAvailableOnWeb is always false until a first-party priced feed appears.",
      ...COORDINATE_CORRECTIONS.map((row) => row.note),
      "Each pub carries {source:{label,url,licence}, observedAt}: scraped/observed provenance, never presented as community data.",
    ],
    pubs: slim,
    provenance,
  };

  mkdirSync(OUT, { recursive: true });
  mkdirSync(PUBLIC_OUT, { recursive: true });
  writeFileSync(PUBLIC_PUBS, `${JSON.stringify(payload, null, 2)}\n`);
  const idNames = (byId) =>
    `${JSON.stringify([...byId.entries()].sort(([a], [b]) => a - b).map(([id, name]) => ({ id, name })), null, 2)}\n`;
  writeFileSync(join(OUT, "facilities.json"), idNames(facById));
  writeFileSync(join(OUT, "region.json"), idNames(regionById));
  writeFileSync(join(OUT, "pub_status.json"), idNames(statusById));

  const geo = {
    type: "FeatureCollection",
    provenance,
    features: slim
      .filter((pub) => pub.latitude != null && pub.longitude != null)
      .map((pub) => ({
        type: "Feature",
        geometry: { type: "Point", coordinates: [pub.longitude, pub.latitude] },
        properties: {
          name: pub.name,
          slug: pub.slug,
          jdwPubId: pub.jdwPubId,
          townCity: pub.townCity,
          postcode: pub.postcode,
          country: pub.country,
          pageUrl: pub.pageUrl,
          menuUrl: pub.menuUrl,
          facilities: pub.facilities,
          regions: pub.regions,
          source: pub.source.label,
          observedAt: pub.observedAt,
        },
      })),
  };
  writeFileSync(join(OUT, "pubs.geojson"), JSON.stringify(geo));
  writeFileSync(join(PUBLIC_OUT, "pubs.geojson"), JSON.stringify(geo));

  console.log(`Wrote ${slim.length} pubs → public/data/wetherspoons/ (+ taxonomies in data/wetherspoons/)`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
