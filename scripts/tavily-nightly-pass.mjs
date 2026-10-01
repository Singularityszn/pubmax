#!/usr/bin/env node
/**
 * Nightly Tavily pass over the London slim index.
 *
 *   npm run tavily:nightly -- --dry-run --usage-file=./usage.json
 *   npm run tavily:nightly -- --max-credits=50
 *
 * TAVILY_API_KEY comes from the environment. A dry run with --usage-file
 * makes no network call and writes nothing. Live state stays under
 * .tavily/nightly and is Listed evidence only.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  parseNightlyArgs,
  readTavilyUsage,
  redactSecrets,
  runNightlyPass,
  selectNightlyVenues,
  tonightAllowance,
  toNightlyVenue,
} from "../lib/harvest/tavilyNightlyPass.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STATE_DIR = path.join(ROOT, ".tavily", "nightly");
const CURSOR_PATH = path.join(STATE_DIR, "cursor.json");
const QUEUE_PATH = path.join(STATE_DIR, "queue.json");
const VENUES_PATH = path.join(ROOT, "public", "data", "venues_slim.json");
const TAVILY_ORIGIN = "https://api.tavily.com";
const DAY = /^\d{4}-\d{2}-\d{2}$/;

function repoRoot() {
  return realpathSync(ROOT);
}

function refusesEscape(candidate) {
  const rootReal = repoRoot();
  const relative = path.relative(rootReal, candidate);
  return relative.startsWith("..") || path.isAbsolute(relative);
}

function assertNoEscapingLink(start) {
  const rootReal = repoRoot();
  let current = path.resolve(start);
  while (current !== rootReal && current !== path.dirname(current)) {
    if (existsSync(current) && lstatSync(current).isSymbolicLink() && refusesEscape(realpathSync(current))) {
      throw new Error("Nightly state refuses a symlink.");
    }
    current = path.dirname(current);
  }
}

function assertNightlyFile(filePath) {
  const stateRoot = path.resolve(STATE_DIR);
  if (refusesEscape(stateRoot)) throw new Error("Nightly state must stay inside this checkout.");
  assertNoEscapingLink(path.dirname(stateRoot));
  mkdirSync(stateRoot, { recursive: true });
  assertNoEscapingLink(stateRoot);
  const stateReal = realpathSync(stateRoot);
  if (refusesEscape(stateReal)) throw new Error("Nightly state must stay inside this checkout.");
  const resolved = path.resolve(filePath);
  if (existsSync(resolved) && lstatSync(resolved).isSymbolicLink()) {
    throw new Error("Nightly state refuses a symlink.");
  }
  const parentReal = realpathSync(path.dirname(resolved));
  const finalPath = path.join(parentReal, path.basename(resolved));
  if (!finalPath.startsWith(`${stateReal}${path.sep}`)) {
    throw new Error("Nightly state must stay under the nightly directory.");
  }
}

function atomicWriteJson(filePath, value) {
  assertNightlyFile(filePath);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  assertNightlyFile(tempPath);
  writeFileSync(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  renameSync(tempPath, filePath);
}

function readJson(filePath) {
  return JSON.parse(readFileSync(filePath, "utf8"));
}

function loadCursor() {
  if (!existsSync(CURSOR_PATH)) return { version: 1, lastSeen: {} };
  const cursor = readJson(CURSOR_PATH);
  if (
    !cursor ||
    cursor.version !== 1 ||
    typeof cursor.lastSeen !== "object" ||
    cursor.lastSeen === null ||
    Array.isArray(cursor.lastSeen)
  ) {
    throw new Error("Nightly cursor is not version 1.");
  }
  for (const value of Object.values(cursor.lastSeen)) {
    if (typeof value !== "string" || !DAY.test(value)) {
      throw new Error("Nightly cursor holds a last-seen date that is not a day.");
    }
  }
  return cursor;
}

function loadQueue() {
  if (!existsSync(QUEUE_PATH)) return { version: 1, standingRule: "listed", venues: [] };
  const queue = readJson(QUEUE_PATH);
  if (!queue || queue.version !== 1 || queue.standingRule !== "listed" || !Array.isArray(queue.venues)) {
    throw new Error("Nightly queue is not a listed queue.");
  }
  return queue;
}

function loadVenues() {
  const pack = readJson(VENUES_PATH);
  const rows = Array.isArray(pack?.rows) ? pack.rows : [];
  return rows.map((row) => toNightlyVenue(row)).filter((row) => row !== null);
}

function tavilyUrl(pathname) {
  const url = new URL(pathname, TAVILY_ORIGIN);
  if (url.origin !== TAVILY_ORIGIN || url.username || url.password || url.search || url.hash) {
    throw new Error("Tavily calls stay on https://api.tavily.com.");
  }
  return url;
}

async function tavilyJson(url, key, body) {
  const response = await fetch(url, {
    method: body ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${key}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`Tavily request failed (${response.status}).`);
  return response.json();
}

function assertExtractUrls(urls) {
  if (!Array.isArray(urls) || urls.length === 0 || urls.length > 4) {
    throw new Error("Extract accepts between one and four URLs.");
  }
  for (const raw of urls) {
    let url;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("Extract refused a URL.");
    }
    if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username || url.password) {
      throw new Error("Extract refused a URL.");
    }
  }
}

async function liveFetch(request, key) {
  if (request.kind === "search") {
    return tavilyJson(tavilyUrl("/search"), key, {
      query: request.query,
      search_depth: "basic",
      max_results: 6,
      include_answer: false,
      country: "united kingdom",
    });
  }
  assertExtractUrls(request.urls);
  return tavilyJson(tavilyUrl("/extract"), key, {
    urls: request.urls,
    extract_depth: "basic",
  });
}

async function readUsage(args, key) {
  if (args.usageFile) return readJson(path.resolve(args.usageFile));
  if (!key) throw new Error("TAVILY_API_KEY is required unless --usage-file is set.");
  return tavilyJson(tavilyUrl("/usage"), key);
}

async function main() {
  const args = parseNightlyArgs(process.argv.slice(2));
  const key = process.env.TAVILY_API_KEY ?? "";
  const usage = await readUsage(args, key);
  if (!readTavilyUsage(usage)) throw new Error("Tavily usage response has no plan limit.");
  const now = new Date();
  const allowance = tonightAllowance({
    usage,
    now,
    reserveCredits: args.reserveCredits,
    manualCap: args.manualCap,
  });
  const venues = loadVenues();
  const cursor = loadCursor();
  const due = selectNightlyVenues(venues, cursor, {
    today: now.toISOString().slice(0, 10),
    staleAfterDays: args.staleAfterDays,
    limit: venues.length,
  });
  console.log(
    JSON.stringify({
      dryRun: args.dryRun,
      plan: allowance.plan,
      remaining: allowance.remaining,
      daysLeft: allowance.daysLeft,
      tonightCredits: allowance.credits,
      reason: allowance.reason,
      due: due.length,
      venues: venues.length,
    }),
  );
  if (args.dryRun) return;
  if (!key) throw new Error("TAVILY_API_KEY is required for a live pass.");
  const result = await runNightlyPass({
    venues,
    cursor,
    usage,
    now,
    reserveCredits: args.reserveCredits,
    manualCap: args.manualCap,
    staleAfterDays: args.staleAfterDays,
    queue: loadQueue(),
    fetchImpl: (request) => liveFetch(request, key),
  });
  atomicWriteJson(CURSOR_PATH, result.cursor);
  atomicWriteJson(QUEUE_PATH, result.queue);
  console.log(JSON.stringify({ spent: result.spent, stopped: result.stopped, queued: result.queue.venues.length }));
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : "Nightly pass failed.";
  console.error(redactSecrets(message, process.env.TAVILY_API_KEY ?? ""));
  process.exitCode = 1;
});
