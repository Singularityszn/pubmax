#!/usr/bin/env node
// Maintainer tool: rebuild the generated expectations in answer-key.json from
// the current keyless, offline Ask path at the key's pinned `now`, with the
// TypeSafe key cleared so routing is the regex cascade the gate replays.
// Hand-authored keys (answerIncludes, anyTools, priceTolerance) and the pinned
// `now` are kept; an entry graded by anyTools gets no expectedTools. A case the
// key expected cards for never turns empty here: that means the pinned evening
// no longer has data, so the script refuses and writes nothing.
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

delete process.env.TYPESAFE_API_KEY;

const { cases } = JSON.parse(readFileSync("evals/pal/cases.public.json", "utf8"));
const { now, cases: previous } = JSON.parse(readFileSync("evals/pal/answer-key.json", "utf8"));
const answerKey = {};
const emptied = [];

for (const c of cases) {
  const r = await runAsk({
    query: c.query,
    cityId: c.cityId ?? "london",
    skipModel: true,
    turns: c.turns,
    now: Date.parse(now),
    fetchImpl: offlineFetch,
  });
  const handAuthored = Object.fromEntries(
    Object.entries(previous[c.id] ?? {}).filter(([key]) => !GENERATED_KEYS.includes(key)),
  );
  if (previous[c.id]?.minCards !== undefined && r.cards.length === 0) emptied.push(c.id);
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

if (emptied.length > 0) {
  console.error(
    `Refusing to rewrite ${emptied.join(", ")} from cards to empty at now=${now}. ` +
      "Move `now` in answer-key.json to an evening the data covers, or drop minCards from those entries if empty is the right answer.",
  );
  process.exit(1);
}

writeFileSync("evals/pal/answer-key.json", `${JSON.stringify({ now, cases: answerKey }, null, 2)}\n`);
console.log(`Regenerated ${Object.keys(answerKey).length} answer-key entries.`);
