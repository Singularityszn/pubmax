#!/usr/bin/env node
// Read dog policy and opening hours off the pub pages the amenity harvest kept.
//
//   npm run harvest:pub-website-hours-dogs
//
// It fetches nothing and calls no model. The input is the amenity harvest's
// ignored checkpoint and page texts under data-harvest/pub-website-amenities,
// and the committed chain list. Only a read the amenity run finished is used,
// so every fence that run holds applies here too. The output is
// data/amenities/london_pub_website_hours_dogs.json, one row per pub whose page
// states a dog policy or its opening hours, each with the source page, the day
// it was read and the passage that states it.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { isChainPage, parseChainDenylist } from "../../../lib/harvest/pubWebsiteAmenities.ts";
import { siteFactsRows } from "../../../lib/harvest/pubSiteHoursAndDogs.ts";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const CHECKPOINT_DIR = path.join(ROOT, "data-harvest/pub-website-amenities");
const CHECKPOINT_PATH = path.join(CHECKPOINT_DIR, "checkpoint.json");
const PAGES_DIR = path.join(CHECKPOINT_DIR, "pages");
const CHAIN_PAGES_PATH = path.join(ROOT, "data/amenities/london_pub_website_chain_pages.json");
const OUT_PATH = path.join(ROOT, "data/amenities/london_pub_website_hours_dogs.json");

const pagePath = (key) => path.join(PAGES_DIR, `${key.replace(/[^a-z0-9-]/gi, "_")}.json`);

function loadPage(osmId) {
  const file = pagePath(osmId);
  if (!existsSync(file)) return null;
  const page = JSON.parse(readFileSync(file, "utf8"));
  return typeof page.text === "string" && typeof page.readAt === "string" ? { text: page.text, readAt: page.readAt } : null;
}

function main() {
  if (!existsSync(CHECKPOINT_PATH)) {
    console.error(`no amenity checkpoint at ${path.relative(ROOT, CHECKPOINT_PATH)}; run the amenity harvest first`);
    process.exit(1);
  }
  const checkpoint = JSON.parse(readFileSync(CHECKPOINT_PATH, "utf8"));
  const chainPages = parseChainDenylist(JSON.parse(readFileSync(CHAIN_PAGES_PATH, "utf8")));
  const { rows, skipCounts } = siteFactsRows({
    reads: checkpoint.byOsmId ?? {},
    loadPage,
    isChainPage: (url) => isChainPage(url, chainPages),
  });
  const output = {
    version: 1,
    extractor: "lib/harvest/pubSiteHoursAndDogs.ts, no model",
    spendUsd: 0,
    skipCounts,
    counts: {
      rows: rows.length,
      dogsWelcome: rows.filter((row) => row.dogs?.policy === "welcome").length,
      dogsNotAllowed: rows.filter((row) => row.dogs?.policy === "not-allowed").length,
      hours: rows.filter((row) => row.hours).length,
      withVenueId: rows.filter((row) => row.venueId).length,
    },
    rows,
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(output, null, 2)}\n`);
  console.log(JSON.stringify({ out: path.relative(ROOT, OUT_PATH), skipCounts, counts: output.counts }));
}

main();
