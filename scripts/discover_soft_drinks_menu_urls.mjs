#!/usr/bin/env node
/**
 * Discover London first-party soft-drink menu URLs per chain.
 * Writes data/soft_drinks_{chain}_london_urls.txt (one URL per line).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { inGreaterLondon } from "./fetch_uk_osm_venues.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const ENRICHMENT = join(ROOT, "public/data/venue_menu_enrichment.json");
const WETHERSPOONS = join(ROOT, "public/data/wetherspoons/pubs.json");
const GK_URLS = join(ROOT, "data/greene_king_london_menu_urls.txt");
const NICHOLSONS = join(ROOT, "data/nicholsons_london_drink_urls.txt");
const USER_AGENT =
  "PUBMAXXHarvest/1.0 (+https://pubmaxxing.com; hello@pubmaxxing.com)";

const MENU_SUFFIXES = ["/food-and-drinks/", "/food-and-drinks?menu=main-menu", "/food-and-drink/", "/food-drink/", "/drinks/", "/menus", "/menu"];

function outPath(chain) {
  return join(ROOT, `data/soft_drinks_${chain}_london_urls.txt`);
}

function writeUrls(chain, urls) {
  const unique = [...new Set(urls.map((u) => u.trim()).filter((u) => u.startsWith("http")))];
  mkdirSync(dirname(outPath(chain)), { recursive: true });
  writeFileSync(outPath(chain), `${unique.join("\n")}\n`);
  console.log(JSON.stringify({ chain, count: unique.length, path: outPath(chain) }));
  return unique;
}

function discoverWetherspoon() {
  const raw = JSON.parse(readFileSync(WETHERSPOONS, "utf8"));
  const pubs = (raw.pubs ?? []).filter(
    (pub) =>
      typeof pub.latitude === "number" &&
      typeof pub.longitude === "number" &&
      inGreaterLondon({ lat: pub.latitude, lng: pub.longitude }) &&
      pub.menuUrl,
  );
  return writeUrls("wetherspoon", pubs.map((p) => p.menuUrl));
}

function discoverGreeneKing() {
  if (!existsSync(GK_URLS)) return writeUrls("greene-king", []);
  const urls = readFileSync(GK_URLS, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("http"));
  return writeUrls("greene-king", urls);
}

function discoverNicholsons() {
  if (!existsSync(NICHOLSONS)) return writeUrls("nicholsons", []);
  const urls = readFileSync(NICHOLSONS, "utf8")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("http"));
  return writeUrls("nicholsons", urls);
}

function youngsMenuCandidates(baseUrl) {
  const root = baseUrl.replace(/\/$/, "");
  return MENU_SUFFIXES.map((suffix) => `${root}${suffix.startsWith("/") ? suffix : `/${suffix}`}`);
}

function discoverYoungs() {
  const enrichment = JSON.parse(readFileSync(ENRICHMENT, "utf8"));
  const urls = Object.values(enrichment.venues ?? {})
    .filter((v) => v.source === "youngs.co.uk" && v.menuUrl)
    .map((v) => `${v.menuUrl.replace(/\/$/, "")}/foodanddrink`);
  return writeUrls("youngs", urls);
}

async function fetchSitemapLocs(url) {
  const response = await fetch(url, { headers: { "user-agent": USER_AGENT } });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const xml = await response.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

async function discoverSlugAndLettuce() {
  const locs = await fetchSitemapLocs("https://www.slugandlettuce.co.uk/sitemap.xml");
  const londonMenus = locs.filter(
    (loc) =>
      /\/bars\/[^/]+\/menus$/i.test(loc) &&
      /london|canary|soho|shoreditch|bank|city|westminster|camden|clapham|brixton|greenwich|stratford|wimbledon|richmond|kingston|ealing|hammersmith|fulham|chelsea|kensington|paddington|marylebone|islington|hackney|tower|bermondsey|waterloo|victoria|holborn|covent|oxford-circus|liverpool-street|o2-arena/i.test(
        loc,
      ),
  );
  return writeUrls("slug-and-lettuce", londonMenus);
}

async function discoverBrewdog() {
  const locs = await fetchSitemapLocs("https://brewdog.com/sitemap.xml").catch(() => []);
  const barMenus = locs.filter(
    (loc) =>
      /brewdog\.com\/uk\/brewdog-bars\//i.test(loc) &&
      /london|shoreditch|soho|canary|waterloo|shepherd|wandsworth|tower|camden|clapham|brixton|greenwich|hammersmith|paddington|victoria|bank|liverpool|angel|highbury|kensington|chelsea|fulham|ealing|stratford|wimbledon|richmond|kingston/i.test(
        loc,
      ),
  );
  return writeUrls("brewdog", barMenus.flatMap((u) => [`${u.replace(/\/$/, "")}/menu`, u]));
}

function parseArgs(argv) {
  let chain = "all";
  for (let i = 2; i < argv.length; i += 1) {
    if (argv[i] === "--chain" && argv[i + 1]) chain = argv[++i];
  }
  return { chain };
}

const DISCOVERERS = {
  wetherspoon: discoverWetherspoon,
  "greene-king": discoverGreeneKing,
  nicholsons: discoverNicholsons,
  youngs: discoverYoungs,
  "slug-and-lettuce": discoverSlugAndLettuce,
  brewdog: discoverBrewdog,
};

async function main() {
  const { chain } = parseArgs(process.argv);
  const chains = chain === "all" ? Object.keys(DISCOVERERS) : [chain];
  for (const name of chains) {
    const fn = DISCOVERERS[name];
    if (!fn) {
      console.error(`Unknown chain ${name}`);
      process.exit(1);
    }
    await fn();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
