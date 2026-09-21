/**
 * Record TypeSafe Choice/Noul probabilities for Ask-router fixtures.
 * Requires TYPESAFE_API_KEY in the environment.
 *
 *   ( set -a; . /path/to/keys.env; set +a; npx tsx scripts/record_ask_router_probabilities.ts )
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { TypeSafeClient } from "@typesafe-ai/sdk";

import { findAskAreaCandidates, findAskVenueCandidates } from "@/lib/ask/routerCandidates";
import { ASK_ROUTER_TOOL_FLOOR } from "@/lib/ask/routerPolicy";
import { buildAskRouterQuestions } from "@/lib/ask/routerQuestions";

const ROOT = process.cwd();
const CASES_PATH = join(ROOT, "__tests__/fixtures/typesafe/ask-router-cases.json");
const OUT_PATH = join(ROOT, "__tests__/fixtures/typesafe/ask-router-probabilities.json");

type Venue = { id: string; name: string; area: string };
type CaseRow = { id: string; query: string; regexTool: string; gold: boolean };

function isChoiceAnswer(
  answer: unknown,
): answer is { choice: string; confidence: number; probabilities: Record<string, number> } {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) return false;
  const record = answer as Record<string, unknown>;
  return (
    typeof record.choice === "string" &&
    typeof record.confidence === "number" &&
    !!record.probabilities &&
    typeof record.probabilities === "object"
  );
}

function readChoice(answer: unknown): { choice: string; probability: number; confidence: number } {
  if (!isChoiceAnswer(answer)) {
    throw new Error("expected a Choice answer");
  }
  return {
    choice: answer.choice,
    probability: answer.probabilities[answer.choice] ?? 0,
    confidence: answer.confidence,
  };
}

function readNoul(answer: unknown): number {
  if (!answer || typeof answer !== "object" || Array.isArray(answer)) {
    throw new Error("expected a Noul answer");
  }
  const noul = (answer as Record<string, unknown>).noul;
  if (typeof noul !== "number") throw new Error("expected a Noul answer");
  return noul;
}

async function main(): Promise<void> {
  const catalog = JSON.parse(readFileSync(CASES_PATH, "utf8")) as {
    venues: Venue[];
    cases: CaseRow[];
  };
  const client = new TypeSafeClient({ logLevel: "off", retry: { maxRetries: 0 } });
  const recorded: Array<
    CaseRow & {
      tool: string;
      toolProbability: number;
      toolConfidence: number;
      venue: string;
      venueProbability: number;
      venueConfidence: number;
      area: string;
      areaProbability: number;
      areaConfidence: number;
      wantsMap: number;
    }
  > = [];
  let model = "";

  for (const caseRow of catalog.cases) {
    const venues = findAskVenueCandidates(caseRow.query, { venues: catalog.venues });
    const areas = findAskAreaCandidates(caseRow.query);
    const response = await client.systemOne(
      {
        state: {
          query: caseRow.query,
          venues: venues.map((venue) => ({
            id: venue.id,
            name: venue.name,
            area: venue.area,
          })),
          areas: areas.map((area) => ({ id: area.id, name: area.name })),
        },
        questions: buildAskRouterQuestions(venues, areas),
      },
      { timeout: 10_000 },
    );
    model = response.model;
    const tool = readChoice(response.answers.tool);
    const venue = readChoice(response.answers.venue);
    const area = readChoice(response.answers.area);
    recorded.push({
      ...caseRow,
      tool: tool.choice,
      toolProbability: tool.probability,
      toolConfidence: tool.confidence,
      venue: venue.choice,
      venueProbability: venue.probability,
      venueConfidence: venue.confidence,
      area: area.choice,
      areaProbability: area.probability,
      areaConfidence: area.confidence,
      wantsMap: readNoul(response.answers.wantsMap),
    });
    process.stderr.write(`recorded ${caseRow.id} tool=${tool.choice} p=${tool.probability.toFixed(2)}\n`);
  }

  writeFileSync(
    OUT_PATH,
    `${JSON.stringify(
      {
        recordedAt: new Date().toISOString(),
        model,
        toolFloor: ASK_ROUTER_TOOL_FLOOR,
        cases: recorded,
      },
      null,
      2,
    )}\n`,
  );
  process.stderr.write(`wrote ${OUT_PATH}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
