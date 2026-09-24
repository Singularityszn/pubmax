#!/usr/bin/env node
/**
 * Re-verify famous-venue trading status against each row's sourceUrl (and recorded
 * alternates), then stamp observedAt / expiresAt for a fresh 30-day window.
 *
 * Each row ends in one outcome:
 *   confirmed  — re-stamped for a fresh window.
 *   closed     — the row's own sourceUrl or anchor page, on an operator host, says
 *                this venue, by its exact name, closed for good (never a listing or
 *                aggregator page); --write drops it.
 *   unverified — anything else (timeout, 403, 429, 5xx, robots, unconvincing page,
 *                or any other page whose closure sentence names this venue, even
 *                by a short or differently cased name, which blocks confirmation
 *                from every other source). A closure sentence whose subject names
 *                another venue (a sister site) is ignored;
 *                retried once after a backoff, then left unchanged and listed, and
 *                the command exits nonzero so the operator reruns later.
 *
 * Method matches data/famous_venues/verification_*.json:
 *   source_page_fetch — GET cited URLs; failed primaries may use alternates.
 *
 * Usage:
 *   node --import tsx scripts/verify_famous_venues.mjs           # report
 *   node --import tsx scripts/verify_famous_venues.mjs --write # update seeds + verification artifact
 */

import {
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout as sleep } from "node:timers/promises";

import { NIGHT_OUT_PLACE_MAX_AGE_HOURS } from "../lib/nightOutPlaceContract.mjs";
import {
  harvestRedirectLanding,
  isHarvestableOperatorUrl,
} from "../lib/harvest/sourcePolicy.ts";
import { isOperatorHost } from "../lib/harvest/pubFacts.ts";
import { createRobotsChecker } from "../lib/harvest/robots.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FAMOUS_DIR = join(ROOT, "data", "famous_venues");
const PACK_FILES = ["bars.json", "late_food.json", "restaurants.json"];
const VERIFICATION_WINDOW_DAYS = NIGHT_OUT_PLACE_MAX_AGE_HOURS / 24;
const FETCH_TIMEOUT_MS = 25_000;
/** One page at a time with a pause — polite to operators and robots.txt hosts. */
const CONCURRENCY = 1;
const FETCH_GAP_MS = 1_000;
const RETRY_BACKOFF_MS = 30_000;
const MAX_PAGE_TEXT_CHARS = 20_000;

const STOP_WORDS = new Set([
  "the",
  "at",
  "and",
  "bar",
  "pub",
  "london",
  "restaurant",
  "soho",
  "covent",
  "garden",
]);

const JUNK_SIGNATURES = [
  /xoilac/i,
  /expireddomains/i,
  /domain.*for sale/i,
  /gofukuken/i,
  /marubiru-bekkan/i,
];

const CLOSURE_PREDICATE =
  /\b(?:(?:has|is)\s+)?(?:now\s+)?(?:permanently closed|closed permanently|closed for good|ceased trading)\b/gi;
/** Negation before the closure ("rumours that X has closed for good") holds the row instead of dropping it. */
const CLOSURE_NEGATION = /\b(?:not|never|rumou?rs?|reopen\w*)\b/i;
const SUBJECT_CONNECTORS = new Set(["at", "the", "and", "of", "on"]);
const GENERIC_NAME_WORDS = new Set([...SUBJECT_CONNECTORS, "bar", "pub", "restaurant", "london"]);

/** Listing and editorial hosts the operator deny list does not name; never an operator page. */
const LISTING_HOSTS = [
  "theworlds50best.com",
  "theinfatuation.com",
  "guide.michelin.com",
  "top50cocktailbars.com",
  "visitlondon.com",
  "hackneypost.co.uk",
  "thenudge.com",
];

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

function latestVerificationPath() {
  const candidates = readdirSync(FAMOUS_DIR)
    .filter((name) => name.startsWith("verification_") && name.endsWith(".json"))
    .sort();
  return candidates.length ? join(FAMOUS_DIR, candidates.at(-1)) : null;
}

function loadAlternateUrls() {
  const path = latestVerificationPath();
  if (!path) return new Map();
  const doc = JSON.parse(readFileSync(path, "utf8"));
  const map = new Map();
  for (const check of doc.checks ?? []) {
    if (check.verificationSourceUrl) {
      map.set(check.id, check.verificationSourceUrl);
    }
  }
  return map;
}

function nameTokens(name) {
  return name
    .toLowerCase()
    .replace(/['’]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 2 && !STOP_WORDS.has(t));
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugTokens(row) {
  return row.id
    .replace(/^(bar|food|restaurant)-/, "")
    .split(/[-_]+/)
    .filter((t) => t.length > 3 && !STOP_WORDS.has(t));
}

function isOperatorPage(url) {
  if (!isOperatorHost(url)) return false;
  const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
  return !LISTING_HOSTS.some((listing) => host === listing || host.endsWith(`.${listing}`));
}

function pageLooksLikeVenue(text, row, finalUrl, contentType = "") {
  if (contentType.includes("application/pdf")) return true;
  const lower = text.slice(0, MAX_PAGE_TEXT_CHARS).toLowerCase();
  if (JUNK_SIGNATURES.some((re) => re.test(lower))) return false;
  const tokens = [...nameTokens(row.name), ...slugTokens(row)];
  if (tokens.length === 0) return lower.includes(row.name.toLowerCase().slice(0, 8));
  const hits = tokens.filter((t) => lower.includes(t));
  if (hits.length >= Math.min(2, tokens.length)) return true;
  try {
    const path = new URL(finalUrl).pathname.toLowerCase();
    if (slugTokens(row).some((t) => path.includes(t))) return true;
  } catch {
    // ignore
  }
  const postcode = row.address.match(/\b([A-Z]{1,2}\d{1,2}[A-Z]?)\b/i)?.[1];
  if (postcode && lower.includes(postcode.toLowerCase())) return true;
  if (row.borough && lower.includes(row.borough.toLowerCase())) return true;
  return hits.length >= 1;
}

const VERIFIER_UA =
  "PubMaxx-famous-venue-verifier/1.0 (+https://pubmaxxing.com)";

/** Some hosts answer robots.txt only to the same UA as the page fetch. */
function verifierFetch(input, init) {
  const headers = new Headers(init?.headers ?? {});
  headers.set("user-agent", VERIFIER_UA);
  return fetch(input, { ...init, headers });
}

let robotsChecker = createRobotsChecker({ fetchImpl: verifierFetch });
let lastFetchAt = 0;

async function politeGap() {
  const elapsed = Date.now() - lastFetchAt;
  if (elapsed < FETCH_GAP_MS) {
    await new Promise((resolve) => setTimeout(resolve, FETCH_GAP_MS - elapsed));
  }
  lastFetchAt = Date.now();
}

async function fetchPage(url) {
  if (!isHarvestableOperatorUrl(url)) {
    return { ok: false, error: "url refused by source policy", finalUrl: url, text: "" };
  }
  const robots = await robotsChecker(url);
  if (!robots.allowed) {
    return {
      ok: false,
      error: `robots: ${robots.reason}`,
      finalUrl: url,
      text: "",
      robotsEvidence: robots.evidence,
    };
  }
  await politeGap();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/pdf,*/*",
        "User-Agent": VERIFIER_UA,
      },
    });
    const landing = harvestRedirectLanding(url, response.url);
    if (landing.outcome === "refused") {
      return {
        ok: false,
        error: `redirect landed on refused url ${landing.url}`,
        finalUrl: landing.url,
        text: "",
        status: response.status,
      };
    }
    const contentType = response.headers.get("content-type") ?? "";
    let text;
    if (contentType.includes("application/pdf")) {
      text = `content-type application/pdf; filename ${landing.url.split("/").pop() ?? "menu.pdf"}`;
    } else {
      const body = await response.text();
      text = htmlToText(body).slice(0, MAX_PAGE_TEXT_CHARS);
    }
    if (!response.ok) {
      return {
        ok: false,
        error: `HTTP ${response.status}`,
        finalUrl: landing.url,
        text,
        status: response.status,
        contentType,
      };
    }
    return { ok: true, finalUrl: landing.url, text, status: response.status, contentType };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      finalUrl: url,
      text: "",
    };
  } finally {
    clearTimeout(timer);
  }
}

function candidateUrls(row, alternates) {
  const urls = [
    row.sourceUrl,
    row.anchor?.sourceUrl,
    ...(row.fameGates ?? []).map((gate) => gate.sourceUrl),
    alternates.get(row.id),
  ];
  const [primary, ...others] = [
    ...new Set(urls.filter((url) => typeof url === "string" && url.length > 0)),
  ];
  return [
    primary,
    ...others.filter((url) => isOperatorPage(url)),
    ...others.filter((url) => !isOperatorPage(url)),
  ];
}

function nameWords(text) {
  return text
    .replace(/&/g, " and ")
    .replace(/['’]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function words(text) {
  return nameWords(text).split(" ").filter(Boolean);
}

/** The run of capitalised words (and connectors) directly before a closure predicate. */
function closureSubject(prefix) {
  const clause = prefix.split(/[,:()–—]/).at(-1);
  const subject = [];
  for (const word of words(clause).reverse()) {
    if (!/^[\p{Lu}\p{N}]/u.test(word) && !SUBJECT_CONNECTORS.has(word)) break;
    subject.unshift(word);
  }
  while (subject.length && SUBJECT_CONNECTORS.has(subject[0])) subject.shift();
  return subject;
}

/**
 * "exact" when a closure sentence's subject is this venue by its exact name,
 * "named" when the subject names only this venue by a short or differently cased
 * name (or the closure is negated before it), "none" otherwise, including when the
 * subject names another venue.
 */
function closureAboutVenue(text, row) {
  const name = nameWords(row.name);
  const known = new Set(words(`${row.name} ${row.area ?? ""} ${row.borough ?? ""}`).map((w) => w.toLowerCase()));
  const distinctive = words(row.name)
    .map((w) => w.toLowerCase())
    .filter((w) => !GENERIC_NAME_WORDS.has(w));
  let verdict = "none";
  for (const sentence of text.split(/(?<=[.!?;])\s+/)) {
    for (const match of sentence.matchAll(CLOSURE_PREDICATE)) {
      const prefix = sentence.slice(0, match.index);
      const subject = closureSubject(prefix);
      const lower = subject.map((w) => w.toLowerCase());
      if (!lower.every((w) => known.has(w) || GENERIC_NAME_WORDS.has(w))) continue;
      if (!distinctive.some((w) => lower.includes(w))) continue;
      if (!CLOSURE_NEGATION.test(prefix) && ` ${subject.join(" ")} `.includes(` ${name} `)) {
        return "exact";
      }
      verdict = "named";
    }
  }
  return verdict;
}

function readPage(page, row, isRowPage) {
  if (!page.ok) return "failed";
  const closure = closureAboutVenue(page.text, row);
  if (closure === "exact" && isRowPage && isOperatorPage(page.finalUrl)) return "closed";
  if (closure !== "none") return "held";
  return pageLooksLikeVenue(page.text, row, page.finalUrl, page.contentType)
    ? "confirmed"
    : "unconvincing";
}

export async function verifyRow(row, alternates) {
  const primaryUrl = row.sourceUrl;
  let result = "source_fetch_failed";
  let observation = "";
  let sourceUrlResult;
  let sourceUrlObservation;
  let verificationSourceUrl;
  let closureSourceUrl;

  for (const url of candidateUrls(row, alternates)) {
    const page = await fetchPage(url);
    const isPrimary = url === primaryUrl;
    const verdict = readPage(page, row, isPrimary || url === row.anchor?.sourceUrl);
    if (verdict === "closed") {
      result = "operator_page_signals_closure";
      closureSourceUrl = url;
      observation = page.text;
      break;
    }
    if (verdict === "held" && !closureSourceUrl) {
      result = "closure_text_blocks_confirmation";
      closureSourceUrl = url;
      observation = page.text;
    }
    if (verdict === "confirmed" && !closureSourceUrl) {
      result = isPrimary ? "source_page_confirmed" : "alternate_source_confirmed";
      if (!isPrimary) verificationSourceUrl = url;
      observation = page.text;
      break;
    }
    if (isPrimary && verdict !== "confirmed") {
      sourceUrlResult = !page.ok
        ? "source_fetch_failed"
        : verdict === "held"
          ? "source_page_closure_text"
          : "source_page_unconvincing";
      sourceUrlObservation = page.error ?? "primary page did not corroborate the venue";
      observation = page.text;
    }
  }

  const outcome =
    result === "source_page_confirmed" || result === "alternate_source_confirmed"
      ? "confirmed"
      : result === "operator_page_signals_closure"
        ? "closed"
        : "unverified";
  return {
    id: row.id,
    method: "source_page_fetch",
    sourceUrl: primaryUrl,
    ...(verificationSourceUrl ? { verificationSourceUrl } : {}),
    ...(closureSourceUrl ? { closureSourceUrl } : {}),
    result,
    pageObservation: observation.slice(0, 280),
    anchorSourceUrl: row.anchor?.sourceUrl ?? primaryUrl,
    anchorObservation: "anchor_unchanged; verification run did not re-price anchors",
    ...(sourceUrlResult ? { sourceUrlResult, sourceUrlObservation } : {}),
    outcome,
  };
}

async function mapPool(items, limit, fn) {
  const results = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
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
        .map((row) => (outcomeById.get(row.id) === "confirmed" ? stampRow(row, verifiedDay) : row)),
    );
  }
  return next;
}

async function main() {
  const write = process.argv.includes("--write");
  const verifiedDay = isoDateOnly(new Date());
  const alternates = loadAlternateUrls();
  const { byFile, rows } = loadPacks();

  console.log(
    `Famous venue verification (${VERIFICATION_WINDOW_DAYS}-day window); verifiedDay=${verifiedDay}; write=${write}`,
  );

  const checks = await mapPool(rows, CONCURRENCY, ({ row }) => verifyRow(row, alternates));
  const retryIndexes = checks.flatMap((c, i) => (c.outcome === "unverified" ? [i] : []));
  if (retryIndexes.length) {
    console.log(
      `Retrying ${retryIndexes.length} unverified venue(s) once after ${RETRY_BACKOFF_MS / 1000}s`,
    );
    await sleep(RETRY_BACKOFF_MS);
    robotsChecker = createRobotsChecker({ fetchImpl: verifierFetch });
    const retried = await mapPool(retryIndexes, CONCURRENCY, (i) => verifyRow(rows[i].row, alternates));
    retryIndexes.forEach((checkIndex, k) => {
      checks[checkIndex] = retried[k];
    });
  }

  const confirmed = checks.filter((c) => c.outcome === "confirmed");
  const closed = checks.filter((c) => c.outcome === "closed");
  const unverified = checks.filter((c) => c.outcome === "unverified");

  for (const check of closed) {
    console.log(`CLOSED ${check.id}: ${check.closureSourceUrl} signals closure`);
  }
  for (const check of unverified) {
    console.log(
      `UNVERIFIED ${check.id}: ${check.result}${check.closureSourceUrl ? ` at ${check.closureSourceUrl}` : ""} (${check.sourceUrlObservation ?? "no corroboration"})`,
    );
  }
  console.log(
    `Summary: ${confirmed.length}/${checks.length} confirmed, ${closed.length} closed, ${unverified.length} unverified`,
  );

  if (!write) {
    if (closed.length || unverified.length) process.exit(1);
    return;
  }

  for (const [file, pack] of applyVerification(byFile, checks, verifiedDay)) {
    writeFileSync(join(FAMOUS_DIR, file), `${JSON.stringify(pack, null, 2)}\n`);
  }

  const artifact = {
    version: 2,
    verifiedAt: verifiedDay,
    method:
      "source_page_fetch: GET each cited sourceUrl and anchor.sourceUrl; failed primary fetches retain their result and use alternate source corroboration; anchorObservation records exact GBP evidence or an unchanged anchor.",
    summary: {
      rowsChecked: checks.length,
      primarySourceConfirmed: checks.filter((c) => c.result === "source_page_confirmed").length,
      alternateSourceVerified: checks.filter((c) => c.result === "alternate_source_confirmed").length,
      closed: closed.map((c) => c.id),
      unverified: unverified.map((c) => c.id),
    },
    checks,
  };
  const outPath = join(FAMOUS_DIR, `verification_${verifiedDay}.json`);
  writeFileSync(outPath, `${JSON.stringify(artifact)}\n`);

  console.log(
    `Wrote ${outPath}; re-stamped ${confirmed.length}, dropped ${closed.length} closed, left ${unverified.length} unverified unchanged in ${PACK_FILES.join(", ")}`,
  );
  if (unverified.length) {
    console.error(`Unverified venue(s) remain: ${unverified.map((c) => c.id).join(", ")}. Rerun later.`);
    process.exit(1);
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
