#!/usr/bin/env node
// Maintainer tool: rebuild answer-key.json from the current keyless Ask path.
import { readFileSync, writeFileSync } from "node:fs";
import { runAsk } from "../lib/ask/runAsk.ts";
import { routeAskDeterministically } from "../lib/ask/router.ts";

const { cases } = JSON.parse(readFileSync("evals/pal/cases.public.json", "utf8"));
const answerKey = {};

for (const c of cases) {
  if (c.recordedResponse) continue;
  const r = await runAsk({
    query: c.query,
    cityId: c.cityId ?? "london",
    skipModel: true,
    turns: c.turns,
  });
  const routed = routeAskDeterministically(c.query).map((x) => x.name);
  const first = r.cards.find((card) => card.venueId);
  answerKey[c.id] = {
    expectedTools: r.toolsUsed,
    expectedRouteTools: routed,
    ...(r.cards.length === 0 ? { expectEmpty: true } : { minCards: 1 }),
    ...(r.status === "degraded" ? { expectDegraded: true } : {}),
    ...(first
      ? {
          topVenueId: first.venueId,
          ...(first.price != null ? { topPrice: first.price } : {}),
        }
      : {}),
  };
}

writeFileSync("evals/pal/answer-key.json", JSON.stringify({ cases: answerKey }, null, 2));
console.log(`Regenerated ${Object.keys(answerKey).length} answer-key entries.`);
