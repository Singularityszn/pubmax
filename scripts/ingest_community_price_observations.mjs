#!/usr/bin/env node
/** Copy data/community_price_observations/*.json to public/data/community_price_observations/ */
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { isValidCommunityPriceObservationRow, communityPriceObservationId } from "../lib/communityPriceObservation.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "data/community_price_observations");
const DEST = join(ROOT, "public/data/community_price_observations");

const slim = JSON.parse(readFileSync(join(ROOT, "public/data/venues_slim.json"), "utf8"));
if (!Array.isArray(slim.rows)) throw new Error("Missing venue catalogue for community evidence validation");
const venueIds = new Set(slim.rows.map((row) => row.id));

mkdirSync(DEST, { recursive: true });
for (const name of readdirSync(SRC)) {
  if (!name.endsWith(".json")) continue;
  const pack = JSON.parse(readFileSync(join(SRC, name), "utf8"));
  if (pack.version !== 1 || pack.lane !== "reddit-london" || !Array.isArray(pack.observations)) {
    throw new Error(`Invalid community observation pack: ${name}`);
  }
  const ids = new Set();
  const observations = pack.observations.filter((row) => {
    if (!isValidCommunityPriceObservationRow(row, Date.now(), venueIds)) return false;
    const id = communityPriceObservationId(row);
    if (ids.has(id)) return false;
    ids.add(id);
    return true;
  });
  if (observations.length !== pack.observations.length && !process.argv.includes("--prune-invalid")) {
    throw new Error(`Refusing invalid or duplicate observations in ${name}`);
  }
  const text = JSON.stringify({ ...pack, observations }, null, 2) + "\n";
  if (process.argv.includes("--prune-invalid")) writeFileSync(join(SRC, name), text);
  writeFileSync(join(DEST, name), text);
  console.log("ingested", name);
}
if (!existsSync(join(DEST, "london_reddit.json"))) {
  console.error("missing london_reddit.json after ingest");
  process.exit(1);
}
