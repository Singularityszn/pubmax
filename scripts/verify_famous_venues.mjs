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
 * Completed checks are checkpointed before applying them. A failed Places
 * call remains spent and halts the receipt's task. --write refuses an existing
 * daily artifact on a new full run. Partial and explicit-ID runs merge checks.
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

import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { createRobotsChecker } from "../lib/harvest/robots.ts";
import { isHarvestableOperatorUrl } from "../lib/harvest/sourcePolicy.ts";
import { readBoundedBody } from "./lib/boundedHarvestResource.mjs";

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

function loadPacks(famousDir = FAMOUS_DIR) {
  const byFile = new Map();
  const rows = [];
  for (const file of PACK_FILES) {
    const path = join(famousDir, file);
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
  let calls = 0;
  return createSourceAccess(async (kind, target, init) => {
    if (++calls > MAX_SOURCE_CALLS) throw new Error("source budget exhausted");
    return boundedWireFetch(fetch, kind, target, init);
  }, () => {}).head(url);
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
  if (head.status < 200 || head.status >= 400) return "anchor_source_http_error";
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

function loadVerificationArtifacts(famousDir = FAMOUS_DIR) {
  return readdirSync(famousDir)
    .filter((name) => /^verification_\d{4}-\d{2}-\d{2}\.json$/.test(name))
    .map((name) => JSON.parse(readFileSync(join(famousDir, name), "utf8")));
}

function mergeChecks(existing, incoming) {
  const byId = new Map(existing.map((check) => [check.id, check]));
  for (const check of incoming) byId.set(check.id, check);
  return [...byId.values()];
}

const MAX_SOURCE_CALLS = 126;
const MAX_STATE_BYTES = 1024 * 1024;
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const jsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`;

function fileHash(path) {
  return existsSync(path) ? sha256(readFileSync(path)) : null;
}

function atomicWrite(path, bytes) {
  const temporary = `${path}.${randomUUID()}.tmp`;
  let fd;
  try {
    fd = openSync(temporary, "wx", 0o600);
    writeFileSync(fd, bytes);
    fsyncSync(fd);
    closeSync(fd);
    fd = undefined;
    renameSync(temporary, path);
    const directory = openSync(dirname(path), "r");
    try { fsyncSync(directory); } finally { closeSync(directory); }
  } finally {
    if (fd !== undefined) closeSync(fd);
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}

function cancelResponse(response) {
  response?.body?.cancel().catch(() => {});
}

/** A single dispatch, including its complete body, has one deadline and byte bound. */
async function boundedWireFetch(fetchImpl, kind, url, init) {
  const controller = new AbortController();
  const timeoutMs = kind === "places" ? 20_000 : 15_000;
  let response;
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error(`${kind} request timeout`));
    }, timeoutMs);
  });
  const work = (async () => {
    response = await fetchImpl(url, {
      ...init,
      redirect: "manual",
      signal: init?.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal,
    });
    if (response.redirected) throw new Error("automatic redirect refused");
    if (kind === "head" || response.status === 429 || (response.status >= 300 && response.status < 400)) {
      cancelResponse(response);
      return new Response(null, { status: response.status, headers: response.headers });
    }
    const bytes = await readBoundedBody(response, kind === "places" ? 1024 * 1024 : 512 * 1024);
    return new Response([204, 205, 304].includes(response.status) ? null : bytes, {
      status: response.status, headers: response.headers,
    });
  })();
  try {
    return await Promise.race([work, timeout]);
  } finally {
    clearTimeout(timer);
    controller.abort();
    cancelResponse(response);
  }
}

function sameOperator(left, right) {
  const a = new URL(left);
  const b = new URL(right);
  return a.protocol === b.protocol && a.port === b.port &&
    a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");
}

/** Robots keeps its existing absent/HTML/challenge/retry decisions. Only its wire is replaced. */
function createSourceAccess(dispatch, assertRunning) {
  const robots = createRobotsChecker({ fetchImpl: async (url, init) => {
    let current = String(url);
    for (let hop = 0; hop <= 3; hop += 1) {
      assertRunning();
      if (!isHarvestableOperatorUrl(current)) throw new Error("sourcePolicy refused robots URL");
      const response = await dispatch("robots", current, init);
      assertRunning();
      if (response.status < 300 || response.status >= 400) return response;
      const location = response.headers.get("location");
      cancelResponse(response);
      if (!location || hop === 3) throw new Error("robots redirect limit");
      const next = new URL(location, current).href;
      if (!sameOperator(String(url), next) || !isHarvestableOperatorUrl(next)) {
        throw new Error("robots redirect refused");
      }
      current = next;
    }
    throw new Error("robots redirect limit");
  } });
  return { head: async (url) => {
    let current = url;
    for (let hop = 0; hop <= 1; hop += 1) {
      assertRunning();
      if (!isHarvestableOperatorUrl(current)) throw new Error("sourcePolicy refused anchor URL");
      const permission = await robots(current);
      assertRunning();
      if (!permission.allowed) throw new Error(`robots refused: ${permission.reason}`);
      const response = await dispatch("head", current, { method: "HEAD" });
      assertRunning();
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400) {
        if (!location || hop === 1) return { status: 400, location: null };
        const next = new URL(location, current).href;
        if (canonicalPage(next) !== canonicalPage(url) || !isHarvestableOperatorUrl(next)) {
          return { status: response.status, location: next };
        }
        current = next;
        continue;
      }
      return { status: response.status, location };
    }
    throw new Error("anchor redirect limit");
  } };
}

function parseRunOptions(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!["--write", "--limit", "--ids", "--spent-receipt"].includes(flag) || values.has(flag)) {
      throw new Error(`Unknown or duplicate option: ${flag}`);
    }
    if (flag === "--write") values.set(flag, true);
    else {
      const value = argv[++index];
      if (!value || value.startsWith("--")) throw new Error(`${flag} needs a value`);
      values.set(flag, value);
    }
  }
  const hasIds = values.has("--ids");
  if (hasIds !== values.has("--spent-receipt")) {
    throw new Error("Explicit --ids and --spent-receipt are required together");
  }
  const ids = hasIds ? values.get("--ids").split(",").map((id) => id.trim()) : null;
  if (ids && (ids.some((id) => !id) || new Set(ids).size !== ids.length)) {
    throw new Error("Empty or duplicate target IDs");
  }
  return {
    write: values.has("--write"), limit: parseVerificationLimit(argv),
    ids: ids?.sort() ?? null, receiptPath: values.get("--spent-receipt") ?? null,
  };
}

/** Existing producer entry, with filesystem/clock/transport boundaries injectable for offline proof. */
export async function runVerification({
  argv = process.argv.slice(2), root = ROOT, now = () => new Date(), fetchImpl = fetch,
  apiKey = process.env.GOOGLE_PLACES_API_KEY,
  stateRoot = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "pubmaxx", "famous-venue-verification"),
} = {}) {
  const options = parseRunOptions(argv);
  const famousDir = join(root, "data", "famous_venues");
  const initialDay = isoDateOnly(now());
  if (options.receiptPath && statSync(options.receiptPath).size > MAX_STATE_BYTES) {
    throw new Error("spent receipt is too large");
  }
  const receiptBytes = options.receiptPath
    ? readFileSync(options.receiptPath)
    : Buffer.from(JSON.stringify({ kind: "famous-venues-daily", day: initialDay, placesCalls: 0, maxPlacesCalls: MAX_LIVE_CALLS }));
  if (receiptBytes.length > MAX_STATE_BYTES) throw new Error("spent receipt is too large");
  let receipt;
  try { receipt = JSON.parse(receiptBytes); } catch { throw new Error("Invalid spent receipt JSON"); }
  if (!Number.isSafeInteger(receipt.maxPlacesCalls) || receipt.maxPlacesCalls < 1 ||
      receipt.maxPlacesCalls > MAX_LIVE_CALLS || !Number.isSafeInteger(receipt.placesCalls) ||
      receipt.placesCalls < 0 || receipt.placesCalls > receipt.maxPlacesCalls) {
    throw new Error("Invalid spent receipt budget");
  }
  const liveCallLimit = receipt.maxPlacesCalls;
  const receiptHash = sha256(receiptBytes);
  const taskDir = join(stateRoot, receiptHash);
  const checkpointPath = join(taskDir, "checkpoint.json");
  if (resolve(taskDir).startsWith(`${resolve(famousDir)}${sep}`) || resolve(taskDir) === resolve(famousDir)) {
    throw new Error("Checkpoint snapshots cannot alias producer outputs");
  }
  const scopeHash = sha256(JSON.stringify({ write: options.write, limit: options.limit, ids: options.ids, receiptHash }));
  const { rows } = loadPacks(famousDir);
  const knownIds = new Set(rows.map(({ row }) => row.id));
  if (!existsSync(checkpointPath) && options.ids?.some((id) => !knownIds.has(id))) {
    throw new Error("Unknown target ID");
  }
  let state;
  let isNew = false;
  mkdirSync(stateRoot, { recursive: true, mode: 0o700 });
  try { mkdirSync(taskDir, { mode: 0o700 }); isNew = true; }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  if (!isNew && !existsSync(checkpointPath)) throw new Error("Existing receipt directory has no checkpoint");
  const lockPath = join(taskDir, "lock");
  const lock = openSync(lockPath, "wx", 0o600);
  closeSync(lock);
  let checkpointBroken = false;
  const persist = () => {
    try {
      const bytes = jsonBytes(state);
      if (Buffer.byteLength(bytes) > MAX_STATE_BYTES) throw new Error("checkpoint exceeds byte limit");
      atomicWrite(checkpointPath, bytes);
    } catch (error) { checkpointBroken = true; throw error; }
  };
  const snapshot = (bytes) => {
    const hash = sha256(bytes);
    const target = join(taskDir, "snapshots", hash);
    if (existsSync(target)) {
      if (fileHash(target) !== hash) throw new Error("Immutable snapshot changed");
    } else {
      const fd = openSync(target, "wx", 0o600);
      try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
    }
    return hash;
  };
  const pinOutput = (file) => {
    if (Object.hasOwn(state.expected, file)) return;
    const path = join(famousDir, file);
    if (options.receiptPath && resolve(options.receiptPath) === resolve(path)) {
      throw new Error("Receipt snapshot aliases producer output");
    }
    const hash = existsSync(path) ? snapshot(readFileSync(path)) : null;
    state.expected[file] = hash;
    if (hash) state.snapshots.push(hash);
  };
  const assertRunning = () => {
    if (checkpointBroken) throw new Error("checkpoint failed, operator review required");
    if (state.halt) throw new Error(`Verification halted: ${state.halt}`);
  };
  const stop = (reason) => {
    state.halt = reason;
    persist();
    throw new Error(`Verification halted: ${reason}`);
  };
  const verifyExpected = () => {
    for (const [file, hash] of Object.entries(state.expected)) {
      const actual = fileHash(join(famousDir, file));
      const journal = state.journal?.files.find((item) => item.file === file);
      if (actual !== hash && (!journal || actual !== journal.after)) {
        throw new Error(`Unrelated producer edit changed preimage: ${file}`);
      }
    }
  };
  const replayJournal = () => {
    if (!state.journal) return;
    verifyExpected();
    for (const item of state.journal.files) {
      if (sha256(item.bytes) !== item.after || item.before !== state.expected[item.file]) {
        throw new Error("Invalid checkpoint write journal");
      }
      if (fileHash(join(famousDir, item.file)) !== item.after) atomicWrite(join(famousDir, item.file), item.bytes);
    }
    for (const item of state.journal.files) state.expected[item.file] = item.after;
    state.journal = null;
    persist();
  };
  try {
    if (isNew) {
      const outFile = `verification_${initialDay}.json`;
      if (options.write && !options.ids && options.limit == null && existsSync(join(famousDir, outFile))) {
        throw new Error("Refusing to overwrite the verified day's artifact");
      }
      if (options.ids?.some((id) => !knownIds.has(id))) throw new Error("Unknown target ID");
      const artifacts = loadVerificationArtifacts(famousDir);
      const skipIds = options.ids ? [] : options.limit == null ? [] : idsCoveredByPartialVerifications(artifacts, knownIds);
      const today = artifacts.find((item) => item.verifiedAt === initialDay);
      const room = options.limit == null ? null : remainingBatchSize(options.limit, artifactChecks(today).length);
      const candidates = options.ids ? rows.filter(({ row }) => options.ids.includes(row.id)) : rows;
      const entries = room === 0 ? [] : selectVerificationBatch(candidates, { limit: room, skipIds });
      state = {
        version: 1, receiptHash, scopeHash, placesCalls: receipt.placesCalls, sourceCalls: 0,
        expected: {}, snapshots: [], records: entries.map(({ row }) => ({ id: row.id, status: "pending" })),
        active: null, journal: null, halt: null,
      };
      mkdirSync(join(taskDir, "snapshots"), { mode: 0o700 });
      state.snapshots.push(snapshot(receiptBytes));
      for (const file of [...PACK_FILES, outFile]) pinOutput(file);
      state.sourceHashes = Object.fromEntries(PACK_FILES.map((file) => [file, state.expected[file]]));
      persist();
    } else {
      if (statSync(checkpointPath).size > MAX_STATE_BYTES) throw new Error("checkpoint exceeds byte limit");
      try { state = JSON.parse(readFileSync(checkpointPath, "utf8")); }
      catch { throw new Error("Invalid checkpoint JSON"); }
      if (state.version !== 1 || state.scopeHash !== scopeHash || state.receiptHash !== receiptHash) {
        throw new Error("Checkpoint scope or target mismatch");
      }
      if (!Number.isSafeInteger(state.placesCalls) || state.placesCalls < receipt.placesCalls || state.placesCalls > liveCallLimit ||
          !Number.isSafeInteger(state.sourceCalls) || state.sourceCalls < 0 || state.sourceCalls > MAX_SOURCE_CALLS ||
          !Array.isArray(state.records) || !state.expected || !Array.isArray(state.snapshots)) {
        throw new Error("Invalid checkpoint counters or records");
      }
      if (!PACK_FILES.every((file) => typeof state.sourceHashes?.[file] === "string" && Object.hasOwn(state.expected, file)) ||
          !Object.entries(state.expected).every(([file, hash]) =>
            (PACK_FILES.includes(file) || /^verification_\d{4}-\d{2}-\d{2}\.json$/.test(file)) &&
            (hash === null || /^[a-f0-9]{64}$/.test(hash))) ||
          new Set(state.records.map((record) => record.id)).size !== state.records.length ||
          !state.records.every((record) => typeof record.id === "string" &&
            (!options.ids || options.ids.includes(record.id)) &&
            ["pending", "completed", "source-blocked"].includes(record.status) &&
            (record.status !== "completed" || (record.check?.id === record.id &&
              ["confirmed", "closed", "unverified"].includes(record.check.outcome) &&
              /^\d{4}-\d{2}-\d{2}T/.test(record.check.checkedAt)))) ||
          (state.journal && (!Array.isArray(state.journal.files) || state.journal.files.length > 4 ||
            !state.journal.files.every((item) => Object.hasOwn(state.expected, item.file))))) {
        throw new Error("Invalid checkpoint source or journal");
      }
      for (const hash of state.snapshots) {
        if (!/^[a-f0-9]{64}$/.test(hash) || fileHash(join(taskDir, "snapshots", hash)) !== hash) {
          throw new Error("Immutable snapshot changed or missing");
        }
      }
      const originalIds = new Set(PACK_FILES.flatMap((file) => {
        const hash = state.sourceHashes[file];
        if (!state.snapshots.includes(hash)) throw new Error("Invalid source snapshot binding");
        return JSON.parse(readFileSync(join(taskDir, "snapshots", hash), "utf8")).map((row) => row.id);
      }));
      if (!state.records.every((record) => originalIds.has(record.id))) throw new Error("Checkpoint target source changed");
      verifyExpected();
      replayJournal();
      if (state.active) stop("indeterminate dispatched row requires operator review");
    }
    assertRunning();
    if (!apiKey && state.records.some((record) => record.status === "pending")) {
      throw new Error("GOOGLE_PLACES_API_KEY is required");
    }
    let activeId;
    const dispatch = async (kind, url, init) => {
      assertRunning();
      verifyExpected();
      const counter = kind === "places" ? "placesCalls" : "sourceCalls";
      const maximum = kind === "places" ? liveCallLimit : MAX_SOURCE_CALLS;
      if (state[counter] >= maximum) stop(`${kind === "places" ? "Places" : "source"} budget exhausted`);
      state[counter] += 1;
      state.active = { id: activeId, kind };
      persist();
      try {
        const response = await boundedWireFetch(fetchImpl, kind, url, init);
        if (kind !== "places") state.active = null;
        state.lastResponse = {
          kind, status: response.status,
          retryAfter: (response.headers.get("retry-after") ?? "").replace(/[^\x20-\x7e]/g, "").slice(0, 80),
        };
        persist();
        if (response.status === 429) stop(`${kind} HTTP 429`);
        if (kind === "places" && !response.ok) stop(`provider HTTP ${response.status}`);
        return response;
      } catch (error) {
        if (checkpointBroken || state.halt) throw error;
        state.active = null;
        if (kind === "places") stop("provider request failed");
        persist();
        throw error;
      }
    };
    const access = createSourceAccess(dispatch, assertRunning);
    const client = createPlacesTextSearchClient({
      apiKey, maxLiveCalls: liveCallLimit,
      fetchImpl: (url, init) => dispatch("places", url, init),
    });
    const commitCheck = (check) => {
      if (!options.write) return;
      const checkDay = check.checkedAt.slice(0, 10);
      const outFile = `verification_${checkDay}.json`;
      pinOutput(outFile);
      persist();
      const current = loadPacks(famousDir).byFile;
      const next = applyVerification(current, [check], checkDay);
      const outPath = join(famousDir, outFile);
      const prior = existsSync(outPath) ? JSON.parse(readFileSync(outPath, "utf8")) : null;
      const priorCalls = prior?.summary?.placesLiveApiCalls ?? 0;
      if (!Number.isSafeInteger(priorCalls) || priorCalls < 0) throw new Error("Invalid daily artifact call count");
      const alreadyCommitted = artifactChecks(prior).some((existing) => JSON.stringify(existing) === JSON.stringify(check));
      const checks = mergeChecks(artifactChecks(prior), [check]);
      const artifact = {
        version: 4, verifiedAt: checkDay,
        method: "places_text_search: live Google Places API (New); placeId and derived verdict fields only (Maps ToS).",
        summary: { ...summarizeVerification(checks), placesLiveApiCalls: priorCalls + Number(!alreadyCommitted) }, checks,
      };
      const outputs = [...next].map(([file, pack]) => ({ file, bytes: jsonBytes(pack) }));
      outputs.push({ file: outFile, bytes: jsonBytes(artifact) });
      state.journal = { files: outputs.map(({ file, bytes }) => ({
        file, bytes, before: state.expected[file], after: sha256(bytes),
      })) };
      persist();
      replayJournal();
    };
    // A completed check may be durable even when its output journal was not yet created.
    for (const record of state.records) {
      if (record.status === "completed" && !record.applied) {
        commitCheck(record.check);
        record.applied = true;
        persist();
      }
    }
    const byId = new Map(loadPacks(famousDir).rows.map(({ row }) => [row.id, row]));
    for (const record of state.records) {
      assertRunning();
      if (record.status !== "pending") continue;
      activeId = record.id;
      const row = byId.get(record.id);
      if (!row) throw new Error("Target source fingerprint changed");
      const memo = new Map();
      const headSource = (url) => {
        if (!memo.has(url)) memo.set(url, access.head(url));
        return memo.get(url);
      };
      const sourceBlock = await anchorRenewalBlock(row, headSource);
      assertRunning();
      if (sourceBlock) {
        record.status = "source-blocked";
        record.finding = sourceBlock;
        persist();
        continue;
      }
      const result = await verifyRowWithPlaces(row, async (query) => {
        const payload = await client.searchText(query);
        assertRunning();
        return { ...payload, fetchedAt: now().toISOString() };
      }, headSource);
      assertRunning();
      record.status = "completed";
      record.check = toCommittedPlacesCheck(result);
      state.active = null;
      persist();
      commitCheck(record.check);
      record.applied = true;
      persist();
    }
    const checks = state.records.filter((record) => record.check).map((record) => record.check);
    const sourceBlocked = state.records.filter((record) => record.status === "source-blocked").map((record) => record.id);
    const summary = summarizeVerification(checks);
    return {
      ...summary, sourceBlocked, placesCalls: state.placesCalls, sourceCalls: state.sourceCalls,
      exitCode: options.limit != null || options.ids ? 0 : Number(summary.closed.length > 0 || summary.unverified.length > 0 || sourceBlocked.length > 0),
    };
  } finally {
    if (!checkpointBroken) unlinkSync(lockPath);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  runVerification().then((summary) => {
    console.log(JSON.stringify(summary, null, 2));
    process.exitCode = summary.exitCode;
  }).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
