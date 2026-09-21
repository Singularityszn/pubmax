/**
 * Record TypeSafe probabilities for concierge intent fixtures.
 * Requires TYPESAFE_API_KEY in the environment.
 *
 *   npx tsx scripts/record_concierge_intent_probabilities.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { systemOne, typesafeConfigured } from "@/lib/ai/typesafe";
import { conciergeIntentQuestions } from "@/lib/concierge/intentQuestions";
import {
  areaCandidatesInText,
  defaultKnownAreas,
  groupSizeCandidatesInText,
  moodQuestionId,
} from "@/lib/concierge/intentPolicy";
import { CONCIERGE_MOODS, type ConciergeMood } from "@/lib/concierge/rank";

const ROOT = process.cwd();
const CASES_PATH = join(ROOT, "__tests__/fixtures/typesafe/conciergeIntentCases.json");
const OUT_PATH = join(ROOT, "__tests__/fixtures/typesafe/conciergeIntentProbabilities.json");

type CaseRow = {
  id: string;
  text: string;
  expectMoods: ConciergeMood[];
  expectArea: string | null;
  expectGroupSize: number;
  expectBudget: "explicit figure" | "cheap" | "unstated";
  expectMaxPintPrice: number | null;
};

type RecordedCase = CaseRow & {
  moods: Record<ConciergeMood, number>;
  areaChoice: string | null;
  areaProbabilities: Record<string, number>;
  groupChoice: string | null;
  groupProbabilities: Record<string, number>;
  budgetChoice: string | null;
  budgetProbabilities: Record<string, number>;
};

function noulOf(answer: unknown): number {
  if (!answer || typeof answer !== "object" || !("noul" in answer)) return Number.NaN;
  const value = (answer as { noul: unknown }).noul;
  return typeof value === "number" ? value : Number.NaN;
}

function choiceOf(answer: unknown): { choice: string | null; probabilities: Record<string, number> } {
  if (!answer || typeof answer !== "object") return { choice: null, probabilities: {} };
  const record = answer as { choice?: unknown; probabilities?: unknown };
  const probabilities: Record<string, number> = {};
  if (record.probabilities && typeof record.probabilities === "object" && !Array.isArray(record.probabilities)) {
    for (const [key, value] of Object.entries(record.probabilities as Record<string, unknown>)) {
      if (typeof value === "number") probabilities[key] = value;
    }
  }
  return {
    choice: typeof record.choice === "string" ? record.choice : null,
    probabilities,
  };
}

async function main(): Promise<void> {
  if (!typesafeConfigured()) {
    process.stderr.write("A judged concierge-intent pass requires TYPESAFE_API_KEY.\n");
    process.exit(1);
  }

  const cases = (JSON.parse(readFileSync(CASES_PATH, "utf8")) as { cases: CaseRow[] }).cases;
  const knownAreas = defaultKnownAreas();
  const recorded: RecordedCase[] = [];
  let model = "";

  for (const caseRow of cases) {
    const areaCandidates = areaCandidatesInText(caseRow.text, knownAreas);
    const groupSizeCandidates = groupSizeCandidatesInText(caseRow.text);
    const response = await systemOne(
      { text: caseRow.text, knownAreas, moods: [...CONCIERGE_MOODS] },
      conciergeIntentQuestions({ areaCandidates, groupSizeCandidates }),
      { lane: "concierge-intent", timeoutMs: 8_000 },
    );
    if (!response) {
      process.stderr.write(`failed ${caseRow.id}\n`);
      process.exit(1);
    }
    model = response.model;
    const moods = {} as Record<ConciergeMood, number>;
    for (const mood of CONCIERGE_MOODS) {
      moods[mood] = noulOf(response.answers[moodQuestionId(mood)]);
    }
    const area = choiceOf(response.answers.area);
    const group = choiceOf(response.answers.groupSize);
    const budget = choiceOf(response.answers.budgetSignal);
    recorded.push({
      ...caseRow,
      moods,
      areaChoice: area.choice,
      areaProbabilities: area.probabilities,
      groupChoice: group.choice,
      groupProbabilities: group.probabilities,
      budgetChoice: budget.choice,
      budgetProbabilities: budget.probabilities,
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
