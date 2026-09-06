#!/usr/bin/env node
// Read the drinks menus a pub published as a SCAN, and take the prices they
// state through the same rules every other page goes through.
//
//   npm run harvest:uk-prices-ocr -- --dry-run
//   npm run harvest:uk-prices-ocr
//   npm run harvest:uk-prices-ocr -- --only thegunhackney.com
//
// WHY THIS LANE EXISTS. The PDF reader takes the text layer a document carries.
// A menu that was photographed or scanned carries none, so it answers null and
// is counted `unreadable` rather than guessed at. The first national crawl found
// 16 such documents across 12 hosts. Those are pubs that PUBLISHED a price and
// we could not read it, which is the narrowest, most attributable supply gap the
// crawl reported, and this lane closes it.
//
// SIX RULES, and the first five are the other lanes' rules unchanged.
//
// 1. THE HOST LIST IS DERIVED, NOT TYPED. The hosts come from the crawl's own
//    ledger, `data-harvest/uk_prices/hosts.json`, which records per host how
//    many PDFs it served and how many of them carried no text layer. There is no
//    --url flag: a host the crawl never recorded an unreadable PDF for is not
//    visited, so this lane can never widen the crawl's reach.
//
// 2. PERMISSION IS ASKED LIVE, PER HOST, AND AN UNREADABLE ANSWER IS A REFUSAL.
//    `isHarvestableOperatorUrl` drops a host the source table refuses before a
//    request is made, and `createRobotsChecker` asks the host itself again on
//    the day of the run. A permission recorded weeks ago is not permission now.
//
// 3. A PRICE MUST BE ON THE PAGE. The OCR text goes through
//    `readVenueDrinkPrices`, `pageStatesADrinksList` and `cheapestPerCategory`
//    exactly as served HTML and rendered Markdown do. Nothing about a scan earns
//    a row an HTML page would not: the verbatim rule, the drink word, the food
//    word, the offer wording, the per-category band and the four-line list floor
//    all still decide, and a host that serves many pubs must still name one.
//
// 4. OCR IS A READER, NOT AN AUTHOR. The model is asked to transcribe the page
//    and nothing else. It never resolves an ambiguity, never completes a partial
//    figure and never explains what it saw. What it returns is treated as the
//    page's own words and is put through rule 3, which is what stops a
//    hallucinated figure becoming a price: a number a model invents still has to
//    sit beside a drink word, inside that drink's band, on a page stating at
//    least four such lines.
//
// 5. A SKIP IS A FINDING. Every document that yielded nothing is counted under
//    the reason it yielded nothing for, and the reasons are separate on purpose:
//    a scan we could not reach is a fact about us, a scan that turned out to
//    carry a text layer after all is a fact about the earlier crawl, and a scan
//    we read cleanly that stated no drink price is a fact about the pub.
//
// 6. THE TEXT LAYER IS ASKED FIRST, EVERY TIME, THROUGH THE DOCUMENT LANE'S OWN
//    READER. `readPdfText` (lib/harvest/pdfText.ts) is the ONE thing that says
//    whether a document has words of its own, so this lane and the crawl cannot
//    answer that question differently: what it returns text for is already read,
//    and what it answers null on is exactly what the crawl counted `unreadable`.
//    A document with a text layer is counted and skipped, so a re-run after the
//    text lane improves cannot quietly re-read the whole estate through a model.
//
// THE MODEL AND HOW IT IS INSTALLED.
//
// olmOCR (https://github.com/allenai/olmocr, Ai2, Apache-2.0) is a document OCR
// model. It is NOT a dependency of this repository and must never become one: it
// is a Python tool, pinned, installed and run through `uv`, and this script
// shells out to it. `npm install` neither pulls it nor needs it, and a checkout
// with no Python at all still builds, tests and deploys.
//
//   uv tool install --python 3.12 'olmocr==0.4.27'
//   nix profile install nixpkgs#poppler-utils
//
// The second line is not optional: olmOCR checks for poppler's `pdftoppm` at
// STARTUP and exits when it is absent, so a missing poppler reads as the whole
// lane being broken rather than as one page failing.
//
// Its default engine is vLLM on an NVIDIA GPU, which this tree has no access to.
// `olmocr --server` points the same pipeline at any OpenAI-compatible endpoint,
// so on Apple Silicon the model is served locally by llama.cpp against Metal:
//
//   brew install llama.cpp
//   llama-server -hf lmstudio-community/olmOCR-2-7B-1025-GGUF:Q8_0 \
//     --host 127.0.0.1 --port 8099 -c 16384 -ngl 99 --jinja
//
// Q8_0 rather than a smaller quantisation deliberately: this lane reads DIGITS,
// and a price misread in the last decimal place is worse than no price at all.
// Point this script at that server with --server, which defaults to the URL
// above. Nothing here calls a paid API and no document leaves the machine.
//
// WHAT IT COSTS, measured on an Apple M5 Pro with 24 GB on 2026-09-04: 88.7
// seconds for one page, 1,602 input and 962 output tokens, 9.0 GB of weights to
// download once and about 8 GB resident while the server runs. THE MEMORY, NOT
// THE TIME, is what makes this a job somebody schedules: eight gigabytes is a
// third of that machine, so the lane is run on its own and the server is stopped
// afterwards rather than left up beside other work.
//
// Nothing in this file writes to a price surface. Rows land in the harvest
// output beside every other lane's, and `npm run build:uk-price-bundle` remains
// the separate, deliberate step that publishes them.

import { execFile } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

import { readPdfText } from "../../../lib/harvest/pdfText.ts";
import { createRobotsChecker } from "../../../lib/harvest/robots.ts";
import {
  harvestRedirectLanding,
  isHarvestableOperatorUrl,
} from "../../../lib/harvest/sourcePolicy.ts";
import {
  DEFAULT_HOST_DELAY_MS,
  DEFAULT_PAGES_PER_HOST,
  cheapestPerCategory,
  isLikelyMenuUrl,
  menuLinkCandidates,
  pageMayPriceThisPub,
  pageStatesADrinksList,
  readVenueDrinkPrices,
  sitemapLocations,
} from "../../../lib/harvest/ukPriceCrawl.ts";

const run = promisify(execFile);

const ROOT = process.cwd();
const OSM_PUBS = path.join(ROOT, "data/osm/uk/uk_osm_pubs.json");
const OUT_DIR = path.join(ROOT, "data-harvest/uk_prices");
const LEDGER_PATH = path.join(OUT_DIR, "hosts.json");
const OCR_ROWS_PATH = path.join(OUT_DIR, "ocr_rows.jsonl");
const WORK_DIR = path.join(OUT_DIR, "ocr_work");
const PUBLISHED_ROWS = path.join(ROOT, "data/uk_prices/site_harvest.jsonl");
const REPORT_PATH = path.join(ROOT, "data/uk_prices/ocr_report.json");

const USER_AGENT = "PUBMAXXHarvest/1.0 (+https://pubmaxxing.com; hello@pubmaxxing.com)";
const PAGE_TIMEOUT_MS = 25_000;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

/**
 * What an OCR'd menu may cost.
 *
 * THE BYTE CEILING IS DELIBERATELY NOT THE TEXT READER'S. `MAX_PDF_BYTES` in
 * lib/harvest/pdfText.ts stops at 12 MB because "a document far past this is a
 * brochure or a scan", and a scan was worth nothing to it. A scan is this lane's whole subject, and it is large
 * for the ordinary reason: it is a photograph of paper. Every one of the drinks
 * menus this lane was built for sits above that ceiling, from 13.4 MB to 55.9 MB,
 * so inheriting it would have refused the documents and reported them as pubs we
 * could not reach.
 *
 * WHAT REALLY BOUNDS THE COST IS PAGES, not bytes: the model reads at most
 * MAX_PDF_PAGES of a document however big the file is, so the byte ceiling only
 * has to stop an absurd download and the page ceiling does the rest.
 */
const MAX_PDF_BYTES = 64 * 1024 * 1024;
const MAX_PDF_PAGES = 12;

/**
 * How much text a document must carry before it counts as having a text layer.
 * A scan often carries a few stray characters from a watermark or a form field,
 * and treating those as a text layer would send a genuinely unreadable menu back
 * to a reader that already answered null on it.
 */
const MIN_TEXT_LAYER_CHARS = 40;

/** Where the model is served. See the header: any OpenAI-compatible endpoint. */
const DEFAULT_SERVER = "http://127.0.0.1:8099/v1";

const HOME = process.env.HOME ?? "";
const DEFAULT_OLMOCR_BIN = path.join(HOME, ".local/bin/olmocr");

/**
 * Every reason a document this lane opened produced no price. Each is a FINDING
 * with its own name, for the reason the crawl's own outcomes have separate
 * names: folding "we could not fetch it" into "it stated no price" turns a
 * problem of ours into a fact about the pub, and nobody goes back to fix it.
 */
export const OCR_DOCUMENT_OUTCOMES = [
  "priced",
  // Read cleanly, and states no drink price the rules will take. The honest
  // answer about the PUB.
  "states-no-price",
  // Carries a text layer after all, so it belongs to the ordinary PDF reader.
  // Counted, never OCR'd.
  "has-text-layer",
  // We could not fetch the bytes, or they are past the size ceiling.
  "unreachable",
  // The model server was not there, or answered nothing usable. A fact about US.
  "ocr-failed",
  // The host's own pages no longer link a document the crawl once saw.
  "no-longer-published",
];

const flag = (name) => process.argv.includes(name);
function option(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const DRY_RUN = flag("--dry-run");
const ONLY = option("--only", null);
const SERVER = option("--server", DEFAULT_SERVER);
const OLMOCR_BIN = option("--olmocr", DEFAULT_OLMOCR_BIN);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The salted id the UK base layer gives one OSM pub, derived the one way
 * lib/ukBasePubs.ts derives it. Kept identical to the crawler's own, because a
 * row written under a different id is a row about a different pub.
 */
function ukBaseVenueId(osmId) {
  if (typeof osmId !== "string") return null;
  const match = /^(node|way|relation)\/(\d+)$/.exec(osmId.trim());
  if (!match) return null;
  return `venue-uk-${match[1][0]}${match[2]}`;
}

function hostOf(website) {
  try {
    const url = new URL(website.includes("//") ? website : `https://${website}`);
    return url.hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return null;
  }
}

/**
 * The hosts the crawl recorded an unreadable PDF for, and how many each had.
 *
 * DERIVED FROM THE LEDGER'S OWN WORDS. The crawler writes its per-host evidence
 * as one sentence, and the count of documents it could take no words from is in
 * it. Reading that sentence rather than accepting a typed list is what keeps
 * rule 1: this lane cannot be pointed at a host the crawl found no scan on.
 */
export function hostsWithUnreadablePdfs(ledger) {
  const out = [];
  for (const [host, entry] of Object.entries(ledger?.hosts ?? {})) {
    const stated = entry?.pdfUnread;
    const fromEvidence = /(\d+) PDF\(s\) seen \((\d+) read, (\d+) unreadable\)/.exec(
      typeof entry?.evidence === "string" ? entry.evidence : "",
    );
    const unreadable = Number.isFinite(stated)
      ? Number(stated)
      : fromEvidence
        ? Number(fromEvidence[3])
        : 0;
    if (unreadable > 0) out.push({ host, unreadable, checkedAt: entry?.checkedAt ?? null });
  }
  return out.sort((a, b) => b.unreadable - a.unreadable || a.host.localeCompare(b.host));
}

/** The pubs the committed snapshot states a website for, grouped by host. */
function pubsByHost() {
  const snapshot = JSON.parse(readFileSync(OSM_PUBS, "utf8"));
  const pubs = Array.isArray(snapshot) ? snapshot : (snapshot.pubs ?? []);
  const byHost = new Map();
  for (const pub of pubs) {
    const website = pub.website;
    if (typeof website !== "string" || website.trim().length === 0) continue;
    const normalised = website.includes("//") ? website.trim() : `https://${website.trim()}`;
    if (!isHarvestableOperatorUrl(normalised)) continue;
    const host = hostOf(normalised);
    if (!host) continue;
    const entry = byHost.get(host) ?? { host, origin: null, pubs: [] };
    if (!entry.origin) {
      try {
        entry.origin = new URL(normalised).origin;
      } catch {
        continue;
      }
    }
    entry.pubs.push({
      venueId: ukBaseVenueId(pub.osmId),
      osmId: pub.osmId ?? null,
      name: pub.name ?? null,
      postcode: pub.postcode ?? null,
      lat: pub.lat ?? null,
      lng: pub.lng ?? null,
      website: normalised,
    });
    byHost.set(host, entry);
  }
  return byHost;
}

/** A page, as text; or the bytes when the host answered with a PDF. */
async function fetchPage(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: {
        accept: "text/html,application/xhtml+xml,application/pdf;q=0.8,*/*;q=0.5",
        "user-agent": USER_AGENT,
      },
      signal: controller.signal,
      redirect: "follow",
    });
    // THE ALLOW-LIST IS ASKED ABOUT THE PAGE WE LANDED ON, NOT ONLY THE ONE WE
    // ASKED FOR. `redirect: "follow"` lets the HOST pick the last hop, so a
    // permitted site that 30x-es to a refused one used to be read in full and
    // the row was then stamped with the asked-for URL, naming a page that never
    // stated the price. `harvestRedirectLanding` is the one owner of that rule;
    // `finalUrl` was already carried here and read by nothing.
    const landing = harvestRedirectLanding(url, response.url);
    if (landing.outcome === "refused") {
      return { ok: false, status: response.status, body: "", redirectedAway: true, finalUrl: landing.url };
    }
    const landed = landing.url;
    if (!response.ok) return { ok: false, status: response.status, body: "", finalUrl: landed };
    const type = response.headers.get("content-type") ?? "";
    if (/application\/pdf/i.test(type)) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return {
        ok: true,
        status: response.status,
        pdf: true,
        bytes,
        body: "",
        finalUrl: landed,
      };
    }
    const body = await response.text();
    return {
      ok: true,
      status: response.status,
      body: body.length > MAX_PAGE_BYTES ? body.slice(0, MAX_PAGE_BYTES) : body,
      finalUrl: landed,
    };
  } catch (error) {
    return { ok: false, status: 0, body: "", error: String(error).slice(0, 120), finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The documents one host links from the pages the crawler would have opened.
 *
 * The same discovery the crawler runs, narrowed to the documents: the host's own
 * sitemap where its robots.txt names one, then the conventional path, then the
 * links the home page itself states, all judged by the ONE `isLikelyMenuUrl`
 * gate, so a document cannot arrive here that the crawler would have refused.
 */
async function discoverPdfs(entry, statedSitemaps) {
  const home = await fetchPage(entry.origin);
  const candidates = [];
  const push = (url) => {
    if (!candidates.includes(url)) candidates.push(url);
  };

  // The stated page may itself be the document.
  if (home.ok && home.pdf) push(entry.origin);

  const sitemaps = [...statedSitemaps];
  if (sitemaps.length === 0) sitemaps.push(new URL("/sitemap.xml", entry.origin).toString());
  for (const sitemapUrl of sitemaps.slice(0, 2)) {
    const sitemap = await fetchPage(sitemapUrl);
    if (!sitemap.ok || sitemap.body.length === 0) continue;
    for (const location of sitemapLocations(sitemap.body)) {
      if (isLikelyMenuUrl(location, entry.origin)) push(location);
    }
  }

  if (home.ok && !home.pdf) {
    for (const link of menuLinkCandidates(home.body, entry.origin, DEFAULT_PAGES_PER_HOST * 4)) {
      push(link);
    }
  }

  // A .pdf link is a document without spending a request to find out. Everything
  // else is opened once, because a host may serve a document from a path with no
  // extension at all, which is how several of these scans were reached.
  const pdfs = [];
  const pages = [];
  for (const url of candidates) {
    if (/\.pdf(\?|$)/i.test(url)) pdfs.push(url);
    else pages.push(url);
  }
  for (const url of pages.slice(0, DEFAULT_PAGES_PER_HOST * 2)) {
    if (pdfs.length >= DEFAULT_PAGES_PER_HOST) break;
    await sleep(DEFAULT_HOST_DELAY_MS);
    const page = await fetchPage(url);
    if (!page.ok) continue;
    if (page.pdf) {
      pdfs.push(url);
      continue;
    }
    // A menu page that LINKS the document rather than being it.
    for (const link of menuLinkCandidates(page.body, entry.origin, DEFAULT_PAGES_PER_HOST)) {
      if (/\.pdf(\?|$)/i.test(link) && !pdfs.includes(link)) pdfs.push(link);
    }
  }
  return pdfs.slice(0, DEFAULT_PAGES_PER_HOST);
}

/**
 * The words a scanned document states, as olmOCR reads them.
 *
 * The pipeline is given ONE document at a time in its own workspace, because it
 * resumes from that workspace and a shared one would hand back another
 * document's answer. Its output is JSONL, one object per document, and the
 * transcription is the `text` field.
 */
async function ocrPdf(file, workspace) {
  try {
    await run(
      OLMOCR_BIN,
      [
        workspace,
        "--pdfs",
        file,
        "--server",
        SERVER,
        "--workers",
        "1",
        "--pages_per_group",
        String(MAX_PDF_PAGES),
      ],
      { maxBuffer: 64 * 1024 * 1024, timeout: 30 * 60_000 },
    );
  } catch (error) {
    return { ok: false, reason: String(error?.stderr || error).slice(0, 400) };
  }
  const results = path.join(workspace, "results");
  if (!existsSync(results)) return { ok: false, reason: "olmocr wrote no results" };
  let text = "";
  for (const name of readdirSync(results)) {
    if (!name.endsWith(".jsonl")) continue;
    for (const line of readFileSync(path.join(results, name), "utf8").split("\n")) {
      if (line.trim().length === 0) continue;
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.text === "string") text += `${parsed.text}\n`;
      } catch {
        // A line the pipeline could not finish is not a transcription.
      }
    }
  }
  return text.trim().length > 0 ? { ok: true, text } : { ok: false, reason: "olmocr transcribed nothing" };
}

/**
 * The rows one host's readings earn, and the documents that earned nothing.
 *
 * The crawler's own row build, unchanged: a document that is not a list is a
 * banner, the cheapest figure per drink wins across the host's documents, and a
 * host serving many pubs must name one of them or nothing at all is written.
 */
export function rowsFromReadings(entry, readings, observedAt) {
  const documents = [];
  const priced = [];
  for (const { url, reading } of readings) {
    if (!pageStatesADrinksList(reading)) {
      documents.push({
        url,
        outcome: "states-no-price",
        evidence: `${reading.kept.length} priced line(s) read, under the list floor`,
      });
      continue;
    }
    const cheapest = cheapestPerCategory(reading);
    if (cheapest.length === 0) {
      documents.push({ url, outcome: "states-no-price", evidence: "no priced line survived" });
      continue;
    }
    priced.push({ url, cheapest, linesOnPage: reading.kept.length });
  }
  if (priced.length === 0) return { rows: [], documents };

  const byCategory = new Map();
  for (const { url, cheapest, linesOnPage } of priced) {
    for (const row of cheapest) {
      const seen = byCategory.get(row.category);
      if (!seen || row.priceGbp < seen.priceGbp) {
        byCategory.set(row.category, {
          url,
          category: row.category,
          priceGbp: row.priceGbp,
          linesOnPage,
        });
      }
    }
  }
  const best = [...byCategory.values()];

  // ATTRIBUTION IS PART OF THE PRICE, and a scan buys no exception to it.
  const attributable =
    entry.pubs.length === 0 ||
    entry.pubs.some((pub) => best.some((row) => pageMayPriceThisPub(row.url, pub, entry.pubs.length)));
  if (!attributable) {
    for (const { url } of priced) {
      documents.push({ url, outcome: "states-no-price", evidence: "no document naming a pub" });
    }
    return { rows: [], documents };
  }

  const rows = [];
  for (const { url } of priced) documents.push({ url, outcome: "priced" });
  for (const pub of entry.pubs) {
    for (const row of best) {
      rows.push({
        host: entry.host,
        venueId: pub.venueId,
        osmId: pub.osmId,
        name: pub.name,
        postcode: pub.postcode,
        lat: pub.lat,
        lng: pub.lng,
        category: row.category,
        priceGbp: row.priceGbp,
        sourceUrl: row.url,
        observedAt,
        pubsOnHost: entry.pubs.length,
        linesOnPage: row.linesOnPage,
        // The row says HOW it was read, because a figure taken off a scan by a
        // model is weaker evidence than one a page stated in words, and a reader
        // of this file may not have to guess which of the two it is holding.
        reader: "olmocr",
      });
    }
  }
  return { rows, documents };
}

async function main() {
  if (!existsSync(OSM_PUBS)) {
    console.error(`missing ${path.relative(ROOT, OSM_PUBS)}; run npm run fetch:uk-pubs first`);
    process.exitCode = 1;
    return;
  }
  if (!existsSync(LEDGER_PATH)) {
    console.error(
      `missing ${path.relative(ROOT, LEDGER_PATH)}; this lane reads the crawl's own ledger, so run npm run harvest:uk-prices first`,
    );
    process.exitCode = 1;
    return;
  }

  const ledger = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
  const targets = hostsWithUnreadablePdfs(ledger).filter((t) => (ONLY ? t.host.includes(ONLY) : true));
  const recorded = targets.reduce((sum, t) => sum + t.unreadable, 0);
  console.log(`${targets.length} host(s) recorded ${recorded} unreadable PDF(s)`);

  const byHost = pubsByHost();
  const robots = createRobotsChecker();
  const counts = Object.fromEntries(OCR_DOCUMENT_OUTCOMES.map((name) => [name, 0]));
  const refusedHosts = [];
  const documents = [];
  const rows = [];

  if (!DRY_RUN) mkdirSync(WORK_DIR, { recursive: true });

  for (const target of targets) {
    const entry = byHost.get(target.host);
    if (!entry) {
      // The snapshot states no website on this host any more, so there is no pub
      // to attribute a price to and nothing is fetched.
      refusedHosts.push({ host: target.host, reason: "no-pub-states-this-host" });
      continue;
    }

    // RULE 2, asked again today rather than trusted from the ledger.
    if (!isHarvestableOperatorUrl(entry.origin)) {
      refusedHosts.push({ host: target.host, reason: "policy-refused-host" });
      continue;
    }
    const decision = await robots(entry.origin);
    if (!decision.allowed) {
      refusedHosts.push({
        host: target.host,
        reason: decision.reason,
        evidence: decision.evidence.slice(0, 200),
      });
      continue;
    }

    const pdfUrls = await discoverPdfs(entry, decision.sitemaps ?? []);
    if (pdfUrls.length === 0) {
      counts["no-longer-published"] += target.unreadable;
      documents.push({ host: target.host, url: null, outcome: "no-longer-published" });
      continue;
    }

    const readings = [];
    for (const url of pdfUrls) {
      await sleep(DEFAULT_HOST_DELAY_MS);
      const page = await fetchPage(url);
      if (
        !page.ok ||
        !page.pdf ||
        !page.bytes ||
        page.bytes.byteLength === 0 ||
        page.bytes.byteLength > MAX_PDF_BYTES
      ) {
        counts.unreachable += 1;
        documents.push({ host: target.host, url, outcome: "unreachable" });
        continue;
      }

      if (DRY_RUN) {
        documents.push({ host: target.host, url, outcome: "dry-run", bytes: page.bytes.byteLength });
        continue;
      }

      // RULE 6, and it asks the DOCUMENT LANE'S OWN READER so the two cannot
      // disagree about what having a text layer means. A document `readPdfText`
      // got words out of is one the ordinary crawl already reads, so it is
      // counted and left alone; the ones it answers null on are exactly the ones
      // it recorded as `unreadable`, and those are this lane's whole job.
      const layer = await readPdfText(page.bytes);
      if (typeof layer === "string" && layer.replace(/\s+/g, "").length >= MIN_TEXT_LAYER_CHARS) {
        counts["has-text-layer"] += 1;
        documents.push({ host: target.host, url, outcome: "has-text-layer" });
        continue;
      }

      const slug = url.replace(/[^a-z0-9]+/gi, "-").slice(-80);
      const workspace = path.join(WORK_DIR, `${target.host}-${slug}`);
      const file = path.join(workspace, "document.pdf");
      mkdirSync(workspace, { recursive: true });
      writeFileSync(file, page.bytes);

      const ocr = await ocrPdf(file, workspace);
      if (!ocr.ok) {
        counts["ocr-failed"] += 1;
        documents.push({ host: target.host, url, outcome: "ocr-failed", evidence: ocr.reason });
        continue;
      }

      // RULE 3. The transcription is fed in as TEXT, so the HTML stripper is not
      // asked to strip markup that was never there.
      readings.push({ url, reading: readVenueDrinkPrices(ocr.text) });
    }

    const observedAt = new Date().toISOString();
    const built = rowsFromReadings(entry, readings, observedAt);
    for (const doc of built.documents) {
      counts[doc.outcome] += 1;
      documents.push({ host: target.host, ...doc });
    }
    rows.push(...built.rows);
  }

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    server: SERVER,
    hostsWithUnreadablePdfs: targets.length,
    unreadablePdfsRecorded: recorded,
    documents: counts,
    refusedHosts,
    rowsWritten: rows.length,
    pubsPriced: new Set(rows.map((row) => row.venueId)).size,
  };

  console.log(JSON.stringify(report, null, 2));
  for (const doc of documents) {
    console.log(`  ${String(doc.outcome).padEnd(20)} ${doc.host} ${doc.url ?? ""}`);
  }

  if (DRY_RUN) {
    console.log("dry run, nothing written");
    return;
  }

  const jsonl = rows.map((row) => JSON.stringify(row)).join("\n");
  if (rows.length > 0) appendFileSync(PUBLISHED_ROWS, `${jsonl}\n`);

  // A NARROWED RUN MAY NOT SPEAK FOR THE WHOLE LANE. `--only` asks about one
  // host, and its counts describe that host alone, so writing them to the
  // report every reader treats as the national answer would state that the
  // other eleven hosts published nothing. The rows are still kept, because a
  // price a pub really states is true however few hosts were asked.
  if (ONLY) {
    console.log(
      `narrowed run: ${rows.length} row(s) appended to ${path.relative(ROOT, PUBLISHED_ROWS)}, report not written`,
    );
    return;
  }

  writeFileSync(OCR_ROWS_PATH, rows.length > 0 ? `${jsonl}\n` : "");
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    `wrote ${rows.length} row(s) to ${path.relative(ROOT, OCR_ROWS_PATH)} and appended them to ${path.relative(ROOT, PUBLISHED_ROWS)}`,
  );
}

if (process.argv[1] && process.argv[1].endsWith("ocr.mjs")) {
  await main();
}
