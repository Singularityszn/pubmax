#!/usr/bin/env node
// Record the rows a crawl appended to data/uk_prices/site_harvest.jsonl as
// later publications in data/uk_prices/site_harvest_reconciliation.json.
//
//   npm run harvest:uk-record-publications -- --reader "<how the rows were read>"
//   npm run harvest:uk-record-publications -- --dry-run
//
// The reconciliation audit holds the ledger to its history: every row after
// the last recorded publication must belong to one recorded source page, read
// at one time, with an evidence file beside it
// (`__tests__/siteHarvestReconciliation.test.ts`). This script writes those
// records for the unrecorded tail, one per source page and read time.
//
// THREE RULES.
//
// 1. IT ADDS, IT NEVER REWRITES HISTORY. Rows up to the last recorded
//    publication are left byte for byte. The unrecorded tail is only reordered,
//    so each page's rows sit together, and no row is changed or dropped.
//
// 2. THE EVIDENCE IS THE PAGE'S OWN WORDS, READ BEHIND THE SAME GATES. Each
//    source page is read again through `isHarvestableOperatorUrl` and a live
//    robots ask, and the excerpt is the page text around the first recorded
//    price. A page that refuses or fails keeps its rows and says so in
//    `evidence`, with the time of the attempt; nothing is invented for it.
//
// 3. A READ WE COULD NOT CHECK WRITES NOTHING. A tail row whose figure is not
//    on the re-read page is still a row the crawl kept under the page it read
//    then, so the excerpt records the mismatch rather than hiding the row.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createRobotsChecker } from "../../../lib/harvest/robots.ts";
import { harvestRedirectLanding, isHarvestableOperatorUrl } from "../../../lib/harvest/sourcePolicy.ts";
import { parseSiteHarvestLedgerText } from "../../../lib/siteHarvestLedgerCore.ts";

const ROOT = process.cwd();
const LEDGER_PATH = path.join(ROOT, "data/uk_prices/site_harvest.jsonl");
const REPORT_PATH = path.join(ROOT, "data/uk_prices/site_harvest_reconciliation.json");
const BUNDLE_ROWS = path.join(ROOT, "public/data/uk_prices/rows.json");
const EVIDENCE_DIR = "data/uk_prices/later_publications";
const USER_AGENT = "PUBMAXXHarvest/1.0 (+https://pubmaxxing.com; hello@pubmaxxing.com)";
const EXCERPT_CHARS = 600;

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const DRY_RUN = process.argv.includes("--dry-run");
const READER = option("--reader", "scripts/harvest/uk-prices/run.mjs (shared ukPriceCrawl rules, live robots)");

const sha256 = (value) => createHash("sha256").update(value).digest("hex");

function rowIdentitySha256(row) {
  const canonical = Object.fromEntries(Object.entries(row).sort(([a], [b]) => a.localeCompare(b)));
  return sha256(JSON.stringify(canonical));
}

function identitySetSha256(rows) {
  return sha256(`${rows.map(rowIdentitySha256).sort().join("\n")}\n`);
}

function ledgerState(lines) {
  const text = `${lines.join("\n")}\n`;
  const rows = parseSiteHarvestLedgerText(text);
  return { sha256: sha256(text), rowCount: rows.length, rowIdentitySetSha256: identitySetSha256(rows) };
}

function slugOf(url, observedAt) {
  const parsed = new URL(url);
  const slug = `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 120);
  return `${observedAt.slice(0, 10)}-${slug}`;
}

function pageWords(body) {
  return body
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;|&#160;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&pound;|&#163;/gi, "£")
    .replace(/\s+/g, " ")
    .trim();
}

/** Two spellings of one page: `https://a.example` and `https://a.example/`. */
function sameResource(a, b) {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return a === b;
  }
}

function discardBody(response) {
  response.body?.cancel().catch(() => {});
}

/**
 * The page's own words around the first recorded price, or why there are none.
 * `evidenceUrl` is the page that served those words: the landing URL when the
 * source redirected, so a receipt never names a page that did not serve it.
 */
export async function readEvidence(url, rows, robots, fetchImpl = fetch) {
  const readAt = new Date().toISOString();
  if (!isHarvestableOperatorUrl(url)) return { evidence: `not re-read: refused by source policy`, readAt };
  const decision = await robots(url);
  if (!decision.allowed) return { evidence: `not re-read: robots ${decision.reason}`, readAt };
  let body;
  let evidenceUrl = url;
  try {
    const response = await fetchImpl(url, { headers: { "user-agent": USER_AGENT }, signal: AbortSignal.timeout(25_000) });
    // The host picks the last hop, so permission is asked again where we landed:
    // the source table first, then that page's own robots rules.
    const landing = harvestRedirectLanding(url, response.url);
    if (landing.outcome === "refused") {
      discardBody(response);
      return { evidence: `not re-read: redirected to ${landing.url}, refused by source policy`, readAt };
    }
    if (landing.outcome === "redirected") {
      const landed = await robots(landing.url);
      if (!landed.allowed) {
        discardBody(response);
        return { evidence: `not re-read: redirected to ${landing.url}, robots ${landed.reason}`, readAt };
      }
    }
    if (!response.ok) return { evidence: `not re-read: HTTP ${response.status}`, readAt };
    if (/pdf/i.test(response.headers.get("content-type") ?? "")) {
      return { evidence: "not re-read as text: the page is a PDF", readAt };
    }
    body = await response.text();
    evidenceUrl = landing.url;
  } catch (error) {
    return { evidence: `not re-read: ${String(error).slice(0, 120)}`, readAt };
  }
  const words = pageWords(body);
  for (const row of rows) {
    const [pounds, pence] = Number(row.priceGbp).toFixed(2).split(".");
    const figure =
      pence === "00" ? `${pounds}(?:\\.00)?` : pence.endsWith("0") ? `${pounds}\\.${pence[0]}0?` : `${pounds}\\.${pence}`;
    const match = new RegExp(`£\\s?${figure}(?![0-9])`).exec(words);
    if (match) {
      const start = Math.max(0, match.index - EXCERPT_CHARS / 2);
      return { evidence: words.slice(start, start + EXCERPT_CHARS), evidenceUrl, readAt };
    }
  }
  return { evidence: "re-read: no recorded figure is on the page now", evidenceUrl, readAt };
}

async function main() {
  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
  const lines = readFileSync(LEDGER_PATH, "utf8").trimEnd().split("\n");
  const recorded = report.laterPublications.at(-1)?.currentLedger.rowCount
    ?? report.postReconciliationPublication.currentLedger.rowCount;
  const head = lines.slice(0, recorded);
  // RULE 1. History is checked unchanged before anything is added to it.
  const lastLedger = report.laterPublications.at(-1)?.currentLedger;
  if (lastLedger && ledgerState(head).sha256 !== lastLedger.sha256) {
    throw new Error("the recorded ledger prefix has changed; refusing to record on a rewritten history");
  }
  const tail = lines.slice(recorded);
  if (tail.length === 0) {
    console.log("later publications: nothing unrecorded");
    return;
  }

  const groups = new Map();
  for (const line of tail) {
    const row = JSON.parse(line);
    const key = `${row.sourceUrl}|${row.observedAt}`;
    const group = groups.get(key) ?? { sourceUrl: row.sourceUrl, observedAt: row.observedAt, lines: [] };
    group.lines.push(line);
    groups.set(key, group);
  }

  const robots = createRobotsChecker();
  const bundle = JSON.parse(readFileSync(BUNDLE_ROWS, "utf8"));
  const currentBundle = {
    rowCount: bundle.length,
    siteHarvestRows: bundle.filter((row) => row.lane === "site-harvest").length,
  };
  const ordered = [...head];
  const publications = [];
  for (const group of groups.values()) {
    ordered.push(...group.lines);
    const rows = parseSiteHarvestLedgerText(`${group.lines.join("\n")}\n`);
    const { evidence, evidenceUrl, readAt } = await readEvidence(group.sourceUrl, rows, robots);
    const evidencePath = `${EVIDENCE_DIR}/${slugOf(group.sourceUrl, group.observedAt)}.json`;
    const evidenceText = `${JSON.stringify(
      {
        version: 1,
        sourceUrl: group.sourceUrl,
        observedAt: group.observedAt,
        evidence,
        // Named only when the re-read landed on another page than the source.
        ...(evidenceUrl && !sameResource(evidenceUrl, group.sourceUrl) ? { evidenceUrl } : {}),
        evidenceReadAt: readAt,
        reader: READER,
        rows,
      },
      null,
      2,
    )}\n`;
    if (!DRY_RUN) writeFileSync(path.join(ROOT, evidencePath), evidenceText);
    publications.push({
      sourceEvidencePath: evidencePath,
      sourceEvidenceSha256: sha256(evidenceText),
      sourceUrl: group.sourceUrl,
      sourceObservedAt: group.observedAt,
      addedRows: rows.length,
      currentLedger: ledgerState(ordered),
      currentBundle,
    });
    console.log(`  ${group.sourceUrl}: ${rows.length} row(s), evidence ${evidence.startsWith("not") || evidence.startsWith("re-read") ? evidence : "excerpt kept"}`);
  }

  console.log(`later publications: ${publications.length} page(s), ${tail.length} row(s)`);
  if (DRY_RUN) return;
  writeFileSync(LEDGER_PATH, `${ordered.join("\n")}\n`);
  report.laterPublications.push(...publications);
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
