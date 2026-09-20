#!/usr/bin/env node
/**
 * Record TypeSafe same-pub probabilities for fixture calibration.
 * Requires TYPESAFE_API_KEY. Writes __tests__/fixtures/typesafe/same-pub-probabilities.json
 *
 *   node --import tsx scripts/record_same_pub_fixture_probs.mjs
 */

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { SAME_PUB_FIXTURE_CASES } from "../__tests__/fixtures/typesafe/samePubFixtureCases.ts";
import {
  buildVenueGroupList,
  haversineMeters,
  namesLikelySamePub,
  normalizeVenueIdentityName,
} from "./lib/venueCanonicalization.mjs";
import { cheapSamePubCandidate, judgeSamePubPair, requiresTypesafeKeyMessage, snippetFromVenueGroup, typesafeConfigured } from "../lib/samePubIdentity.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "__tests__", "fixtures", "typesafe", "same-pub-probabilities.json");
const DATASET = path.join(ROOT, "public", "data", "pint_prices_app_dataset.json");

function minedPairsFromDataset(rows, limit = 24) {
  const groups = buildVenueGroupList(rows);
  const out = [];
  for (let i = 0; i < groups.length && out.length < limit; i += 1) {
    const a = groups[i];
    for (let j = i + 1; j < groups.length && out.length < limit; j += 1) {
      const b = groups[j];
      if (
        !cheapSamePubCandidate(
          { lat: a.lat, lng: a.lng, address: a.address, normName: a.normName },
          { lat: b.lat, lng: b.lng, address: b.address, normName: b.normName },
          120,
        )
      ) {
        continue;
      }
      const keylessSame = namesLikelySamePub(a.normName, b.normName);
      out.push({
        id: `mined-${a.id.slice(-6)}-${b.id.slice(-6)}`,
        same: keylessSame,
        labelSource: "keyless-heuristic",
        state: {
          a: snippetFromVenueGroup({ name: a.name, address: a.address, operator: null, website: null }),
          b: snippetFromVenueGroup({ name: b.name, address: b.address, operator: null, website: null }),
          distanceMetres: Math.round(haversineMeters(a.lat, a.lng, b.lat, b.lng)),
        },
      });
    }
  }
  return out;
}

async function main() {
  if (!typesafeConfigured()) {
    console.error(requiresTypesafeKeyMessage());
    process.exit(1);
  }

  const rows = JSON.parse(await readFile(DATASET, "utf8"));
  const mined = minedPairsFromDataset(rows);
  const cases = [...SAME_PUB_FIXTURE_CASES];
  const seen = new Set(cases.map((c) => c.id));
  for (const m of mined) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    cases.push(m);
  }

  const recorded = [];
  let model = "unknown";
  for (const caseRow of cases) {
    const judged = await judgeSamePubPair(caseRow.state);
    if (!judged) {
      console.error(requiresTypesafeKeyMessage());
      process.exit(1);
    }
    recorded.push({
      id: caseRow.id,
      labelSame: caseRow.same,
      probability: judged.probability,
      band: judged.band,
      normA: normalizeVenueIdentityName(caseRow.state.a.name),
      normB: normalizeVenueIdentityName(caseRow.state.b.name),
      distanceMetres: caseRow.state.distanceMetres,
    });
  }

  const doc = {
    recordedAt: new Date().toISOString(),
    caseCount: recorded.length,
    mergeThreshold: 0.82,
    refuseThreshold: 0.35,
    model,
    cases: recorded,
  };
  await writeFile(OUT, `${JSON.stringify(doc, null, 2)}\n`, "utf8");
  console.log(`Wrote ${recorded.length} cases to ${OUT}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
