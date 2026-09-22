#!/usr/bin/env node
/**
 * Build soft-drink menu URL lists from curated publisher-to-venue bindings.
 * A publisher sitemap is not venue identity evidence, so unjoined chains yield
 * an empty generated list rather than guessed London URLs.
 */

import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { inGreaterLondon } from "./fetch_uk_osm_venues.mjs";
import { buildVenueIndexes } from "./lib/venueMatch.mjs";
import { buildCuratedSoftDrinkTargets } from "./lib/softDrinkTargets.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const DATASET = join(ROOT, "public/data/pint_prices_app_dataset.json");
const ENRICHMENT = join(ROOT, "public/data/venue_menu_enrichment.json");
const CHAINS = ["wetherspoon", "greene-king", "nicholsons", "youngs", "slug-and-lettuce", "brewdog"];

function writeTargets(chain, targets) {
  const path = join(ROOT, `data/soft_drinks_${chain}_london_urls.txt`);
  const urls = [...new Set(targets.map((target) => target.url))];
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, urls.length ? `${urls.join("\n")}\n` : "");
  console.log(JSON.stringify({
    chain,
    count: urls.length,
    path,
    ...(urls.length === 0 ? { decision: "no-reviewed-venue-binding" } : {}),
  }));
  return urls;
}

function discover(chain) {
  const dataset = JSON.parse(readFileSync(DATASET, "utf8"));
  const enrichment = JSON.parse(readFileSync(ENRICHMENT, "utf8"));
  const targets = buildCuratedSoftDrinkTargets({
    chain,
    enrichment,
    indexes: buildVenueIndexes(dataset),
    inGreaterLondon,
  });
  return writeTargets(chain, targets);
}

function parseArgs(argv) {
  let chain = "all";
  for (let index = 2; index < argv.length; index += 1) {
    if (argv[index] === "--chain" && argv[index + 1]) chain = argv[++index];
  }
  return { chain };
}

function main() {
  const { chain } = parseArgs(process.argv);
  const chains = chain === "all" ? CHAINS : [chain];
  for (const name of chains) {
    if (!CHAINS.includes(name)) throw new Error(`Unknown chain ${name}`);
    discover(name);
  }
}

main();
