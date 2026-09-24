#!/usr/bin/env node
/**
 * Re-verify famous-venue trading status against each row's sourceUrl (and recorded
 * alternates), then stamp observedAt / expiresAt for a fresh 30-day window.
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

import { NIGHT_OUT_PLACE_MAX_AGE_HOURS } from "../lib/nightOutPlaceContract.mjs";
import { nightOutPlaceSourceName } from "../lib/nightOutPlaceSourceUrl.mjs";
import {
  harvestRedirectLanding,
  isHarvestableOperatorUrl,
} from "../lib/harvest/sourcePolicy.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const FAMOUS_DIR = join(ROOT, "data", "famous_venues");
const PACK_FILES = ["bars.json", "late_food.json", "restaurants.json"];
const VERIFICATION_WINDOW_DAYS = NIGHT_OUT_PLACE_MAX_AGE_HOURS / 24;
const FETCH_TIMEOUT_MS = 25_000;
const CONCURRENCY = 6;

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

function pageLooksLikeVenue(text, row, finalUrl, contentType = "") {
  if (contentType.includes("application/pdf")) return true;
  const lower = text.toLowerCase();
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

async function fetchPage(url) {
  if (!isHarvestableOperatorUrl(url)) {
    return { ok: false, error: "url refused by source policy", finalUrl: url, text: "" };
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        Accept: "text/html,application/pdf,*/*",
        "User-Agent": "PubMaxx-famous-venue-verifier/1.0 (+https://pubmaxxing.com)",
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
      text = htmlToText(body).slice(0, 500);
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
  return [...new Set(urls.filter((url) => typeof url === "string" && url.length > 0))];
}

async function verifyRow(row, alternates) {
  const primaryUrl = row.sourceUrl;
  const candidates = candidateUrls(row, alternates);
  let result = "source_fetch_failed";
  let observation = "";
  let sourceUrlResult;
  let sourceUrlObservation;
  let verificationSourceUrl;

  const primary = await fetchPage(primaryUrl);
  if (primary.ok && pageLooksLikeVenue(primary.text, row, primary.finalUrl, primary.contentType)) {
    result = "source_page_confirmed";
    observation = primary.text;
  } else {
    sourceUrlResult = primary.ok ? "source_page_unconvincing" : "source_fetch_failed";
    sourceUrlObservation = primary.error ?? "primary page did not corroborate the venue";
    observation = primary.text;
    for (const url of candidates) {
      if (url === primaryUrl) continue;
      const alt = await fetchPage(url);
      if (alt.ok && pageLooksLikeVenue(alt.text, row, alt.finalUrl, alt.contentType)) {
        result = "alternate_source_confirmed";
        verificationSourceUrl = url;
        observation = alt.text;
        break;
      }
    }
  }

  const confirmed = result === "source_page_confirmed" || result === "alternate_source_confirmed";
  return {
    id: row.id,
    method: "source_page_fetch",
    sourceUrl: primaryUrl,
    ...(verificationSourceUrl ? { verificationSourceUrl } : {}),
    result,
    pageObservation: observation.slice(0, 280),
    anchorSourceUrl: row.anchor?.sourceUrl ?? primaryUrl,
    anchorObservation: "anchor_unchanged; verification run did not re-price anchors",
    ...(sourceUrlResult ? { sourceUrlResult, sourceUrlObservation } : {}),
    confirmed,
    preferredSourceUrl:
      result === "alternate_source_confirmed" && verificationSourceUrl
        ? verificationSourceUrl
        : primaryUrl,
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

function stampRow(row, verifiedDay, preferredSourceUrl) {
  const next = {
    ...row,
    observedAt: verifiedDay,
    expiresAt: addCalendarDays(verifiedDay, VERIFICATION_WINDOW_DAYS),
  };
  if (preferredSourceUrl && preferredSourceUrl !== row.sourceUrl) {
    next.sourceUrl = preferredSourceUrl;
    next.sourceName = nightOutPlaceSourceName(preferredSourceUrl);
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
  const confirmed = checks.filter((c) => c.confirmed);
  const failed = checks.filter((c) => !c.confirmed);

  for (const check of failed) {
    console.log(`FAIL ${check.id}: ${check.result} (${check.sourceUrlObservation ?? "no corroboration"})`);
  }
  console.log(
    `Summary: ${confirmed.length}/${checks.length} confirmed (${failed.length} failed)`,
  );

  if (!write) {
    if (failed.length) process.exit(1);
    return;
  }

  if (failed.length) {
    console.error("Refusing --write while venues failed verification; drop or fix them first.");
    process.exit(1);
  }

  const checkById = new Map(checks.map((c) => [c.id, c]));
  const confirmedIds = new Set(confirmed.map((c) => c.id));
  for (const [file, pack] of byFile) {
    const next = pack
      .filter((row) => confirmedIds.has(row.id))
      .map((row) =>
        stampRow(row, verifiedDay, checkById.get(row.id)?.preferredSourceUrl),
      );
    writeFileSync(join(FAMOUS_DIR, file), `${JSON.stringify(next, null, 2)}\n`);
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
    },
    checks: checks.map((check) => {
      const { confirmed, preferredSourceUrl, ...rest } = check;
      void confirmed;
      void preferredSourceUrl;
      return rest;
    }),
  };
  const outPath = join(FAMOUS_DIR, `verification_${verifiedDay}.json`);
  writeFileSync(outPath, `${JSON.stringify(artifact)}\n`);

  console.log(`Wrote ${outPath} and re-stamped ${confirmed.length} rows in ${PACK_FILES.join(", ")}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
