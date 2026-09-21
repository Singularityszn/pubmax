#!/usr/bin/env node
/** Copy data/community_price_observations/*.json to public/data/community_price_observations/ */
import { cpSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = join(ROOT, "data/community_price_observations");
const DEST = join(ROOT, "public/data/community_price_observations");

mkdirSync(DEST, { recursive: true });
for (const name of readdirSync(SRC)) {
  if (!name.endsWith(".json")) continue;
  cpSync(join(SRC, name), join(DEST, name));
  console.log("ingested", name);
}
if (!existsSync(join(DEST, "london_reddit.json"))) {
  console.error("missing london_reddit.json after ingest");
  process.exit(1);
}
