#!/usr/bin/env node
// npm run harvest:uk-food — the London pub food lane's CLI.
//
// Reads what a London pub's OWN website states about its food: dish, category
// and £ price, each kept only when the page states it (lib/harvest/ukFoodCrawl.ts).
// The crawl and its permission rules live in ./lane.mjs; this file wires the
// real transports and owns the files.
//
// TARGETS, in this order:
//   curated   public/data/venue_menu_enrichment.json: curated London venues and
//             the menu URL each one's own operator page names. The row key is
//             the curated venue id, which the Menu tab accepts as a lookup key.
//   osm       data/osm/uk/uk_osm_pubs.json: London pubs (Greater London bbox)
//             whose OSM row states a website, keyed `venue-uk-*` the way the
//             base layer keys them. A host a curated venue already owns is left
//             to the curated lane, so one estate is not read twice.
//
// TRANSPORTS: a served fetch first; a Browserbase render (BROWSERBASE_API_KEY,
// through scripts/lib/localRefreshProviders.mjs) only when the served page
// states no menu. Without the key the lane reads served pages only and the
// report says rendering was not configured, rather than pretending it ran.
//
// FILES:
//   data-harvest/uk_food/hosts.json    ledger + checkpoint (gitignored)
//   data-harvest/uk_food/rows.jsonl    candidate rows with their verbatim quote (gitignored)
//   data/uk_food/harvest_report.json   the run's counts (committed)
// Publishing is a separate, reviewed step: npm run build:food-price-updates.
//
// Flags: --source curated|osm|all (default all), --hosts N, --pages N (default
// 8000, enough for every London host at six pages), --renders N (Browserbase
// sessions, default 500), --render auto|never|always (default auto),
// --only <substr>, --reset, --recheck <outcome,...>, --dry-run.

import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { pdfIsWorthReading, readPdfText } from "../../../lib/harvest/pdfText.ts";
import { createRobotsChecker } from "../../../lib/harvest/robots.ts";
import { inGreaterLondon } from "../../fetch_uk_osm_venues.mjs";
import { fetchRefreshPage } from "../../lib/localRefreshProviders.mjs";
import { FOOD_HOST_OUTCOMES, groupFoodTargetsByHost, harvestFood } from "./lane.mjs";

const ROOT = process.cwd();
const LEDGER_DIR = path.join(ROOT, "data-harvest", "uk_food");
const LEDGER_PATH = path.join(LEDGER_DIR, "hosts.json");
const ROWS_PATH = path.join(LEDGER_DIR, "rows.jsonl");
const REPORT_PATH = path.join(ROOT, "data", "uk_food", "harvest_report.json");
const USER_AGENT = "PUBMAXXHarvest/1.0 (+https://pubmaxx.app; food menus)";
const PAGE_TIMEOUT_MS = 25_000;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;

export function parseFoodHarvestArgs(argv) {
  const options = { source: "all", hosts: null, pages: 8_000, renders: 500, render: "auto", only: null, reset: false, recheck: [], dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const value = () => {
      const next = argv[i + 1];
      if (next === undefined) throw new Error(`${arg} needs a value`);
      i += 1;
      return next;
    };
    if (arg === "--source") options.source = value();
    else if (arg === "--hosts") options.hosts = Number(value());
    else if (arg === "--pages") options.pages = Number(value());
    else if (arg === "--render") options.render = value();
    else if (arg === "--renders") options.renders = Number(value());
    else if (arg === "--only") options.only = value();
    else if (arg === "--reset") options.reset = true;
    else if (arg === "--recheck") options.recheck = value().split(",").map((s) => s.trim()).filter(Boolean);
    else if (arg === "--dry-run") options.dryRun = true;
    else throw new Error(`unknown flag ${arg}`);
  }
  if (!["curated", "osm", "all"].includes(options.source)) throw new Error(`--source must be curated, osm or all`);
  if (!["auto", "never", "always"].includes(options.render)) throw new Error(`--render must be auto, never or always`);
  for (const key of ["hosts", "pages", "renders"]) {
    if (options[key] !== null && !(Number.isInteger(options[key]) && options[key] > 0)) throw new Error(`--${key} must be a positive integer`);
  }
  for (const outcome of options.recheck) {
    if (!FOOD_HOST_OUTCOMES.includes(outcome)) throw new Error(`--recheck: unknown outcome ${outcome}`);
  }
  return options;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The salted id the UK base layer gives one OSM pub (lib/ukBasePubs.ts). */
export function ukBaseVenueId(osmId) {
  if (typeof osmId !== "string") return null;
  const match = /^(node|way|relation)\/(\d+)$/.exec(osmId.trim());
  return match ? `venue-uk-${match[1][0]}${match[2]}` : null;
}

function normalisedWebsite(website) {
  if (typeof website !== "string" || !website.trim()) return null;
  try {
    const url = new URL(website.includes("//") ? website.trim() : `https://${website.trim()}`);
    if (url.protocol === "http:") url.protocol = "https:";
    return url.toString();
  } catch {
    return null;
  }
}

/** Social, listings and site-builder hosts: never a pub's own menu. */
const NOT_A_PUB_SITE =
  /(facebook|instagram|twitter|x\.com|tiktok|tripadvisor|google\.|goo\.gl|yelp|whatpub|beerintheevening|wixsite|linktr\.ee|deliveroo|ubereats|just-eat|opentable|designmynight|squarespace\.com$)/i;

export function curatedFoodTargets(enrichment, slimRows) {
  const names = new Map(slimRows.map((row) => [row.id, row.name]));
  return Object.entries(enrichment.venues ?? {})
    .filter(([, row]) => typeof row.menuUrl === "string")
    .map(([venueId, row]) => ({
      venueId,
      venueKey: venueId,
      name: names.get(venueId) ?? null,
      menuUrls: [row.menuUrl],
      source: "curated",
    }));
}

export function osmFoodTargets(snapshot, curatedHosts) {
  const pubs = Array.isArray(snapshot) ? snapshot : snapshot.pubs ?? [];
  const out = [];
  for (const pub of pubs) {
    if (typeof pub.lat !== "number" || typeof pub.lng !== "number" || !inGreaterLondon(pub)) continue;
    const website = normalisedWebsite(pub.website);
    const venueId = ukBaseVenueId(pub.osmId);
    if (!website || !venueId) continue;
    const host = new URL(website).hostname.replace(/^www\./, "");
    if (NOT_A_PUB_SITE.test(host) || curatedHosts.has(host)) continue;
    out.push({ venueId, venueKey: venueId, name: pub.name ?? null, website, menuUrls: [], source: "osm" });
  }
  return out;
}

async function fetchServed(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PAGE_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { accept: "text/html,application/xhtml+xml,application/pdf;q=0.8,*/*;q=0.5", "user-agent": USER_AGENT },
      signal: controller.signal,
      redirect: "follow",
    });
    const contentType = response.headers.get("content-type") ?? "";
    if (/application\/pdf/i.test(contentType)) {
      const bytes = new Uint8Array(await response.arrayBuffer());
      return { ok: response.ok, status: response.status, url: response.url, contentType, body: pdfIsWorthReading(bytes.byteLength) ? bytes : new Uint8Array() };
    }
    const body = await response.text();
    return { ok: response.ok, status: response.status, url: response.url, contentType, body: body.slice(0, MAX_PAGE_BYTES) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const options = parseFoodHarvestArgs(process.argv.slice(2));
  const browserbaseConfigured = Boolean(process.env.BROWSERBASE_API_KEY?.trim());
  if (options.render === "always" && !browserbaseConfigured) {
    throw new Error("--render always needs BROWSERBASE_API_KEY; nothing was read");
  }

  const curated = options.source === "osm" ? [] : curatedFoodTargets(
    readJson(path.join(ROOT, "public/data/venue_menu_enrichment.json")),
    (() => {
      const slim = readJson(path.join(ROOT, "public/data/venues_slim.json"));
      return Array.isArray(slim) ? slim : slim.rows ?? [];
    })(),
  );
  const curatedHosts = new Set(groupFoodTargetsByHost(curated).map((entry) => entry.host));
  const osm = options.source === "curated" ? [] : osmFoodTargets(readJson(path.join(ROOT, "data/osm/uk/uk_osm_pubs.json")), curatedHosts);

  let ledger = {};
  if (!options.reset && existsSync(LEDGER_PATH)) ledger = readJson(LEDGER_PATH);
  for (const [host, row] of Object.entries(ledger)) {
    if (options.recheck.includes(row.outcome)) delete ledger[host];
  }
  let hosts = groupFoodTargetsByHost([...curated, ...osm]).filter((entry) => !ledger[entry.host]);
  if (options.only) hosts = hosts.filter((entry) => entry.host.includes(options.only));
  if (options.hosts) hosts = hosts.slice(0, options.hosts);

  const renderMode = browserbaseConfigured ? options.render : "never";
  const result = await harvestFood(hosts, {
    robots: createRobotsChecker(),
    fetchServed,
    renderPage: browserbaseConfigured ? (url) => fetchRefreshPage({ job: "rendered-menu", url }) : undefined,
    renderMode,
    readPdf: (bytes) => (bytes.byteLength > 0 ? readPdfText(bytes) : Promise.resolve(null)),
    pageBudget: options.pages,
    renderBudget: options.renders,
  });

  const report = {
    generatedAt: new Date().toISOString(),
    targets: { curated: curated.length, osm: osm.length },
    hostsThisRun: hosts.length,
    rendering: browserbaseConfigured ? `browserbase (${renderMode})` : "not configured: BROWSERBASE_API_KEY unset, served pages only",
    ...result.summary,
  };
  console.log(JSON.stringify(report, null, 2));
  if (options.dryRun) return;

  mkdirSync(LEDGER_DIR, { recursive: true });
  mkdirSync(path.dirname(REPORT_PATH), { recursive: true });
  writeFileSync(LEDGER_PATH, `${JSON.stringify({ ...ledger, ...result.ledger }, null, 2)}\n`);
  if (result.rows.length > 0) appendFileSync(ROWS_PATH, result.rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  writeFileSync(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
}

const isDirectRun = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
