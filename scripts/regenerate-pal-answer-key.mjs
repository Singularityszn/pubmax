#!/usr/bin/env node
// Rebuild data-derived fields in answer-key.json from evals/pal/answerKeyResolver.ts
// (committed venue, price and What's-On data at the pinned `now`). Does not call
// runAsk or runAskTool. Hand-authored routing and answerIncludes stay in PAL_EVAL_ROUTING
// and the existing key; regenerate overwrites generated fields only.
import { readFileSync, writeFileSync } from "node:fs";

import { resolveFullAnswerKeyEntry } from "../evals/pal/answerKeyResolver.ts";

const HAND_AUTHORED_KEYS = ["answerIncludes", "anyTools", "priceTolerance"];

const { cases } = JSON.parse(readFileSync("evals/pal/cases.public.json", "utf8"));
const { now, cases: previous } = JSON.parse(readFileSync("evals/pal/answer-key.json", "utf8"));
const answerKey = {};
const emptied = [];
const nowMs = Date.parse(now);

for (const c of cases) {
  const resolved = await resolveFullAnswerKeyEntry(c, { now: nowMs, cityId: c.cityId ?? "london" });
  const handAuthored = Object.fromEntries(
    Object.entries(previous[c.id] ?? {}).filter(([key]) => HAND_AUTHORED_KEYS.includes(key)),
  );
  if (previous[c.id]?.minCards !== undefined && resolved.expectEmpty) emptied.push(c.id);
  answerKey[c.id] = { ...resolved, ...handAuthored };
}

if (emptied.length > 0) {
  console.error(
    `Refusing to rewrite ${emptied.join(", ")} from cards to empty at now=${now}. ` +
      "Move `now` in answer-key.json to an evening the data covers, or drop minCards from those entries if empty is the right answer.",
  );
  process.exit(1);
}

writeFileSync("evals/pal/answer-key.json", `${JSON.stringify({ now, cases: answerKey }, null, 2)}\n`);
console.log(`Regenerated ${Object.keys(answerKey).length} answer-key entries.`);
