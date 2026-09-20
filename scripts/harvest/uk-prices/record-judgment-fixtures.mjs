#!/usr/bin/env node
// Record TypeSafe probabilities for pint-price fixture cases. Requires TYPESAFE_API_KEY.
//
//   ( set -a; . /path/to/keys.env; set +a; tsx scripts/harvest/uk-prices/record-judgment-fixtures.mjs )

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { judgeUkPriceCandidate } from "../../../lib/harvest/ukPriceJudgment.server.ts";

const ROOT = process.cwd();
const CASES_PATH = path.join(ROOT, "__tests__/fixtures/typesafe/pint-price-cases.json");
const OUT_PATH = path.join(ROOT, "__tests__/fixtures/typesafe/pint-price-judgment-probabilities.json");

async function main() {
  if (!process.env.TYPESAFE_API_KEY?.trim()) {
    console.error("TYPESAFE_API_KEY is required to record judgment fixture probabilities.");
    process.exitCode = 1;
    return;
  }

  const cases = JSON.parse(readFileSync(CASES_PATH, "utf8"));
  const recorded = {};

  for (const caseRow of cases) {
    const probabilities = await judgeUkPriceCandidate({
      pubName: caseRow.pubName,
      pageUrl: caseRow.pageUrl,
      snippet: caseRow.snippet,
      priceText: caseRow.priceText,
    });
    if (!probabilities) {
      console.error(`judgment failed for ${caseRow.id}`);
      process.exitCode = 1;
      return;
    }
    recorded[caseRow.id] = probabilities;
    console.log(`recorded ${caseRow.id}`);
  }

  const payload = {
    recordedAt: new Date().toISOString().slice(0, 10),
    model: "jev-latest",
    cases: recorded,
  };
  writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`wrote ${path.relative(ROOT, OUT_PATH)}`);
}

main();
