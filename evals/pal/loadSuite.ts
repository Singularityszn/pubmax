import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { PalEvalAnswerExpectations, PalEvalPublicCase } from "./types";

export type PalEvalSuite = {
  cases: PalEvalPublicCase[];
  answerKey: Record<string, PalEvalAnswerExpectations>;
  now: number;
};

export function loadPalEvalSuite(root = process.cwd()): PalEvalSuite {
  const base = join(root, "evals/pal");
  const cases = JSON.parse(readFileSync(join(base, "cases.public.json"), "utf8")) as {
    cases: PalEvalPublicCase[];
  };
  const answerKey = JSON.parse(readFileSync(join(base, "answer-key.json"), "utf8")) as {
    now?: string;
    cases: Record<string, PalEvalAnswerExpectations>;
  };
  const now = Date.parse(answerKey.now ?? "");
  if (!Number.isFinite(now)) {
    throw new Error("answer-key.json needs an ISO `now`: the instant every case is asked at.");
  }
  return { cases: cases.cases, answerKey: answerKey.cases, now };
}
