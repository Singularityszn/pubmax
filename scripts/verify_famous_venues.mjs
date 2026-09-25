#!/usr/bin/env node
/**
 * Re-verify famous-venue trading status with a live Google Places (New) Text
 * Search per row, then stamp observedAt / expiresAt for a fresh 30-day window.
 *
 * Each row ends in one outcome:
 *   confirmed  — one confident name + location match that Places reports
 *                OPERATIONAL; re-stamped for a fresh window.
 *   closed     — one confident match that Places reports CLOSED_PERMANENTLY;
 *                --write drops it.
 *   unverified — anything else: no result, no confident or an ambiguous match,
 *                or a temporary closure. The row is left unchanged and listed,
 *                and the command exits nonzero.
 *
 * A failed Places call aborts the run before anything is written, and --write
 * refuses to overwrite an existing artifact for the verified day.
 *
 * The committed artifact keeps the place id and derived verdict fields only;
 * no Google-sourced names, addresses or statuses are stored (Maps ToS).
 *
 * Usage:
 *   npm run verify:famous-venues             # report
 *   npm run verify:famous-venues -- --write  # update seeds + verification artifact
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { NIGHT_OUT_PLACE_MAX_AGE_HOURS } from "../lib/nightOutPlaceContract.mjs";
import {
  decidePlacesVerification,
  placesTextQueryForRow,
} from "./lib/famousVenuePlacesMatch.mjs";
import {
  createPlacesTextSearchClient,
  placesFromSearchPayload,
} from "./lib/googlePlacesTextSearch.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FAMOUS_DIR = join(ROOT, "data", "famous_venues");
const PACK_FILES = ["bars.json", "late_food.json", "restaurants.json"];
const VERIFICATION_WINDOW_DAYS = NIGHT_OUT_PLACE_MAX_AGE_HOURS / 24;
const MAX_LIVE_CALLS = 100;

function isoDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addCalendarDays(isoDay, days) {
  const d = new Date(`${isoDay}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return isoDateOnly(d);
}

function loadPacks() {
  const byFile = new Map();
  const rows = [];
  for (const file of PACK_FILES) {
    const path = join(FAMOUS_DIR, file);
    const pack = JSON.parse(readFileSync(path, "utf8"));
    byFile.set(file, pack);
    for (const row of pack) rows.push({ file, row });
  }
  return { byFile, rows };
}

/** Committed artifact: place id plus derived verdict only (no Google-sourced names/addresses/statuses). */
export function toCommittedPlacesCheck(check) {
  return {
    id: check.id,
    method: check.method,
    sourceUrl: check.sourceUrl,
    outcome: check.outcome,
    result: check.result,
    textQuery: check.textQuery,
    placeId: check.placeId,
    matchReason: check.matchReason,
    checkedAt: check.evidenceFetchedAt,
  };
}

export async function verifyRowWithPlaces(row, searchText) {
  const textQuery = placesTextQueryForRow(row);
  const payload = await searchText(textQuery);
  const httpStatus = payload.httpStatus;
  if (
    typeof httpStatus === "number" &&
    (httpStatus < 200 || httpStatus >= 300)
  ) {
    throw new Error(`Places Text Search failed for ${row.id}: HTTP ${httpStatus}`);
  }
  const decision = decidePlacesVerification(row, placesFromSearchPayload(payload));
  return {
    id: row.id,
    method: "places_text_search",
    sourceUrl: row.sourceUrl,
    textQuery,
    evidenceFetchedAt: payload.fetchedAt ?? null,
    outcome: decision.outcome,
    result: decision.result,
    placeId: decision.evidence?.placeId ?? null,
    matchReason: decision.evidence?.matchReason ?? null,
  };
}

async function mapSequential(items, fn) {
  const results = [];
  for (const item of items) results.push(await fn(item));
  return results;
}

function stampRow(row, verifiedDay) {
  return {
    ...row,
    observedAt: verifiedDay,
    expiresAt: addCalendarDays(verifiedDay, VERIFICATION_WINDOW_DAYS),
  };
}

/**
 * Confirmed rows are re-stamped, closed rows are dropped, and unverified rows are
 * kept exactly as they were so a transient failure never deletes a curated venue.
 */
export function applyVerification(packs, checks, verifiedDay) {
  const outcomeById = new Map(checks.map((c) => [c.id, c.outcome]));
  const next = new Map();
  for (const [file, pack] of packs) {
    next.set(
      file,
      pack
        .filter((row) => outcomeById.get(row.id) !== "closed")
        .map((row) =>
          outcomeById.get(row.id) === "confirmed" ? stampRow(row, verifiedDay) : row,
        ),
    );
  }
  return next;
}

export function summarizeVerification(checks) {
  const idsWith = (outcome) => checks.filter((c) => c.outcome === outcome).map((c) => c.id);
  return {
    rowsChecked: checks.length,
    confirmed: idsWith("confirmed").length,
    closed: idsWith("closed"),
    unverified: idsWith("unverified"),
  };
}

async function main() {
  const write = process.argv.includes("--write");
  const verifiedDay = isoDateOnly(new Date());
  const { byFile, rows } = loadPacks();

  console.log(
    `Famous venue Places verification (${VERIFICATION_WINDOW_DAYS}-day window); verifiedDay=${verifiedDay}; write=${write}`,
  );

  const outPath = join(FAMOUS_DIR, `verification_${verifiedDay}.json`);
  if (write && existsSync(outPath)) {
    console.error(`${outPath} already exists; refusing to overwrite the verified day's artifact`);
    process.exit(1);
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error("GOOGLE_PLACES_API_KEY is required");
    process.exit(1);
  }
  const client = createPlacesTextSearchClient({ apiKey, maxLiveCalls: MAX_LIVE_CALLS });
  const checks = await mapSequential(rows, ({ row }) =>
    verifyRowWithPlaces(row, client.searchText),
  );

  const confirmed = checks.filter((c) => c.outcome === "confirmed");
  const closed = checks.filter((c) => c.outcome === "closed");
  const unverified = checks.filter((c) => c.outcome === "unverified");

  for (const check of confirmed) {
    console.log(`CONFIRMED ${check.id}: ${check.result} (${check.matchReason})`);
  }
  for (const check of closed) {
    console.log(`CLOSED ${check.id}: ${check.result} placeId=${check.placeId}`);
  }
  for (const check of unverified) {
    console.log(`UNVERIFIED ${check.id}: ${check.result} (${check.matchReason})`);
  }
  console.log(`Places live API calls: ${client.getLiveCallCount()}`);
  console.log(
    `Summary: ${confirmed.length}/${checks.length} renewed, ${closed.length} removed, ${unverified.length} still withheld`,
  );

  if (!write) {
    if (closed.length || unverified.length) process.exit(1);
    return;
  }

  for (const [file, pack] of applyVerification(byFile, checks, verifiedDay)) {
    writeFileSync(join(FAMOUS_DIR, file), `${JSON.stringify(pack, null, 2)}\n`);
  }

  const committedChecks = checks.map(toCommittedPlacesCheck);
  const artifact = {
    version: 4,
    verifiedAt: verifiedDay,
    method:
      "places_text_search: live Google Places API (New) Text Search on the verified day; committed artifact stores placeId and derived verdict fields only (Maps ToS).",
    summary: {
      ...summarizeVerification(committedChecks),
      placesLiveApiCalls: client.getLiveCallCount(),
    },
    checks: committedChecks,
  };
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${outPath}`);
  if (unverified.length) {
    console.error(`Still withheld: ${unverified.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
