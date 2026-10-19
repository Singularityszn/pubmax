#!/usr/bin/env node
// Cut the price-crawl candidates from completed Exa shards.
//
//   npm run harvest:uk-exa-sites                     # London shards, write the input
//   npm run harvest:uk-exa-sites -- --dry-run        # print the counts, write nothing
//   npm run harvest:uk-exa-sites -- --enriched-dir data-harvest/enriched \
//     --seed data-harvest/uk_pubs_seed.enriching.jsonl
//
// Then crawl them:
//
//   npm run harvest:uk-prices -- --london --exa-sites data/uk_prices/exa_site_candidates.json --exa-sites-only
//
// The website each pub gets is the one `npm run harvest:fold` would record, and
// it reaches no price until a page of that site states the pub's own postcode or
// street address. The rules are in ./exaSites.mjs. This script reads local
// shards only: it holds no production read and no production write.
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

import { canonicalOsmId, overlayRowsFromHarvestRecords } from "../../../lib/harvestFold.ts";
import { isHarvestableOperatorUrl } from "../../../lib/harvest/sourcePolicy.ts";
import { readJsonl } from "../../lib/ukPubHarvest.mjs";
import { buildSeedMetadata } from "../uk-pubs/foldInput.mjs";
import { selectExaSiteCandidates } from "./exaSites.mjs";

const ROOT = process.cwd();
const OUT_PATH = path.join(ROOT, "data/uk_prices/exa_site_candidates.json");

function option(name, fallback) {
  const at = process.argv.indexOf(name);
  if (at === -1) return fallback;
  const value = process.argv[at + 1];
  return value && !value.startsWith("--") ? value : fallback;
}

const ENRICHED_DIR = path.resolve(ROOT, option("--enriched-dir", "data-harvest/london-enriched"));
const SEED_PATH = path.resolve(ROOT, option("--seed", "data-harvest/uk_pubs_seed.london.enriching.jsonl"));
const WRITE_PATH = path.resolve(ROOT, option("--out", OUT_PATH));
const DRY_RUN = process.argv.includes("--dry-run");

/**
 * The record with only the observations the fold accepts. The fold fails a whole
 * run on one observation it refuses (an http page, a social host), which is
 * right for a write to production and wrong for a crawl input: here the refused
 * observation is dropped and counted, and the fold's own gate decides which.
 */
const droppedObservations = {};
function foldableRecord(record) {
  try {
    overlayRowsFromHarvestRecords([record]);
    return record;
  } catch {
    const observations = (record.observations ?? []).filter((observation) => {
      try {
        overlayRowsFromHarvestRecords([{ ...record, observations: [observation] }]);
        return true;
      } catch (error) {
        const reason = error instanceof Error ? error.message.replace(/^line \d+: /, "") : "refused";
        droppedObservations[reason] = (droppedObservations[reason] ?? 0) + 1;
        return false;
      }
    });
    return { ...record, observations };
  }
}

async function main() {
  if (!existsSync(SEED_PATH) || !existsSync(ENRICHED_DIR)) {
    console.error(`exa sites: need ${path.relative(ROOT, SEED_PATH)} and ${path.relative(ROOT, ENRICHED_DIR)}`);
    console.error("  nothing written: run npm run harvest:uk-pubs -- --london --enrich first");
    process.exitCode = 1;
    return;
  }
  const seedRows = await readJsonl(SEED_PATH);
  const metadata = buildSeedMetadata(seedRows, SEED_PATH);
  const seedByOsmId = new Map(seedRows.map((row) => [canonicalOsmId(row.osmId), row]));

  const shards = readdirSync(ENRICHED_DIR).filter((name) => /^shard_\d{4}\.jsonl$/.test(name)).sort();
  const records = [];
  for (const name of shards) {
    for (const raw of await readJsonl(path.join(ENRICHED_DIR, name))) {
      const osmId = canonicalOsmId(String(raw?.osmId ?? ""));
      const meta = osmId ? metadata.get(osmId) : null;
      if (!meta) throw new Error(`enriched row has no matching seed row: ${raw?.osmId}`);
      if (raw.name !== meta.name) throw new Error(`enriched row name disagrees with seed: ${raw.osmId}`);
      records.push(foldableRecord({ osmId, name: meta.name, town: meta.town, observations: raw.observations }));
    }
  }

  // RULE 1. The fold's own derivation, so this input and the overlay table can
  // never disagree about which website a pub has.
  const overlayRows = overlayRowsFromHarvestRecords(records);
  const { candidates, outcomes, refusedHosts } = selectExaSiteCandidates(overlayRows, seedByOsmId, {
    isHarvestableOperatorUrl,
  });

  const input = {
    version: 1,
    readAt: new Date().toISOString(),
    source: `${path.relative(ROOT, ENRICHED_DIR)} (Exa shards through the harvest:fold derivation)`,
    readVia: "local-exa-shards",
    counts: {
      enrichedPubs: records.length,
      overlayRows: overlayRows.length,
      ...outcomes,
      observationsRefusedByFold: Object.values(droppedObservations).reduce((sum, count) => sum + count, 0),
      distinctHosts: new Set(candidates.map((candidate) => candidate.host)).size,
    },
    refusedHosts,
    observationsRefusedByFold: droppedObservations,
    candidates,
  };

  console.log(`exa sites: ${records.length} enriched pub(s) in ${shards.length} shard(s), ${overlayRows.length} overlay row(s)`);
  for (const [name, count] of Object.entries(outcomes)) console.log(`  ${name}: ${count}`);
  for (const [reason, count] of Object.entries(droppedObservations)) console.log(`  DROP ${reason}: ${count}`);
  if (DRY_RUN) return;
  mkdirSync(path.dirname(WRITE_PATH), { recursive: true });
  writeFileSync(WRITE_PATH, `${JSON.stringify(input, null, 2)}\n`);
  console.log(`  input → ${path.relative(ROOT, WRITE_PATH)}`);
}

export { OUT_PATH as EXA_SITE_INPUT_PATH };

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
