#!/usr/bin/env node
/**
 * Refresh the What's-On QUIZ payload (PRD_WHATS_ON B3) from the quiz
 * suppliers' own public venue listings (first-party finders only):
 *
 *   Question One   https://questionone.com/venues/  (robots.txt: allowed)
 *     The shared reader in questionOneDirectory.mjs owns directory pagination
 *     and field selection. Rows use stated facts for Greater London only,
 *     with the next weekly occurrence as startsAt. Each row links to the
 *     venue's page on Question One.
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
 *   ALLOWED row for it (QUESTION_ONE_SOURCE_ID, SPEEDQUIZZING_SOURCE_ID). The
 *   Question One row was allowed on 28 Oct 2026. SpeedQuizzing has no row, so
 *   its coverage read is recorded as refused and fetches nothing. A supplier
 *   with no allowed row is never read; adding a row is the captain's call.
 *   With a row, every request goes through scripts/lib/permittedHarvestFetch.mjs:
 *   the URL must be on the row's own host, and robots.txt is read by
 *   lib/harvest/robots.ts (a 401, 403, challenge page, 5xx or unreachable host
 *   refuses; a 404 permits).
 *
 * Usage:
 *   node scripts/whatson/quizRefresh.mjs                  # live fetch
 *   node scripts/whatson/quizRefresh.mjs --from-dir DIR   # offline (tests):
 *     DIR holds saved pages: qo_api_p*.json (the directory JSON, page by
 *     page), sq_find.html
 *
 * Output: public/data/whats_on/quiz_london.json
 * Runs on the weekly PR-gated refresh rail — never pushes to main.
 */

import { mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseQuestionOneVenuesApi,
  parseSpeedQuizzingFindEvents,
  isGreaterLondonLatLng,
  buildQuestionOneRows,
} from "./quizParsers.mjs";
import { QUESTION_ONE_SOURCE_ID, readQuestionOneDirectory } from "./questionOneDirectory.mjs";
import { loadCanonicalVenueIndex } from "./resolveVenueId.mjs";
import { CONTACT_EMAIL } from "../../lib/siteContact.mjs";
import { createRobotsChecker } from "../../lib/harvest/robots.ts";
import {
  HarvestRefusal,
  createPermittedFetch,
  permittedHarvestSource,
} from "../lib/permittedHarvestFetch.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT_PATH = join(ROOT, "public", "data", "whats_on", "quiz_london.json");

const QO_VENUES_URL = "https://questionone.com/venues/";
const SQ_FIND_URL = "https://www.speedquizzing.com/find/";
const USER_AGENT =
  `PubmaxxingBot/0.1 (+https://pubmaxxing.com; what's-on data curation; contact ${CONTACT_EMAIL})`;
const FETCH_DELAY_MS = 1500;

/** The lib/harvest/sourceRegistry.ts rows a live run needs. SpeedQuizzing has none. */
export { QUESTION_ONE_SOURCE_ID };
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
  return read;
}

export async function loadQuestionOne(fromDir, network = {}) {
  if (fromDir) {
    const cards = [];
    const detailsByUrl = new Map();
    for (const f of readdirSync(fromDir).filter((f) => /^qo_api_p\d+\.json$/.test(f)).sort()) {
      const parsed = parseQuestionOneVenuesApi(JSON.parse(readFileSync(join(fromDir, f), "utf8")));
      cards.push(...parsed.cards);
      for (const [url, detail] of parsed.detailsByUrl) detailsByUrl.set(url, detail);
    }
    return { cards, detailsByUrl };
  }

  const permission = permittedHarvestSource(QUESTION_ONE_SOURCE_ID);
  if (!permission.allowed) throw new HarvestRefusal(permission.message);
  const { fetchImpl = fetch, robots, sleep = defaultSleep } = network;
  const permittedFetch = createPermittedFetch({
    source: permission.source,
    fetchImpl,
    robots: robots ?? createRobotsChecker({ fetchImpl }),
  });
  // The walk starts at the ROW's url, never at a constant of this script.
  const { cards, detailsByUrl, pages } = await readQuestionOneDirectory({
    sourceUrl: permission.source.url,
    permittedFetch: (url, init) => {
      console.log(`fetch ${url}`);
      return permittedFetch(url, init);
    },
    init: () => ({ headers: { "user-agent": USER_AGENT } }),
    sleep,
    delayMs: FETCH_DELAY_MS,
  });
  console.log(`read ${pages} directory page(s), ${cards.length} quiz slot(s)`);
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
          "Supplier's own venue directory, read as its JSON. Non-weekly cadences " +
          "(monthly/every-other) and venues outside Greater London are dropped, never guessed.",
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
