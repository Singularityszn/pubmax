#!/usr/bin/env node
/**
 * Refresh the What's-On SPORT payload (PRD_WHATS_ON B2) from Greene King's own
 * public per-pub pages (first-party chain pages ONLY):
 *
 *   https://www.greeneking.co.uk/pubs/{region}/{slug}   (robots.txt: allowed)
 *     Each pub page inlines a first-party boolean "sports":true|false. We emit
 *     ONE venue-level attribute row per pub flagged true (kind:"sport", with no
 *     startsAt — it is an attribute, not a timed event). The venue list comes
 *     from the already-scraped identities in data/greene_king/raw/*.menu.json,
 *     plus every Greater London Greene King pub in the canonical dataset
 *     (public/data/pint_prices_app_dataset.json).
 *
 * GOVERNANCE:
 *   - Public first-party chain pages only. We fetch /pubs/{region}/{slug} and
 *     nothing else. robots.txt is honoured for every path we touch.
 *   - We NEVER touch FANZO booking links. Timed fixtures (kickoff times) are
 *     delivered through Greene King's FANZO partner behind gated booking URLs
 *     (/*book?sportId=, /*book?date=) which robots.txt disallows and which are
 *     not first-party data. So the timed sport_whats_on.json stays EMPTY with a
 *     meta note; only venue-level attributes go to sport_attributes.json.
 *   - Polite: descriptive UA with a contact address, 1.5s between requests.
 *   - PERMISSION (2026-10-16; this used to fail open on any robots error): a
 *     live run fetches only when lib/harvest/sourcePolicy.ts holds an ALLOWED
 *     row with id GREENE_KING_SPORT_SOURCE_ID. None exists today (the Greene
 *     King rows that do exist grant deals and menu prices, and a permission is
 *     as narrow as the decision that granted it), so a live run REFUSES before
 *     any request, writes nothing and exits non-zero; adding a row is the
 *     captain's call. With a row, every request goes through
 *     scripts/lib/permittedHarvestFetch.mjs: the URL must be on the row's own
 *     host, and robots.txt is read by lib/harvest/robots.ts (a 401, 403,
 *     challenge page, 5xx or unreachable host refuses; a 404 permits).
 *
 * Usage:
 *   node scripts/whatson/scrape_greene_king_sport.mjs                 # live
 *   node scripts/whatson/scrape_greene_king_sport.mjs --from-dir DIR  # offline
 *     DIR holds saved pub pages named <slug>.html (one per menu.json venue).
 *
 * Output:
 *   public/data/whats_on/sport_attributes.json  (venue-level attribute rows)
 *   public/data/whats_on/sport_whats_on.json    (timed rows — honestly EMPTY)
 * Runs on the PR-gated refresh rail — never pushes to main.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseGreeneKingSportsFlag,
  pubPageUrlFromMenuUrl,
  buildSportAttributeRows,
  greeneKingLondonVenueRecords,
} from "./greeneKingSportParser.mjs";
import { CONTACT_EMAIL } from "../../lib/siteContact.mjs";
import { createRobotsChecker } from "../../lib/harvest/robots.ts";
import {
  HarvestRefusal,
  createPermittedFetch,
  permittedHarvestSource,
} from "../lib/permittedHarvestFetch.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RAW_DIR = join(ROOT, "data", "greene_king", "raw");
const CANONICAL_DATASET_PATH = join(ROOT, "public", "data", "pint_prices_app_dataset.json");
const OUT_DIR = join(ROOT, "public", "data", "whats_on");
const ATTRS_PATH = join(OUT_DIR, "sport_attributes.json");
const TIMED_PATH = join(OUT_DIR, "sport_whats_on.json");

const ORIGIN = "https://www.greeneking.co.uk";
const USER_AGENT =
  `PubmaxxingBot/0.1 (+https://pubmaxxing.com; what's-on data curation; contact ${CONTACT_EMAIL})`;
const FETCH_DELAY_MS = 1500;

/** The lib/harvest/sourceRegistry.ts row a live run needs. It does not exist today. */
export const GREENE_KING_SPORT_SOURCE_ID = "greene-king-pub-sport";

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The live reader, or a HarvestRefusal before any page is fetched: the policy
 * row must be allowed, and robots.txt (lib/harvest/robots.ts) must permit the
 * row's own /pubs/ path.
 */
export async function openGreeneKingSportReader({ fetchImpl = fetch, robots, sleep = defaultSleep } = {}) {
  const permission = permittedHarvestSource(GREENE_KING_SPORT_SOURCE_ID);
  if (!permission.allowed) throw new HarvestRefusal(permission.message);
  const permittedFetch = createPermittedFetch({
    source: permission.source,
    fetchImpl,
    robots: robots ?? createRobotsChecker({ fetchImpl }),
  });
  await permittedFetch.assertPermitted(new URL("/pubs/", permission.source.url).href);
  return async function read(url) {
    const res = await permittedFetch(url, { headers: { "user-agent": USER_AGENT } });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    const text = await res.text();
    await sleep(FETCH_DELAY_MS);
    return text;
  };
}

// Load the venue identities we already hold (name+address+lat+lng+menuUrl):
// the raw menu.json records, then every Greater London Greene King pub in the
// canonical dataset that the raw records do not already cover.
function loadVenues() {
  const raw = readdirSync(RAW_DIR)
    .filter((f) => f.endsWith(".menu.json"))
    .sort()
    .map((f) => JSON.parse(readFileSync(join(RAW_DIR, f), "utf8")))
    .filter((r) => r && r.menuUrl);
  const seen = new Set(raw.map((r) => pubPageUrlFromMenuUrl(r.menuUrl)));
  const london = greeneKingLondonVenueRecords(JSON.parse(readFileSync(CANONICAL_DATASET_PATH, "utf8"))).filter(
    (r) => !seen.has(pubPageUrlFromMenuUrl(r.menuUrl)),
  );
  return [...raw, ...london];
}

async function resolveSportFlag(record, fromDir, read) {
  const url = pubPageUrlFromMenuUrl(record.menuUrl);
  const slug = url.split("/").filter(Boolean).pop() ?? "";
  let html = "";
  if (fromDir) {
    const p = join(fromDir, `${slug}.html`);
    if (!existsSync(p)) return null;
    html = readFileSync(p, "utf8");
  } else {
    console.log(`fetch ${url}`);
    try {
      html = await read(url);
    } catch (err) {
      console.warn(`  fetch failed (${err.message}); flag undetermined`);
      return null;
    }
  }
  return parseGreeneKingSportsFlag(html);
}

async function main() {
  const fromDirFlag = process.argv.indexOf("--from-dir");
  const fromDir = fromDirFlag >= 0 ? process.argv[fromDirFlag + 1] : null;
  const observedAt = new Date().toISOString();

  // Refuses (and writes nothing) before any page request unless the policy row
  // is allowed and robots permits /pubs/.
  const read = fromDir ? null : await openGreeneKingSportReader();

  const records = loadVenues();
  const venues = [];
  for (const record of records) {
    const showsSport = await resolveSportFlag(record, fromDir, read);
    venues.push({ record, showsSport });
  }

  const { rows, counts } = buildSportAttributeRows({ venues, observedAt });

  const attrs = {
    generatedAt: observedAt,
    kind: "sport_attributes",
    sources: [
      {
        label: "Greene King",
        url: `${ORIGIN}/pubs/`,
        firstParty: true,
        pubsChecked: counts.pubsChecked,
        showsLiveSport: counts.showsLiveSport,
        noLiveSport: counts.noLiveSport,
        notes:
          'Each Greene King pub page (/pubs/{region}/{slug}) carries a first-party ' +
          '"sports":true|false flag. One attribute row is emitted per pub flagged ' +
          "true; the rest are counted, never guessed. Timed fixtures are FANZO " +
          "partner-gated (see sport_whats_on.json) and are not published here.",
      },
    ],
    rows,
  };

  // The timed sport payload stays honestly EMPTY: fixtures are partner-gated.
  const timed = {
    generatedAt: observedAt,
    kind: "sport",
    sources: [
      {
        label: "Greene King live-sport (FANZO)",
        url: `${ORIGIN}/live-sport`,
        firstParty: true,
        rowsEmitted: 0,
        notes:
          "Timed sport fixtures (kickoff times) are delivered via Greene King's " +
          "FANZO partner behind gated booking links (/*book?sportId=, " +
          "/*book?date=), which robots.txt disallows and which are not first-party " +
          "data. No timed rows are emitted. Venue-level 'shows live sport' " +
          "attributes live in sport_attributes.json.",
      },
    ],
    rows: [],
  };

  mkdirSync(OUT_DIR, { recursive: true });
  writeSportPayload(ATTRS_PATH, attrs);
  writeFileSync(TIMED_PATH, `${JSON.stringify(timed, null, 2)}\n`);
  console.log(`wrote ${rows.length} attribute rows -> ${ATTRS_PATH}`);
  console.log(`counts: ${JSON.stringify(counts)}`);
  console.log(`timed sport payload left empty (partner-gated) -> ${TIMED_PATH}`);
}

// Meta pretty-printed, rows one-per-line: reviewable diffs without an
// indentation tax on the row list (mirrors quizRefresh.mjs).
function writeSportPayload(path, payload) {
  const meta = JSON.stringify({ ...payload, rows: undefined }, null, 2)
    .replace(/\n\}$/, "")
    .replace(/\s*"rows": undefined,?/, "");
  const rowLines = payload.rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  const body = payload.rows.length
    ? `${meta},\n  "rows": [\n${rowLines}\n  ]\n}\n`
    : `${meta},\n  "rows": []\n}\n`;
  writeFileSync(path, body);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof HarvestRefusal ? err.message : err);
    process.exit(1);
  });
}
