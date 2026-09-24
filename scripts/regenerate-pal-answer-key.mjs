#!/usr/bin/env node
// Maintainer tool: rebuild the generated expectations in answer-key.json from
// the current keyless, offline Ask path. Hand-authored keys (answerIncludes,
// anyTools, priceTolerance) are kept; an entry graded by anyTools gets no
// expectedTools.
import { readFileSync, writeFileSync } from "node:fs";
import { offlineFetch } from "../evals/pal/offlineFetch.ts";
import { runAsk } from "../lib/ask/runAsk.ts";

const GENERATED_KEYS = [
  "expectedTools",
  "minCards",
  "expectEmpty",
  "expectDegraded",
  "topVenueId",
  "topPrice",
];

const { cases } = JSON.parse(readFileSync("evals/pal/cases.public.json", "utf8"));
const previous = JSON.parse(readFileSync("evals/pal/answer-key.json", "utf8")).cases;
const answerKey = {};

for (const c of cases) {
  const r = await runAsk({
    query: c.query,
    cityId: c.cityId ?? "london",
    skipModel: true,
    turns: c.turns,
    fetchImpl: offlineFetch,
  });
  const handAuthored = Object.fromEntries(
    Object.entries(previous[c.id] ?? {}).filter(([key]) => !GENERATED_KEYS.includes(key)),
  );
  const first = r.cards.find((card) => card.venueId);
  answerKey[c.id] = {
    ...(handAuthored.anyTools ? {} : { expectedTools: r.toolsUsed }),
    ...(r.cards.length === 0 ? { expectEmpty: true } : { minCards: 1 }),
    ...(r.status === "degraded" ? { expectDegraded: true } : {}),
    ...(first
      ? {
          topVenueId: first.venueId,
          ...(first.price != null ? { topPrice: first.price } : {}),
        }
      : {}),
    ...handAuthored,
  };
}

writeFileSync("evals/pal/answer-key.json", `${JSON.stringify({ cases: answerKey }, null, 2)}\n`);
console.log(`Regenerated ${Object.keys(answerKey).length} answer-key entries.`);
