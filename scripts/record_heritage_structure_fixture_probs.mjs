#!/usr/bin/env node
/**
 * Record TypeSafe NHLE-structure probabilities for fixture calibration.
 * Requires TYPESAFE_API_KEY. Writes
 * __tests__/fixtures/typesafe/heritage-structure-probabilities.json
 *
 *   node --import tsx scripts/record_heritage_structure_fixture_probs.mjs
 */

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { HERITAGE_STRUCTURE_FIXTURE_CASES } from "../__tests__/fixtures/typesafe/heritageStructureFixtureCases.ts";
import {
  bandFromHeritageStructureProbability,
  HERITAGE_STRUCTURE_ACCEPT_THRESHOLD,
  HERITAGE_STRUCTURE_REFUSE_THRESHOLD,
  judgeHeritageListingStructure,
  requiresHeritageStructureKeyMessage,
  typesafeConfigured,
} from "../lib/heritageListingStructure.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(
  ROOT,
  "__tests__",
  "fixtures",
  "typesafe",
  "heritage-structure-probabilities.json",
);

async function main() {
  if (!typesafeConfigured()) {
    console.error(requiresHeritageStructureKeyMessage());
    process.exit(1);
  }

  const recorded = [];
  let model = null;
  for (const caseRow of HERITAGE_STRUCTURE_FIXTURE_CASES) {
    const judged = await judgeHeritageListingStructure(caseRow.state);
    if (!judged) {
      console.error(requiresHeritageStructureKeyMessage());
      process.exit(1);
    }
    model = model ?? judged.model;
    recorded.push({
      id: caseRow.id,
      labelListingIsPubBuilding: caseRow.listingIsPubBuilding,
      labelSource: "hand",
      probability: judged.probability,
      band: judged.band,
      listingName: caseRow.state.listing.name,
      pubName: caseRow.state.pub.name,
    });
  }

  const truePairs = recorded.filter((row) => row.labelListingIsPubBuilding);
  const falsePairs = recorded.filter((row) => !row.labelListingIsPubBuilding);
  const weakestTrue = Math.min(...truePairs.map((row) => row.probability));
  const strongestFalse = Math.max(...falsePairs.map((row) => row.probability));

  const doc = {
    caseCount: recorded.length,
    acceptThreshold: HERITAGE_STRUCTURE_ACCEPT_THRESHOLD,
    refuseThreshold: HERITAGE_STRUCTURE_REFUSE_THRESHOLD,
    weakestTrue,
    strongestFalse,
    model: model ?? "unknown",
    cases: recorded,
  };
  await writeFile(OUT, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`Wrote ${recorded.length} cases to ${OUT}`);
  console.log(
    `weakestTrue=${weakestTrue.toFixed(3)} strongestFalse=${strongestFalse.toFixed(3)} bandCheck=${recorded.map((r) => `${r.id}:${r.band}`).join(" ")}`,
  );
  for (const row of recorded) {
    const expected = bandFromHeritageStructureProbability(row.probability);
    if (expected !== row.band) {
      console.error(`band drift on ${row.id}: stored ${row.band} computed ${expected}`);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
