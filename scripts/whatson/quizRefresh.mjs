#!/usr/bin/env node
/**
 * Refresh the What's-On QUIZ payload (PRD_WHATS_ON B3) from the quiz
 * suppliers' own public venue listings (first-party finders only):
 *
 *   Question One   https://questionone.com/venues/  (robots.txt: allowed)
 *     Paginated WordPress archive; each card links a venue page carrying the
 *     weekly slot, entry fee and address. Rows are emitted for Greater London
 *     only, with the NEXT occurrence of the weekly slot as startsAt.
 *
 *   SpeedQuizzing  https://www.speedquizzing.com/find/  (page allowed)
 *     The page inlines ~1,400 upcoming events (date/day/lat/lon), but venue
 *     names and start times only exist behind /utils/… which
 *     speedquizzing.com/robots.txt DISALLOWS — so v1 records coverage counts
 *     in the payload meta and emits NO rows from this source.
 *
 *   Redtooth       https://www.redtoothquiz.co.uk/pages/find-us
 *     Checked 2026-07-11: the page is now only Redtooth's office address
 *     (they sell quiz packs; no venue finder exists any more). No rows.
 *
 * Aggregators (pubquizzers.com, londonquizmap, …) are cross-check only and
 * are never fetched or ingested by this script.
 *
 * PERMISSION (2026-10-16; this used to fail open on any robots error):
 *   A live run fetches a supplier only when lib/harvest/sourcePolicy.ts holds an
 *   ALLOWED row for it (QUESTION_ONE_SOURCE_ID, SPEEDQUIZZING_SOURCE_ID). Neither
 *   row exists today, so a live run REFUSES before any request, writes nothing
 *   and exits non-zero; adding a row is the captain's call. With a row, every
 *   request goes through scripts/lib/permittedHarvestFetch.mjs: the URL must be
 *   on the row's own host, robots.txt is read by lib/harvest/robots.ts (a 401,
 *   403, challenge page, 5xx or unreachable host refuses; a 404 permits), and
 *   the archive's rel=next is followed only on the same host.
 *
 * Usage:
 *   node scripts/whatson/quizRefresh.mjs                  # live fetch
 *   node scripts/whatson/quizRefresh.mjs --from-dir DIR   # offline (tests):
 *     DIR holds saved pages: qo_venues_p*.html, qo_detail/<slug>.html,
 *     sq_find.html
 *
 * Output: public/data/whats_on/quiz_london.json
 * Runs on the weekly PR-gated refresh rail — never pushes to main.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseQuestionOneVenuesPage,
  parseQuestionOneNextPage,
  parseQuestionOneVenueDetail,
  parseSpeedQuizzingFindEvents,
  isGreaterLondonLatLng,
  buildQuestionOneRows,
} from "./quizParsers.mjs";
import { loadCanonicalVenueIndex } from "./resolveVenueId.mjs";
import { CONTACT_EMAIL } from "../../lib/siteContact.mjs";
import { createRobotsChecker } from "../../lib/harvest/robots.ts";
import {
  HarvestRefusal,
  createPermittedFetch,
  isOnPermittedSourceHost,
  permittedHarvestSource,
} from "../lib/permittedHarvestFetch.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_PATH = join(ROOT, "public", "data", "whats_on", "quiz_london.json");

const QO_VENUES_URL = "https://questionone.com/venues/";
const SQ_FIND_URL = "https://www.speedquizzing.com/find/";
const USER_AGENT =
  `PubmaxxingBot/0.1 (+https://pubmaxxing.com; what's-on data curation; contact ${CONTACT_EMAIL})`;
const FETCH_DELAY_MS = 1500;
const MAX_ARCHIVE_PAGES = 30;

/** The lib/harvest/sourcePolicy.ts rows a live run needs. Neither exists today. */
export const QUESTION_ONE_SOURCE_ID = "questionone-quiz-venues";
export const SPEEDQUIZZING_SOURCE_ID = "speedquizzing-quiz-finder";

const defaultSleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A text GET bound to one allowed policy row. Throws HarvestRefusal (fence or
 * robots) before any page request, and an Error on a non-2xx page.
 */
function politeReader(source, { fetchImpl = fetch, robots, sleep = defaultSleep } = {}) {
  const permittedFetch = createPermittedFetch({
    source,
    fetchImpl,
    robots: robots ?? createRobotsChecker({ fetchImpl }),
  });
  async function read(url) {
    const res = await permittedFetch(url, { headers: { "user-agent": USER_AGENT } });
    if (!res.ok) throw new Error(`GET ${url} -> ${res.status}`);
    const text = await res.text();
    await sleep(FETCH_DELAY_MS);
    return text;
  }
  read.assertPermitted = permittedFetch.assertPermitted;
  return read;
}

export async function loadQuestionOne(fromDir, network = {}) {
  const pages = [];
  let read = null;
  let source = null;
  if (fromDir) {
    for (const f of readdirSync(fromDir).filter((f) => /^qo_venues_p\d+\.html$/.test(f)).sort())
      pages.push(readFileSync(join(fromDir, f), "utf8"));
  } else {
    const permission = permittedHarvestSource(QUESTION_ONE_SOURCE_ID);
    if (!permission.allowed) throw new HarvestRefusal(permission.message);
    source = permission.source;
    read = politeReader(source, network);
    // The walk starts at the ROW's url, never at a constant of this script.
    let url = source.url;
    await read.assertPermitted(url);
    for (let i = 0; url && i < MAX_ARCHIVE_PAGES; i += 1) {
      console.log(`fetch ${url}`);
      const html = await read(url);
      pages.push(html);
      url = parseQuestionOneNextPage(html, url);
    }
  }

  const cards = [];
  const seen = new Set();
  for (const html of pages) {
    for (const card of parseQuestionOneVenuesPage(html)) {
      if (seen.has(card.url)) continue;
      seen.add(card.url);
      cards.push(card);
    }
  }

  const detailsByUrl = new Map();
  for (const card of cards) {
    const slug = card.url.split("/").filter(Boolean).pop();
    if (fromDir) {
      const p = join(fromDir, "qo_detail", `${slug}.html`);
      if (existsSync(p))
        detailsByUrl.set(card.url, parseQuestionOneVenueDetail(readFileSync(p, "utf8")));
    } else {
      if (!isOnPermittedSourceHost(source, card.url)) {
        console.warn(`  ${card.url} is not on ${source.id}'s own host; detail not fetched`);
        continue;
      }
      console.log(`fetch ${card.url}`);
      try {
        detailsByUrl.set(card.url, parseQuestionOneVenueDetail(await read(card.url)));
      } catch (err) {
        console.warn(`  detail fetch failed (${err.message}); card-only data used`);
      }
    }
  }
  return { cards, detailsByUrl };
}

export async function loadSpeedQuizzingCoverage(fromDir, network = {}) {
  let html;
  if (fromDir) {
    const p = join(fromDir, "sq_find.html");
    if (!existsSync(p)) return { totalEvents: 0, londonEvents: 0 };
    html = readFileSync(p, "utf8");
  } else {
    // Coverage counts only, so a refusal here is recorded rather than fatal.
    const permission = permittedHarvestSource(SPEEDQUIZZING_SOURCE_ID);
    if (!permission.allowed) {
      console.warn(permission.message);
      return { totalEvents: 0, londonEvents: 0, refused: permission.message };
    }
    const read = politeReader(permission.source, network);
    try {
      console.log(`fetch ${permission.source.url}`);
      html = await read(permission.source.url);
    } catch (error) {
      if (!(error instanceof HarvestRefusal)) throw error;
      console.warn(error.message);
      return { totalEvents: 0, londonEvents: 0, refused: error.message };
    }
  }
  const events = parseSpeedQuizzingFindEvents(html);
  return {
    totalEvents: events.length,
    londonEvents: events.filter((e) => isGreaterLondonLatLng(e.lat, e.lng)).length,
  };
}

async function main() {
  const fromDirFlag = process.argv.indexOf("--from-dir");
  const fromDir = fromDirFlag >= 0 ? process.argv[fromDirFlag + 1] : null;
  const observedAt = new Date().toISOString();

  const { cards, detailsByUrl } = await loadQuestionOne(fromDir);
  const venueIndex = loadCanonicalVenueIndex();
  const { rows, dropped } = buildQuestionOneRows({ cards, detailsByUrl, observedAt, venueIndex });
  const sq = await loadSpeedQuizzingCoverage(fromDir);

  const payload = {
    generatedAt: observedAt,
    kind: "quiz",
    region: "greater-london",
    sources: [
      {
        label: "Question One",
        url: QO_VENUES_URL,
        firstParty: true,
        cardsSeen: cards.length,
        rowsEmitted: rows.length,
        dropped,
        notes:
          "Supplier's own venue directory. Non-weekly cadences (monthly/every-other) " +
          "and venues outside Greater London are dropped, never guessed.",
      },
      {
        label: "SpeedQuizzing",
        url: SQ_FIND_URL,
        firstParty: true,
        rowsEmitted: 0,
        coverage: sq,
        notes:
          "Find page inlines upcoming events (date/lat/lng only). Venue names/times " +
          "sit behind /utils/… which robots.txt disallows, so no rows are emitted; " +
          "counts recorded for coverage tracking.",
      },
      {
        label: "Redtooth",
        url: "https://www.redtoothquiz.co.uk/pages/find-us",
        firstParty: true,
        rowsEmitted: 0,
        notes:
          "Checked 2026-07-11: find-us page is only the company's office address — " +
          "no venue finder exists on the current site.",
      },
    ],
    rows,
  };

  // Meta pretty-printed, rows one-per-line: reviewable diffs without a 50KB
  // indentation tax on ~hundreds of rows.
  const meta = JSON.stringify({ ...payload, rows: undefined }, null, 2)
    .replace(/\n\}$/, "");
  const rowLines = payload.rows.map((r) => `    ${JSON.stringify(r)}`).join(",\n");
  const body = `${meta.replace(/"rows": undefined,?\s*/, "")},\n  "rows": [\n${rowLines}\n  ]\n}\n`;
  mkdirSync(dirname(OUT_PATH), { recursive: true });
  writeFileSync(OUT_PATH, body);
  console.log(`wrote ${rows.length} rows -> ${OUT_PATH}`);
  console.log(`dropped: ${JSON.stringify(dropped)}; speedquizzing coverage: ${JSON.stringify(sq)}`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err instanceof HarvestRefusal ? err.message : err);
    process.exit(1);
  });
}
