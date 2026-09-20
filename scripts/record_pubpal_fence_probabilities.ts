/**
 * Record TypeSafe Noul probabilities for Pub Pal fence fixtures.
 * Requires TYPESAFE_API_KEY in the environment.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TypeSafeClient } from "@typesafe-ai/sdk";

import {
  PUB_PAL_FENCE_QUESTIONS,
  PUB_PAL_FENCE_QUESTION_IDS,
} from "@/lib/pubPalLlmFenceQuestions";

const ROOT = process.cwd();
const CASES_PATH = join(ROOT, "__tests__/fixtures/typesafe/pubPalFenceCases.json");
const OUT_PATH = join(ROOT, "__tests__/fixtures/typesafe/pubPalFenceProbabilities.json");

type CaseRow = {
  id: string;
  message: string;
  recentTurns: Array<{ role: "user" | "assistant"; content: string }>;
  expectFenced: boolean;
  expectSobrietyOnly: boolean;
};

async function main(): Promise<void> {
const cases = (JSON.parse(readFileSync(CASES_PATH, "utf8")) as { cases: CaseRow[] }).cases;

const client = new TypeSafeClient({ logLevel: "off" });

const recorded: Array<{
  id: string;
  message: string;
  recentTurns: CaseRow["recentTurns"];
  expectFenced: boolean;
  expectSobrietyOnly: boolean;
  fitToTravelAfterDrinking: number;
  getHomeTonight: number;
}> = [];

let model = "";

for (const caseRow of cases) {
  const state = {
    message: caseRow.message,
    recentTurns: caseRow.recentTurns ?? [],
  };
  const response = await client.systemOne(
    { state, questions: PUB_PAL_FENCE_QUESTIONS },
    { timeout: 10_000 },
  );
  model = response.model;
  recorded.push({
    id: caseRow.id,
    message: caseRow.message,
    recentTurns: caseRow.recentTurns ?? [],
    expectFenced: caseRow.expectFenced,
    expectSobrietyOnly: caseRow.expectSobrietyOnly,
    fitToTravelAfterDrinking:
      response.answers[PUB_PAL_FENCE_QUESTION_IDS.fitToTravelAfterDrinking].noul,
    getHomeTonight: response.answers[PUB_PAL_FENCE_QUESTION_IDS.getHomeTonight].noul,
  });
  process.stderr.write(`recorded ${caseRow.id}\n`);
}

writeFileSync(
  OUT_PATH,
  `${JSON.stringify({ recordedAt: new Date().toISOString(), model, cases: recorded }, null, 2)}\n`,
);
process.stderr.write(`wrote ${OUT_PATH}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
