#!/usr/bin/env node
import { readFileSync } from "node:fs";

import { offlineFetch } from "../evals/pal/offlineFetch.ts";
import { normativeSpecForCase } from "../evals/pal/normativeSpecs.ts";
import { resolveNormativeExpectations } from "../evals/pal/normative.ts";

delete process.env.TYPESAFE_API_KEY;

const { now, cases: handKey } = JSON.parse(
  readFileSync("evals/pal/answer-key.json", "utf8"),
);
const pinned = Date.parse(now);
if (!Number.isFinite(pinned)) {
  console.error("answer-key.json needs a valid ISO `now`.");
  process.exit(1);
}

const { cases } = JSON.parse(readFileSync("evals/pal/cases.public.json", "utf8"));
let missing = 0;

for (const caseDef of cases) {
  if (!handKey[caseDef.id]) {
    console.error(`Missing hand-authored key for ${caseDef.id}`);
    missing += 1;
    continue;
  }
  if (!normativeSpecForCase(caseDef)) {
    console.error(`No normative spec for ${caseDef.id}`);
    missing += 1;
    continue;
  }
  await resolveNormativeExpectations(caseDef, {
    now: pinned,
    fetchImpl: offlineFetch,
    cityId: caseDef.cityId,
  });
}

if (missing > 0) process.exit(1);
console.log(`Normative expectations resolve for ${cases.length} cases at now=${now}.`);
