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
 *                or a temporary closure. The row is left unchanged and listed.
 *                A Places match whose price anchor is missing, redirects to
 *                another page, or sits off the row's own source pages is
 *                unverified too, so a renewal never re-publishes a price from
 *                a page that moved on. A redirect that only adds or drops www.
 *                or a trailing slash is the same page.
 *                A full run exits nonzero. A --limit batch records them and
 *                exits 0 so the next day can take the rows not yet checked.
 *
 * A failed Places call aborts the run before anything is written. --write
 * refuses to overwrite an existing artifact for the verified day, unless
 * --limit is set: that day's checks are merged, and a row already checked
 * in the unfinished re-verification is not sent to Places again.
 *
 * The committed artifact keeps the place id and derived verdict fields only;
 * no Google-sourced names, addresses or statuses are stored (Maps ToS).
 *
 * Usage:
 *   npm run verify:famous-venues             # report
 *   npm run verify:famous-venues -- --write  # update seeds + verification artifact
 *   npm run verify:famous-venues -- --write --limit 40
 *     # oldest observedAt first, at most 40 checks in today's artifact
 */

import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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

function rowOwnSourceUrls(row) {
  return [
    row.sourceUrl,
    row.story?.sourceUrl,
    ...(row.fameGates ?? []).map((gate) => gate.sourceUrl),
  ].filter((url) => typeof url === "string");
}

function isUnderSource(sourceUrl, url) {
  const source = new URL(sourceUrl);
  const target = new URL(url);
  const prefix = source.pathname.endsWith("/") ? source.pathname : `${source.pathname}/`;
  return (
    source.host === target.host &&
    (target.pathname === source.pathname || target.pathname.startsWith(prefix))
  );
}

/** One page, setting aside a leading www. and a trailing slash a site adds to canonicalise it. */
function canonicalPage(url) {
  const { protocol, host, pathname, search } = new URL(url);
  return `${protocol}//${host.replace(/^www\./, "")}${pathname.replace(/\/+$/, "")}${search}`;
}

/** Asks the anchor page for its status without following a redirect. */
export async function headAnchorSource(url) {
  const response = await fetch(url, { method: "HEAD", redirect: "manual" });
  return { status: response.status, location: response.headers.get("location") };
}

/** Why a confirmed row's anchor may not be renewed, or null when it may. */
export async function anchorRenewalBlock(row, headSource) {
  const anchorUrl = row.anchor?.sourceUrl;
  if (typeof anchorUrl !== "string") return "anchor_missing";
  if (!rowOwnSourceUrls(row).some((source) => isUnderSource(source, anchorUrl))) {
    return "anchor_source_not_row_source";
  }
  let head;
  try {
    head = await headSource(anchorUrl);
  } catch {
    return "anchor_source_unreachable";
  }
  if (
    head.status >= 300 &&
    head.status < 400 &&
    (!head.location ||
      canonicalPage(new URL(head.location, anchorUrl).href) !== canonicalPage(anchorUrl))
  ) {
    return "anchor_source_redirected";
  }
  return null;
}

export async function verifyRowWithPlaces(row, searchText, headSource) {
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
  const anchorBlock =
    decision.outcome === "confirmed" ? await anchorRenewalBlock(row, headSource) : null;
  return {
    id: row.id,
    method: "places_text_search",
    sourceUrl: row.sourceUrl,
    textQuery,
    evidenceFetchedAt: payload.fetchedAt ?? null,
    outcome: anchorBlock ? "unverified" : decision.outcome,
    result: anchorBlock ?? decision.result,
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

export function parseVerificationLimit(argv) {
  const index = argv.indexOf("--limit");
  if (index === -1) return null;
  const limit = Number(argv[index + 1]);
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer");
  }
  return limit;
}

/** How many new Places calls this invocation may make. Today's checks count against --limit. */
export function remainingBatchSize(limit, alreadyVerifiedToday) {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer");
  }
  const already = Number.isInteger(alreadyVerifiedToday) ? Math.max(0, alreadyVerifiedToday) : 0;
  return Math.max(0, limit - already);
}

/**
 * Ids already checked in the unfinished re-verification. Artifacts are walked
 * by date: a re-verification closes once its ids cover every seed id seen in
 * an artifact so far, so its ids stay eligible. A seed id no artifact has
 * checked is new and never holds a re-verification open.
 */
export function idsCoveredByPartialVerifications(artifacts, seedIds) {
  const seed = [...seedIds];
  const byDate = [...artifacts].sort((a, b) =>
    String(a?.verifiedAt).localeCompare(String(b?.verifiedAt)),
  );
  const seen = new Set();
  let open = new Set();
  for (const artifact of byDate) {
    for (const check of artifactChecks(artifact)) {
      if (typeof check?.id !== "string") continue;
      seen.add(check.id);
      open.add(check.id);
    }
    if (seed.every((id) => !seen.has(id) || open.has(id))) open = new Set();
  }
  return [...open];
}

/** Oldest observedAt first, then id. skipIds are not sent to Places again. */
export function selectVerificationBatch(entries, { limit = null, skipIds = [] } = {}) {
  const skip = new Set(skipIds);
  const pending = entries
    .filter((entry) => !skip.has(entry.row.id))
    .sort((a, b) => {
      const byDate = String(a.row.observedAt).localeCompare(String(b.row.observedAt));
      if (byDate !== 0) return byDate;
      return String(a.row.id).localeCompare(String(b.row.id));
    });
  if (limit == null) return pending;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error("--limit must be a positive integer");
  }
  return pending.slice(0, limit);
}

function artifactChecks(artifact) {
  return Array.isArray(artifact?.checks) ? artifact.checks : [];
}

function loadVerificationArtifacts() {
  return readdirSync(FAMOUS_DIR)
    .filter((name) => /^verification_\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(FAMOUS_DIR, name), "utf8")));
}

function mergeChecks(existing, incoming) {
  const byId = new Map(existing.map((check) => [check.id, check]));
  for (const check of incoming) byId.set(check.id, check);
  return [...byId.values()];
}

async function main() {
  const write = process.argv.includes("--write");
  const limit = parseVerificationLimit(process.argv);
  const verifiedDay = isoDateOnly(new Date());
  const { byFile, rows } = loadPacks();

  console.log(
    `Famous venue Places verification (${VERIFICATION_WINDOW_DAYS}-day window); verifiedDay=${verifiedDay}; write=${write}; limit=${limit ?? "none"}`,
  );

  const outPath = join(FAMOUS_DIR, `verification_${verifiedDay}.json`);
  let existingArtifact = null;
  if (write && existsSync(outPath)) {
    if (limit == null) {
      console.error(`${outPath} already exists; refusing to overwrite the verified day's artifact`);
      process.exit(1);
    }
    existingArtifact = JSON.parse(readFileSync(outPath, "utf8"));
  }

  let entries = rows;
  let skipIds = [];
  if (limit != null) {
    const priorArtifacts = loadVerificationArtifacts();
    const today = priorArtifacts.find((artifact) => artifact.verifiedAt === verifiedDay) ?? null;
    const checkedToday = artifactChecks(today).length;
    const room = remainingBatchSize(limit, checkedToday);
    if (room === 0) {
      console.log(`Today's batch already has ${checkedToday} checks; not calling Places again`);
      return;
    }
    skipIds = idsCoveredByPartialVerifications(
      priorArtifacts,
      rows.map(({ row }) => row.id),
    );
    entries = selectVerificationBatch(rows, { limit: room, skipIds });
    if (entries.length === 0) {
      console.log("No famous-venue rows left in this re-verification");
      return;
    }
    console.log(
      `Batch: ${entries.length} row(s), oldest ${entries[0].row.observedAt} ${entries[0].row.id}`,
    );
  }

  const apiKey = process.env.GOOGLE_PLACES_API_KEY;
  if (!apiKey) {
    console.error("GOOGLE_PLACES_API_KEY is required");
    process.exit(1);
  }
  const client = createPlacesTextSearchClient({
    apiKey,
    maxLiveCalls: limit == null ? MAX_LIVE_CALLS : entries.length,
  });
  const checks = await mapSequential(entries, ({ row }) =>
    verifyRowWithPlaces(row, client.searchText, headAnchorSource),
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
  const mergedChecks = existingArtifact
    ? mergeChecks(artifactChecks(existingArtifact), committedChecks)
    : committedChecks;
  const priorCalls = existingArtifact?.summary?.placesLiveApiCalls ?? 0;
  const artifact = {
    version: 4,
    verifiedAt: verifiedDay,
    method:
      "places_text_search: live Google Places API (New) Text Search on the verified day; committed artifact stores placeId and derived verdict fields only (Maps ToS).",
    summary: {
      ...summarizeVerification(mergedChecks),
      placesLiveApiCalls: priorCalls + client.getLiveCallCount(),
    },
    checks: mergedChecks,
  };
  writeFileSync(outPath, `${JSON.stringify(artifact, null, 2)}\n`);
  console.log(`Wrote ${outPath}`);
  if (closed.length) {
    console.log(
      `Next: add ${closed.map((c) => c.id).join(", ")} to data/famous_venues/removed.json`,
    );
  }
  const skipAfter = new Set([...skipIds, ...mergedChecks.map((check) => check.id)]);
  const stillPending =
    limit == null ? [] : selectVerificationBatch(rows, { skipIds: [...skipAfter] });
  if (limit == null || stillPending.length === 0) {
    console.log("Next: run npm run refresh:slim, then commit the slim");
  } else {
    console.log(`Next batch: ${stillPending.length} row(s) remain`);
  }
  if (unverified.length && limit == null) {
    console.error(`Still withheld: ${unverified.map((c) => c.id).join(", ")}`);
    process.exit(1);
  }
  if (unverified.length) {
    console.log(`Still withheld: ${unverified.map((c) => c.id).join(", ")}`);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
