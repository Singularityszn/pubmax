#!/usr/bin/env node
// Crawl every UK pub website we are PERMITTED to read, take the drink prices it
// STATES, and report what every host answered.
//
//   npm run harvest:uk-prices                      # resume, default budgets
//   npm run harvest:uk-prices -- --hosts 200       # stop after 200 new hosts
//   npm run harvest:uk-prices -- --pages 4000      # global page ceiling
//   npm run harvest:uk-prices -- --reset           # forget the ledger and start over
//   npm run harvest:uk-prices -- --only greeneking.co.uk
//   npm run harvest:uk-prices -- --recheck robots-unreadable   # ask one finding again
//
// FIVE RULES, and they are the whole design.
//
// 1. THE HOST LIST IS DERIVED, NOT TYPED. Candidates are the `website` tags the
//    committed UK OSM pub snapshot already carries, plus the allowed
//    `chain-menu-prices` sources in lib/harvest/sourcePolicy.ts. There is no
//    --url flag that takes an arbitrary host: a pub's own site is first-party by
//    definition, and everything else has to be argued for in the source table.
//
// 2. PERMISSION IS ASKED LIVE, PER HOST, AND AN UNREADABLE ANSWER IS A REFUSAL.
//    lib/harvest/robots.ts does the asking, so a challenge page or a 403 stops
//    the host rather than being shrugged off. A host sourcePolicy refuses on
//    permission is never asked at all: `isHarvestableOperatorUrl` drops it,
//    which is what stops a refused estate arriving wearing one pub's own domain.
//
// 3. A PRICE MUST BE ON THE PAGE. Every figure is verbatim-checked against the
//    page text and needs a drink word beside it and no food word, in
//    lib/harvest/ukPriceCrawl.ts. Nothing is inferred, and every drop is counted.
//
// 4. THE RUN IS RESUMABLE AND BOUNDED. A ledger records what each host answered
//    and when, so a rerun continues rather than restarting; a per-host page
//    ceiling stops one estate spending the national budget; a per-host delay
//    honours the host's own Crawl-delay where it publishes one.
//
// 5. A SKIP IS A FINDING. Every host that answered nothing is counted under the
//    reason it answered nothing FOR, because "we crawled 7,000 sites and found
//    900 prices" is only honest beside the reasons the other 6,100 gave.
//
// Nothing here writes to a price surface. The rows land in the harvest ledger,
// and scripts/build_uk_price_bundle.mjs is the separate, deliberate step that
// publishes them.

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { createRobotsChecker } from "../../../lib/harvest/robots.ts";
import {
  allowedHarvestSources,
  harvestSourcesOfKind,
  isHarvestSourceAllowed,
  isHarvestableOperatorUrl,
} from "../../../lib/harvest/sourcePolicy.ts";
import {
  OVERLAY_MENU_URL_INPUT_PATH,
  crawlableOverlayMenuUrls,
  readOverlayMenuUrlInput,
} from "./menu-urls.mjs";
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

const ROOT = process.cwd();
const OSM_PUBS = path.join(ROOT, "data/osm/uk/uk_osm_pubs.json");
const OUT_DIR = path.join(ROOT, "data-harvest/uk_prices");
const LEDGER_PATH = path.join(OUT_DIR, "hosts.json");
const ROWS_PATH = path.join(OUT_DIR, "rows.jsonl");
const REPORT_PATH = path.join(ROOT, "data/uk_prices/harvest_report.json");

const USER_AGENT = "PUBMAXXHarvest/1.0 (+https://pubmaxxing.com; hello@pubmaxxing.com)";
const PAGE_TIMEOUT_MS = 25_000;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

/** How many hosts are read at once. Politeness is per host, so hosts run apart. */
const DEFAULT_CONCURRENCY = 8;
/** A run may never become an unbounded crawl. One number, and it counts retries. */
const DEFAULT_PAGE_BUDGET = 20_000;

/**
 * Every reason a host produced no price. Each is a FINDING with its own name:
 * folding "it refused us" into "it had nothing" would turn a permission problem
 * into a supply problem and nobody would go and ask for permission.
 */
const HOST_OUTCOMES = [
  "priced",
  "robots-disallowed",
  "robots-unreadable",
  "policy-refused-host",
  "unreachable",
  "no-menu-page-found",
  "menu-states-no-price",
  // The host states a drinks list and serves several pubs, and no page of it
  // names the pub the price would have to belong to. The price is real and the
  // attribution is not, so nothing is written and the finding is counted.
  "estate-page-names-no-pub",
];

const flag = (name) => process.argv.includes(name);
function option(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const RESET = flag("--reset");
const DRY_RUN = flag("--dry-run");
const HOST_LIMIT = Number(option("--hosts", Number.POSITIVE_INFINITY));
const PAGE_BUDGET = Number(option("--pages", DEFAULT_PAGE_BUDGET));
const CONCURRENCY = Math.max(1, Number(option("--concurrency", DEFAULT_CONCURRENCY)));
const ONLY = option("--only", null);
/**
 * Ask a set of hosts AGAIN, naming the outcome they were recorded under.
 *
 *   npm run harvest:uk-prices -- --recheck robots-unreadable
 *
 * A full `--reset` throws away seven thousand answers to re-ask a few hundred.
 * A finding is a fact about the moment it was taken, so when the rule that
 * produced it changes, or when the ask itself failed, the hosts under that one
 * finding are the ones worth asking again and nothing else is.
 */
/**
 * The committed overlay menu-url input, cut from `harvest_venue_overlays.menu_url`
 * by scripts/harvest/uk-prices/menu-urls.mjs. `--menu-urls none` leaves the lane
 * reading the snapshot's own websites alone.
 */
const MENU_URL_INPUT = option("--menu-urls", OVERLAY_MENU_URL_INPUT_PATH);
const RECHECK = (option("--recheck", "") || "")
  .split(",")
  .map((name) => name.trim())
  .filter((name) => name.length > 0);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The salted id the UK base layer gives one OSM pub, derived the one way
 * lib/ukBasePubs.ts derives it: `venue-uk-` plus the ref the shards carry, which
 * is the element type's first letter and its id. A pub whose snapshot row states
 * no usable OSM id gets no id here rather than a plausible-looking one.
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

async function fetchText(url) {
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
    if (!response.ok) return { ok: false, status: response.status, body: "", finalUrl: url };
    const type = response.headers.get("content-type") ?? "";
    // A PDF is bytes, not markup. This lane reads what a page STATES as text, so
    // a PDF is recorded as reached and left for the PDF reader that does not
    // exist yet, rather than being run through an HTML stripper that would
    // invent words out of a binary.
    if (/application\/pdf/i.test(type)) {
      return { ok: true, status: response.status, body: "", pdf: true, finalUrl: response.url || url };
    }
    const body = await response.text();
    return {
      ok: true,
      status: response.status,
      body: body.length > MAX_PAGE_BYTES ? body.slice(0, MAX_PAGE_BYTES) : body,
      finalUrl: response.url || url,
    };
  } catch (error) {
    return { ok: false, status: 0, body: "", error: String(error).slice(0, 120), finalUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

/** The pubs the committed snapshot states a website for, grouped by host. */
function candidateHosts() {
  const snapshot = JSON.parse(readFileSync(OSM_PUBS, "utf8"));
  const pubs = Array.isArray(snapshot) ? snapshot : (snapshot.pubs ?? []);
  const byHost = new Map();
  let statedWebsite = 0;
  let refusedByPolicy = 0;

  for (const pub of pubs) {
    const website = pub.website;
    if (typeof website !== "string" || website.trim().length === 0) continue;
    statedWebsite += 1;
    const normalised = website.includes("//") ? website.trim() : `https://${website.trim()}`;
    // The source table's own refusal, applied before a single request is made.
    if (!isHarvestableOperatorUrl(normalised)) {
      refusedByPolicy += 1;
      continue;
    }
    const host = hostOf(normalised);
    if (!host) continue;
    // A social page is not a pub's own site: it is a third party with its own
    // permission question this crawl has not asked.
    if (/(facebook|instagram|twitter|x\.com|tripadvisor|yelp|google|linktr\.ee|wixsite|whatpub)/i.test(host)) {
      continue;
    }
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

  return { hosts: [...byHost.values()], statedWebsite, refusedByPolicy, totalPubs: pubs.length };
}

function loadLedger() {
  if (RESET || !existsSync(LEDGER_PATH)) return { version: 1, hosts: {} };
  try {
    const parsed = JSON.parse(readFileSync(LEDGER_PATH, "utf8"));
    return parsed && typeof parsed === "object" && parsed.hosts ? parsed : { version: 1, hosts: {} };
  } catch {
    return { version: 1, hosts: {} };
  }
}

/** Pages worth opening on one host, cheapest signal first. */
async function discoverPages(entry, statedSitemaps, spend) {
  const pages = [];
  const push = (url) => {
    if (!pages.includes(url)) pages.push(url);
  };

  // 0. A page the fold already recorded as this pub's menu. It is the cheapest
  // signal there is: somebody's own site said this URL is the drinks list, so it
  // is opened before anything has to be guessed at from a sitemap or a link.
  for (const seed of entry.seedPages ?? []) push(seed);

  // 1. The pub's own stated page. Many small sites put the drinks list on it.
  push(entry.origin);

  // 2. Whatever the site's own sitemap names that looks like a drinks list. The
  // sitemap comes from the host's OWN robots.txt where it names one; the
  // conventional path is tried only when it names none.
  const sitemaps = [...statedSitemaps];
  if (sitemaps.length === 0) sitemaps.push(new URL("/sitemap.xml", entry.origin).toString());
  for (const sitemapUrl of sitemaps.slice(0, 2)) {
    if (pages.length >= DEFAULT_PAGES_PER_HOST) break;
    if (!spend()) break;
    const sitemap = await fetchText(sitemapUrl);
    if (!sitemap.ok || sitemap.body.length === 0) continue;
    const locations = sitemapLocations(sitemap.body);
    for (const location of locations) {
      if (pages.length >= DEFAULT_PAGES_PER_HOST) break;
      // ONE GATE. A sitemap entry is judged by the same rule a link on the page
      // is, so a bottle shop's product page cannot arrive through the sitemap
      // after being refused as a link.
      if (isLikelyMenuUrl(location, entry.origin)) push(location);
    }
  }
  return pages;
}

async function crawlHost(entry, robots, spend, delayMs) {
  const decision = await robots(entry.origin);
  if (!decision.allowed) {
    // THREE FINDINGS, THREE NAMES. A host that turned us away, a host whose
    // rules file could not be read, and a host that was not there at all are
    // different facts, and only the first two are about permission.
    const outcome =
      decision.reason === "robots-disallowed"
        ? "robots-disallowed"
        : decision.reason === "robots-unreachable"
          ? "unreachable"
          : "robots-unreadable";
    return {
      outcome,
      evidence: decision.evidence.slice(0, 240),
      pagesRead: 0,
      rows: [],
    };
  }

  if (!spend()) return { outcome: "no-menu-page-found", evidence: "page budget spent", pagesRead: 0, rows: [] };
  const home = await fetchText(entry.origin);
  let pagesRead = 1;
  if (!home.ok) {
    return {
      outcome: "unreachable",
      evidence: home.error ? home.error : `HTTP ${home.status}`,
      pagesRead,
      rows: [],
    };
  }

  const discovered = await discoverPages(entry, decision.sitemaps ?? [], spend);
  const fromHome = menuLinkCandidates(home.body, entry.origin, DEFAULT_PAGES_PER_HOST);
  // The home page has already been read, so it is dropped from the queue by
  // VALUE rather than by position: a seeded menu page sits ahead of it now, and
  // slicing the first entry off would silently discard that seed instead.
  const queue = [...new Set([...discovered, ...fromHome])]
    .filter((url) => url !== entry.origin)
    .slice(0, DEFAULT_PAGES_PER_HOST - 1);

  const readings = [{ url: entry.origin, reading: readVenueDrinkPrices(home.body) }];
  let pdfSeen = 0;

  for (const url of queue) {
    if (!spend()) break;
    await sleep(delayMs);
    const page = await fetchText(url);
    pagesRead += 1;
    if (!page.ok) continue;
    if (page.pdf) {
      pdfSeen += 1;
      continue;
    }
    readings.push({ url, reading: readVenueDrinkPrices(page.body) });
  }

  const rows = [];
  const drops = [];
  for (const { url, reading } of readings) {
    drops.push(...reading.drops);
    // A PAGE THAT IS NOT A LIST IS NOT A MENU. One or two figures beside a
    // drink word is a banner, and a banner is where the offers live.
    if (!pageStatesADrinksList(reading)) {
      if (reading.kept.length > 0) {
        for (let i = 0; i < reading.kept.length; i += 1) drops.push("page-is-not-a-drinks-list");
      }
      continue;
    }
    for (const priced of cheapestPerCategory(reading)) {
      rows.push({
        url,
        category: priced.category,
        priceGbp: priced.priceGbp,
        linesOnPage: reading.kept.length,
      });
    }
  }

  if (rows.length === 0) {
    return {
      outcome: readings.length > 1 || pdfSeen > 0 ? "menu-states-no-price" : "no-menu-page-found",
      evidence: `${readings.length} page(s) read, ${pdfSeen} PDF(s) seen, no stated drink price`,
      pagesRead,
      drops,
      rows: [],
    };
  }

  // ONE ROW PER PUB PER DRINK, and the cheapest page wins. A host serving many
  // pubs states one estate-wide list far more often than a per-pub one, so the
  // price is attributed to every pub on that host and the row says so.
  const byCategory = new Map();
  for (const row of rows) {
    const seen = byCategory.get(row.category);
    if (!seen || row.priceGbp < seen.priceGbp) byCategory.set(row.category, row);
  }

  const priced = [...byCategory.values()];

  // ATTRIBUTION IS PART OF THE PRICE. A price that belongs to no pub we can
  // name is not this pub's price, so a host whose pages name none of its own
  // pubs answers with the finding rather than with rows.
  const attributable =
    entry.pubs.length === 0 ||
    entry.pubs.some((pub) => priced.some((row) => pageMayPriceThisPub(row.url, pub, entry.pubs.length)));
  if (!attributable) {
    return {
      outcome: "estate-page-names-no-pub",
      evidence: `${priced.length} stated price(s) across ${entry.pubs.length} pub(s), no page naming one`,
      pagesRead,
      drops,
      rows: [],
    };
  }

  return {
    outcome: "priced",
    evidence: `${readings.length} page(s) read`,
    pagesRead,
    drops,
    rows: priced,
  };
}

async function main() {
  if (!existsSync(OSM_PUBS)) {
    console.error(`missing ${path.relative(ROOT, OSM_PUBS)}; run npm run fetch:uk-pubs first`);
    process.exitCode = 1;
    return;
  }

  const { hosts, statedWebsite, refusedByPolicy, totalPubs } = candidateHosts();
  const ledger = loadLedger();
  const policySources = harvestSourcesOfKind("chain-menu-prices");
  const refusedSources = policySources.filter((source) => !isHarvestSourceAllowed(source));

  // The allowed chain sources join the same queue: one crawler, one rule.
  for (const source of allowedHarvestSources("chain-menu-prices")) {
    const host = hostOf(source.url);
    if (!host || hosts.some((entry) => entry.host === host)) continue;
    hosts.push({ host, origin: new URL(source.url).origin, pubs: [], sourceId: source.id });
  }

  // THE OVERLAY'S OWN MENU PAGES. A `harvest_venue_overlays.menu_url` is a page
  // one pub's own site published, recorded against that pub's OSM id, so it is
  // first-party by the same argument rule 1 makes about a pub's `website`: it is
  // not a typed host, it is a page a pub we can name stated about itself. It is
  // SEEDED onto that pub's host rather than crawled apart from it, so one host
  // still answers once, under one ledger row, behind one live robots ask.
  const overlayInput = readOverlayMenuUrlInput(MENU_URL_INPUT);
  const overlayCrawlable = crawlableOverlayMenuUrls(overlayInput);
  let overlaySeeded = 0;
  let overlayOnUnknownHost = 0;
  for (const target of overlayCrawlable) {
    const host = target.host ?? hostOf(target.menuUrl);
    if (!host) continue;
    const entry = hosts.find((known) => known.host === host);
    if (!entry) {
      // The overlay names a host the pub snapshot states no website for. The
      // page is real, but this lane's unit is a host with pubs attached, so the
      // finding is counted rather than a bare host being invented for it.
      overlayOnUnknownHost += 1;
      continue;
    }
    entry.seedPages = entry.seedPages ?? [];
    if (!entry.seedPages.includes(target.menuUrl)) {
      entry.seedPages.push(target.menuUrl);
      overlaySeeded += 1;
    }
  }
  console.log(
    overlayInput
      ? `  overlay menu urls: ${overlayInput.urls.length} in ${path.relative(ROOT, MENU_URL_INPUT)}, ${overlaySeeded} seeded, ${overlayOnUnknownHost} on a host with no snapshot pub`
      : `  overlay menu urls: no input at ${path.relative(ROOT, MENU_URL_INPUT)}; run npm run harvest:uk-menu-urls`,
  );

  if (RECHECK.length > 0) {
    let dropped = 0;
    for (const [host, entry] of Object.entries(ledger.hosts)) {
      if (!RECHECK.includes(entry.outcome)) continue;
      delete ledger.hosts[host];
      dropped += 1;
    }
    console.log(`re-asking ${dropped} host(s) recorded as ${RECHECK.join(", ")}`);
  }

  const pending = hosts
    .filter((entry) => (ONLY ? entry.host.includes(ONLY) : true))
    .filter((entry) => !ledger.hosts[entry.host])
    .sort((a, b) => b.pubs.length - a.pubs.length)
    .slice(0, Number.isFinite(HOST_LIMIT) ? HOST_LIMIT : hosts.length);

  const robots = createRobotsChecker();
  let spent = 0;
  const spend = () => (spent < PAGE_BUDGET ? ((spent += 1), true) : false);

  if (!DRY_RUN) mkdirSync(OUT_DIR, { recursive: true });
  if (RESET && existsSync(ROWS_PATH) && !DRY_RUN) writeFileSync(ROWS_PATH, "");

  let index = 0;
  let done = 0;
  const started = Date.now();

  async function worker() {
    for (;;) {
      const entry = pending[index++];
      if (!entry) return;
      if (spent >= PAGE_BUDGET) return;
      let result;
      try {
        result = await crawlHost(entry, robots, spend, DEFAULT_HOST_DELAY_MS);
      } catch (error) {
        result = { outcome: "unreachable", evidence: String(error).slice(0, 160), pagesRead: 0, rows: [] };
      }
      ledger.hosts[entry.host] = {
        outcome: result.outcome,
        evidence: result.evidence,
        pagesRead: result.pagesRead,
        pubs: entry.pubs.length,
        checkedAt: new Date().toISOString(),
        drops: (result.drops ?? []).reduce(
          (counts, reason) => ({ ...counts, [reason]: (counts[reason] ?? 0) + 1 }),
          {},
        ),
      };
      if (result.rows.length > 0 && !DRY_RUN) {
        const observedAt = new Date().toISOString();
        const lines = [];
        // A host with no pub attached is a chain source read for its own sake;
        // it produces a HOST row rather than a pub row, and the bundle decides
        // separately whether an estate price may speak for one of its pubs.
        const targets = entry.pubs.length > 0 ? entry.pubs : [null];
        for (const pub of targets) {
          for (const row of result.rows) {
            // An estate page may only price a pub it NAMES. This is the rule
            // that stops one chain banner becoming a price on every pub the
            // chain owns.
            if (pub && !pageMayPriceThisPub(row.url, pub, entry.pubs.length)) continue;
            lines.push(
              JSON.stringify({
                host: entry.host,
                venueId: pub?.venueId ?? null,
                osmId: pub?.osmId ?? null,
                name: pub?.name ?? null,
                postcode: pub?.postcode ?? null,
                lat: pub?.lat ?? null,
                lng: pub?.lng ?? null,
                category: row.category,
                priceGbp: row.priceGbp,
                sourceUrl: row.url,
                observedAt,
                pubsOnHost: entry.pubs.length,
                linesOnPage: row.linesOnPage,
              }),
            );
          }
        }
        if (lines.length > 0) appendFileSync(ROWS_PATH, `${lines.join("\n")}\n`);
      }
      done += 1;
      if (done % 25 === 0) {
        const rate = done / Math.max(1, (Date.now() - started) / 1000);
        console.log(
          `  ${done}/${pending.length} hosts, ${spent} pages, ${rate.toFixed(2)} hosts/s`,
        );
        if (!DRY_RUN) writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 0)}\n`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (!DRY_RUN) writeFileSync(LEDGER_PATH, `${JSON.stringify(ledger, null, 0)}\n`);

  const outcomes = Object.fromEntries(HOST_OUTCOMES.map((name) => [name, 0]));
  const drops = {};
  let pubsOnPricedHosts = 0;
  for (const [host, row] of Object.entries(ledger.hosts)) {
    outcomes[row.outcome] = (outcomes[row.outcome] ?? 0) + 1;
    if (row.outcome === "priced") pubsOnPricedHosts += row.pubs;
    for (const [reason, count] of Object.entries(row.drops ?? {})) {
      drops[reason] = (drops[reason] ?? 0) + count;
    }
    void host;
  }

  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    snapshot: { pubs: totalPubs, statedWebsite, refusedByPolicy },
    hostsKnown: hosts.length,
    overlayMenuUrls: {
      inputRead: Boolean(overlayInput),
      held: overlayInput?.urls.length ?? 0,
      crawlable: overlayCrawlable.length,
      seeded: overlaySeeded,
      onHostWithNoSnapshotPub: overlayOnUnknownHost,
    },
    hostsCrawledThisRun: done,
    hostsInLedger: Object.keys(ledger.hosts).length,
    pagesRead: spent,
    pageBudget: PAGE_BUDGET,
    outcomes,
    pubsOnPricedHosts,
    drops,
    // A SKIP IS A FINDING: the sources the policy refuses print their reason and
    // the day it was checked, beside the counts, every run.
    sourcesRefusedByPolicy: refusedSources.map((source) => ({
      id: source.id,
      reason: source.access.reason,
      checkedOn: source.access.checkedOn,
    })),
    elapsedSeconds: Math.round((Date.now() - started) / 1000),
  };

  if (!DRY_RUN) {
    mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
    writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
  }

  console.log(`uk price harvest: ${done} host(s) crawled, ${spent} page(s) read`);
  for (const [name, count] of Object.entries(outcomes)) console.log(`  ${name}: ${count}`);
  console.log(`  pubs on priced hosts: ${pubsOnPricedHosts}`);
  for (const source of report.sourcesRefusedByPolicy) {
    console.log(`  SKIP ${source.id}: ${source.reason} (checked ${source.checkedOn})`);
  }
  if (!DRY_RUN) console.log(`  report → ${path.relative(ROOT, REPORT_PATH)}`);
}

await main();
