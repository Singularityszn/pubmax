import { readFileSync } from "node:fs";
import { join } from "node:path";

import palCases from "@/evals/pal/cases.public.json";
import palAnswerKey from "@/evals/pal/answer-key.json";

export type AskRouterModelEvalCase = {
  id: string;
  query: string;
  /** Primary expected tool (deterministic router gold or Pal answer-key routing). */
  expectedTool: string;
  /** When set, any of these tools counts as correct (Pal cases with alternates). */
  expectedTools?: string[];
  source: "ask-router-fixture" | "pal-routing";
};

type RouterFixtureRow = {
  id: string;
  query: string;
  regexTool: string;
  gold?: boolean;
};

type PalCaseRow = { id: string; query: string };
type PalAnswerRow = { expectedTools?: string[] };

export function loadAskRouterModelEvalCases(root = process.cwd()): AskRouterModelEvalCase[] {
  const routerPath = join(root, "__tests__/fixtures/typesafe/ask-router-cases.json");
  const router = JSON.parse(readFileSync(routerPath, "utf8")) as {
    cases: RouterFixtureRow[];
  };
  const byQuery = new Map<string, AskRouterModelEvalCase>();

  for (const row of router.cases) {
    if (!row.gold) continue;
    byQuery.set(row.query, {
      id: row.id,
      query: row.query,
      expectedTool: row.regexTool,
      source: "ask-router-fixture",
    });
  }

  const pal = palCases as { cases: PalCaseRow[] };
  const answerKey = palAnswerKey as { cases: Record<string, PalAnswerRow> };

  for (const row of pal.cases) {
    const expect = answerKey.cases[row.id];
    const tools = expect?.expectedTools?.filter(Boolean) ?? [];
    if (tools.length === 0) continue;
    if (byQuery.has(row.query)) continue;
    byQuery.set(row.query, {
      id: `pal-${row.id}`,
      query: row.query,
      expectedTool: tools[0]!,
      expectedTools: tools,
      source: "pal-routing",
    });
  }

  return [...byQuery.values()].sort((a, b) => a.id.localeCompare(b.id));
}
