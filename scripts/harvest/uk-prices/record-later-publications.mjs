#!/usr/bin/env node
// Record the rows a crawl appended to data/uk_prices/site_harvest.jsonl as
// later publications in data/uk_prices/site_harvest_reconciliation.json.
//
//   npm run harvest:uk-record-publications -- --reader "<how the rows were read>"
//   npm run harvest:uk-record-publications -- --dry-run
//
// Recording and saved-text replay have different ledger and evidence rules.
// docs/UK_PRICE_HARVEST.md#record-or-replay-captured-prices owns those contracts.
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createRobotsChecker } from "../../../lib/harvest/robots.ts";
import { harvestRedirectLanding, isHarvestableOperatorUrl } from "../../../lib/harvest/sourcePolicy.ts";
import { loadCuratedUkBaseOwners, parseSiteHarvestLedgerText, siteHarvestLedgerCollectKey } from "../../../lib/siteHarvestLedgerCore.ts";
import { categoryFor, findUkPriceCandidates, readVenueDrinkPrices } from "../../../lib/harvest/ukPriceCrawl.ts";
import { COFFEE_PILOT_NAMED_DRINKS } from "../../../lib/coffeePricePilot.ts";
import { readPdfText } from "../../../lib/harvest/pdfText.ts";

const ROOT = process.cwd();
const LEDGER_PATH = path.join(ROOT, "data/uk_prices/site_harvest.jsonl");
const REPORT_PATH = path.join(ROOT, "data/uk_prices/site_harvest_reconciliation.json");
const BUNDLE_ROWS = path.join(ROOT, "public/data/uk_prices/rows.json");
const EVIDENCE_DIR = "data/uk_prices/later_publications";
const USER_AGENT = "PUBMAXXHarvest/1.0 (+https://pubmaxxing.com; hello@pubmaxxing.com)";

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

export function readCapturedSectionPrices(text, candidateNames = []) {
  text = text.replace(/^[^\n£]+$/gm, (line) => {
    const compact = line.replace(/\s+/g, "").toLowerCase();
    if (/^cocktails(?:at.+)?$/.test(compact)) return "Cocktails";
    if (["sparkling&champagne", "white", "red", "rosé"].includes(compact)) return "Wine";
    if (compact === "no&low") return "Alcohol-Free";
    if (compact === "margaritas") return "Cocktails";
    return line;
  });
  const headings = /(?:^|\n)[ \t]*(Tea & Coffee|Coffee|Cocktails?|Winter Cocktails|Spritz(?:es)?|Non-Alcoholic Spritzes|Alcohol[- ]Free|Soft Drinks?|Bottled Beers?(?:[ /&]+Ciders?)?|Beers?|Wines?|Spirits|Gin|Vodka|Rum|Whisk(?:y|ey)|Shots?|Food|Starters|Mains|Desserts)(?=[ \t]*(?:\n|$))|\b(Tea & Coffee|Winter Cocktails|Winter Spritzes|Winter\s+Coolers|Mindful\s+Blends|Non-Alcoholic Spritzes|Cocktails|Food|Starters|Mains|Desserts)\b|(?<=\bMenu )Spritz\b/gi;
  const sections = [...text.matchAll(headings)];
  const names = [...new Set([...candidateNames, ...COFFEE_PILOT_NAMED_DRINKS])]
    .filter((name) => typeof name === "string" && name.trim())
    .sort((a, b) => b.length - a.length);
  const rows = [];
  for (const [index, match] of sections.entries()) {
    const heading = match[0].trim();
    if (/^(?:food|starters|mains|desserts)$/i.test(heading)) continue;
    const category = /^(?:tea & coffee|coffee)$/i.test(heading) ? "coffee"
      : /^winter\s+coolers$/i.test(heading) ? "soft-drink"
      : /^mindful\s+blends$/i.test(heading) ? "alcohol-free"
      : /^(?:spirits)$/i.test(heading) ? "other"
      : /spritz|cocktail/i.test(heading) ? (/non-alcoholic/i.test(heading) ? "alcohol-free" : "cocktail")
      : /beer|cider/i.test(heading) ? "beer"
      : /^wines?$/i.test(heading) ? "wine"
      : /^soft drinks?$/i.test(heading) ? "soft-drink"
      : categoryFor(heading, 0);
    if (!category) continue;
    const start = match.index + match[0].length;
    const body = text.slice(start, sections[index + 1]?.index);
    const prices = findUkPriceCandidates(body);
    let from = 0;
    let previousLabel;
    for (const price of prices) {
      const item = body.slice(from, price.at).trim();
      from = price.at + price.verbatim.length;
      const itemLines = item.split("\n").map((line) => line.trim());
      const firstLine = itemLines[0] ?? "";
      const priceLine = itemLines.at(-1)?.replace(/[.\s]+$/, "") ?? "";
      if (readVenueDrinkPrices(`${item} ${price.verbatim}`).drops.includes("offer-not-a-menu-price")) {
        previousLabel = undefined;
        continue;
      }
      const endingName = names.find((name) => priceLine.toLowerCase().endsWith(name.toLowerCase())
        && !/[\p{L}\p{N}]/u.test(priceLine.charAt(priceLine.length - name.length - 1)));
      const named = itemLines.length === 1 && names.find((name) => firstLine.toLowerCase().startsWith(name.toLowerCase())
        && !/[\p{L}\p{N}]/u.test(firstLine.charAt(name.length)));
      const coffee = category === "coffee" && COFFEE_PILOT_NAMED_DRINKS.find((name) =>
        firstLine.toLowerCase().endsWith(name));
      const measureOnly = /^\(?\s*(\d{2,4}\s*ml|bottles?|cans?|pints?|half(?: pint)?)\s*\)?$/i.exec(priceLine);
      const label = measureOnly ? previousLabel
        : category === "coffee" && !/[,£]/.test(priceLine) && /\p{L}/u.test(priceLine) ? priceLine
        : endingName ? priceLine.slice(-endingName.length)
        : named ? firstLine.slice(0, named.length)
        : coffee ? firstLine.slice(-coffee.length) : "";
      if (!label || /^(?:all|premium cocktails)$/i.test(label)) {
        previousLabel = undefined;
        continue;
      }
      const measure = measureOnly ?? /^\s*\(?\s*(\d{2,4}\s*ml|bottles?|cans?|pints?|half(?: pint)?)\s*\)?$/i.exec(firstLine.slice(label.length));
      const servingSize = measure?.[1]?.replace(/(\d)\s+ml/i, "$1ml").toLowerCase().replace(/^(bottle|can|pint)s$/, "$1")
        ?? (/bottled/i.test(heading) ? "bottle" : undefined);
      const ownCategory = categoryFor(label, label.length);
      const drinkCategory = category === "alcohol-free" || category === "soft-drink" ? category
        : category === "coffee" && /\b(?:tea|chai|hot chocolate)\b/i.test(label) ? "other"
        : ownCategory ?? category;
      if ((drinkCategory === "beer" || drinkCategory === "wine") && !servingSize) {
        previousLabel = undefined;
        continue;
      }
      rows.push({
        drinkLabel: label,
        category: drinkCategory,
        priceGbp: price.priceGbp,
        ...(servingSize ? { servingSize } : {}),
      });
      previousLabel = label;
    }
  }
  return rows;
}

function replaySavedPublications(report, lines, date) {
  const candidates = readFileSync(option("--candidates", ""), "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const publications = report.laterPublications.filter((item) => item.sourceObservedAt.startsWith(date));
  const first = report.laterPublications.indexOf(publications[0]);
  if (first < 0 || first + publications.length !== report.laterPublications.length) {
    throw new Error("saved replay must cover the complete unmerged publication tail");
  }
  const prefix = first > 0 ? report.laterPublications[first - 1].currentLedger.rowCount
    : report.postReconciliationPublication.currentLedger.rowCount;
  const ordered = lines.slice(0, prefix);
  const previousState = report.laterPublications[first - 1]?.currentLedger
    ?? report.postReconciliationPublication.currentLedger;
  if (ledgerState(ordered).sha256 !== previousState.sha256) throw new Error("recorded ledger prefix has changed");
  const owners = loadCuratedUkBaseOwners();
  const seen = new Set(parseSiteHarvestLedgerText(`${lines.join("\n")}\n`).map((row) => siteHarvestLedgerCollectKey(row, owners)));
  const bundle = JSON.parse(readFileSync(BUNDLE_ROWS, "utf8"));
  for (const publication of publications) {
    const file = path.join(ROOT, publication.sourceEvidencePath);
    const saved = JSON.parse(readFileSync(file, "utf8"));
    const template = saved.rows[0];
    const identity = { ...template };
    delete identity.servingSize;
    const withdrawn = new Set((saved.withdrawnDrinkLabels ?? []).map((name) => name.toLowerCase()));
    const names = [...saved.rows, ...candidates.filter((row) => row.sourceUrl === saved.sourceUrl)]
      .map((row) => row.drinkLabel).filter(Boolean);
    const readings = readCapturedSectionPrices(saved.evidence, names);
    for (const row of readings) {
      if (!template) throw new Error("saved publication has no venue identity");
      if (saved.rows.some((existing) => existing.drinkLabel.toLowerCase() === row.drinkLabel.toLowerCase()
        && existing.servingSize === row.servingSize)) continue;
      const candidate = { ...identity, ...row };
      const key = siteHarvestLedgerCollectKey(candidate, owners);
      if (!key || seen.has(key) || withdrawn.has(row.drinkLabel.toLowerCase())) continue;
      saved.rows.push(candidate);
      seen.add(key);
    }
    saved.reader = `${saved.reader.split("; kept only rows whose printed name states their category")[0].split("; saved-text section reader")[0]}; saved-text section reader (explicit drinks headings; candidate names are search terms only; no new fetch)`;
    const publishedNames = new Set(saved.rows.map((row) => row.drinkLabel.toLowerCase()));
    saved.followUpOmissions = [...new Set(candidates.filter((row) => row.sourceUrl === saved.sourceUrl)
      .map((row) => row.drinkLabel).filter((name) => !publishedNames.has(name.toLowerCase()) && !withdrawn.has(name.toLowerCase())))];
    const evidenceText = `${JSON.stringify(saved, null, 2)}\n`;
    ordered.push(...saved.rows.map((row) => JSON.stringify(row)));
    publication.sourceEvidenceSha256 = sha256(evidenceText);
    publication.addedRows = saved.rows.length;
    publication.currentLedger = ledgerState(ordered);
    publication.currentBundle = { rowCount: bundle.length, siteHarvestRows: bundle.filter((row) => row.lane === "site-harvest").length };
    if (!DRY_RUN) writeFileSync(file, evidenceText);
    console.log(`${publication.sourceUrl}: ${saved.rows.length} rows, ${readings.length} saved-text readings`);
  }
  if (!DRY_RUN) {
    writeFileSync(LEDGER_PATH, `${ordered.join("\n")}\n`);
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  }
}

/**
 * The complete menu text when it states a recorded price, or why there is none.
 * `evidenceUrl` is the page that served those words: the landing URL when the
 * source redirected, so a receipt never names a page that did not serve it.
 */
export async function readEvidence(url, rows, robots, fetchImpl = fetch) {
  const readAt = new Date().toISOString();
  if (!isHarvestableOperatorUrl(url)) return { evidence: `not re-read: refused by source policy`, readAt };
  const decision = await robots(url);
  if (!decision.allowed) return { evidence: `not re-read: robots ${decision.reason}`, readAt };
  let words;
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
      words = await readPdfText(new Uint8Array(await response.arrayBuffer()));
      if (!words) return { evidence: "not re-read as text: PDF has no readable text layer", readAt };
    } else {
      words = pageWords(await response.text());
    }
    evidenceUrl = landing.url;
  } catch (error) {
    return { evidence: `not re-read: ${String(error).slice(0, 120)}`, readAt };
  }
  for (const row of rows) {
    const [pounds, pence] = Number(row.priceGbp).toFixed(2).split(".");
    const figure =
      pence === "00" ? `${pounds}(?:\\.00)?` : pence.endsWith("0") ? `${pounds}\\.${pence[0]}0?` : `${pounds}\\.${pence}`;
    const match = new RegExp(`£\\s?${figure}(?![0-9])`).exec(words);
    if (match) {
      return { evidence: words, evidenceUrl, readAt };
    }
  }
  return { evidence: "re-read: no recorded figure is on the page now", evidenceUrl, readAt };
}

async function main() {
  const report = JSON.parse(readFileSync(REPORT_PATH, "utf8"));
  const lines = readFileSync(LEDGER_PATH, "utf8").trimEnd().split("\n");
  const replayDate = option("--replay-saved", null);
  if (replayDate) return replaySavedPublications(report, lines, replayDate);
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
