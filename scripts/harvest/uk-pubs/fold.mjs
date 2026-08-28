#!/usr/bin/env node
// Fold the UK harvest overlay into the product store.
//
//   npm run harvest:fold -- --overlay <overlay.jsonl> --stats <fold-stats.md>
//   npm run harvest:fold -- --dry-run --overlay ... --stats ...
//
// Idempotent upserts keyed by OSM id. Malformed rows and fold-stats mismatches
// fail the process. Social observations are refused. Website and menu must be
// https. Lore requires https citations.
//
// Copy overlay.jsonl out of the harvest worktree; never write back into it.

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnv from "@next/env";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../..");
nextEnv.loadEnvConfig(ROOT);

const {
  HarvestFoldError,
  parseFoldStatsMarkdown,
  parseOverlayJsonl,
  reconcileFoldStats,
  summariseOverlay,
} = await import("../../../lib/harvestFold.ts");

function arg(flag, fallback = "") {
  const index = process.argv.indexOf(flag);
  if (index === -1) return fallback;
  return process.argv[index + 1] ?? fallback;
}

function hasFlag(flag) {
  return process.argv.includes(flag);
}

function usage() {
  return `Usage:
  npm run harvest:fold -- --overlay <overlay.jsonl> --stats <fold-stats.md>
  npm run harvest:fold -- --dry-run --overlay <overlay.jsonl> --stats <fold-stats.md>

Fails loud on a malformed row or a count that does not match fold-stats.md.`;
}

async function main() {
  if (hasFlag("--help") || hasFlag("-h")) {
    console.log(usage());
    return;
  }
  const overlayPath = arg("--overlay", join(ROOT, "data-harvest/fold-ready/overlay.jsonl"));
  const statsPath = arg("--stats", join(ROOT, "data/uk-pub-harvest/fold-stats.md"));
  const dryRun = hasFlag("--dry-run");

  let overlayText;
  let statsText;
  try {
    overlayText = readFileSync(resolve(overlayPath), "utf8");
    statsText = readFileSync(resolve(statsPath), "utf8");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`harvest:fold could not read inputs: ${message}`);
    process.exitCode = 1;
    return;
  }

  const rows = parseOverlayJsonl(overlayText);
  const actual = summariseOverlay(rows);
  const expected = parseFoldStatsMarkdown(statsText);
  reconcileFoldStats(actual, expected);

  console.log(
    `Fold-ready overlay: ${actual.overlayRows} rows, ${actual.httpsWebsite} https websites, ${actual.httpsMenuUrl} https menus, ${actual.matchedLore} cited lore, ${actual.social} social.`,
  );

  if (dryRun) {
    console.log("Dry run. No rows written.");
    return;
  }

  const { harvestOverlayStore } = await import("../../../lib/harvestOverlayStore.ts");
  const outcome = await harvestOverlayStore().upsertMany(rows);
  if (outcome.failed) {
    console.error(`harvest:fold write failed: ${outcome.failure ?? "unknown error"}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Upserted ${outcome.written} overlay rows.`);
}

main().catch((error) => {
  if (error instanceof HarvestFoldError) {
    console.error(`harvest:fold ${error.code}: ${error.message}`);
  } else {
    console.error(error instanceof Error ? error.message : String(error));
  }
  process.exitCode = 1;
});
