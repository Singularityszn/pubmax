import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PalEvalAnswerExpectations, PalEvalPublicCase } from "./types";

export type PalEvalSuite = {
  cases: PalEvalPublicCase[];
  answerKey: Record<string, PalEvalAnswerExpectations>;
};

export function loadPalEvalSuite(root = process.cwd()): PalEvalSuite {
  const base = join(root, "evals/pal");
  const cases = JSON.parse(readFileSync(join(base, "cases.public.json"), "utf8")) as {
    cases: PalEvalPublicCase[];
  };
  const answerKey = JSON.parse(readFileSync(join(base, "answer-key.json"), "utf8")) as {
    cases: Record<string, PalEvalAnswerExpectations>;
  };
  return { cases: cases.cases, answerKey: answerKey.cases };
}
