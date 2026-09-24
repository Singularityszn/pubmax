import type { AskTurn } from "@/lib/ask/types";

export type PalEvalPublicCase = {
  id: string;
  query: string;
  cityId?: string;
  turns?: AskTurn[];
};

export type PalEvalAnswerExpectations = {
  expectedTools?: string[];
  anyTools?: string[];
  minCards?: number;
  expectEmpty?: boolean;
  expectDegraded?: boolean;
  answerIncludes?: string[];
  topVenueId?: string;
  topPrice?: number;
  priceTolerance?: number;
};

export type PalEvalUsage = {
  modelCalls: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  latencyMs: number;
  costUsd: number;
};

export type PalEvalCaseResult = {
  id: string;
  query: string;
  pass: boolean;
  checks: Array<{ name: string; pass: boolean; detail: string }>;
  inventedVenues: number;
  toolsUsed: string[];
  cardCount: number;
  answer: string;
  transcript: string;
  usage: PalEvalUsage;
};

export type PalEvalScoreboard = {
  runAt: string;
  mode: "deterministic" | "live";
  model?: string;
  totals: {
    cases: number;
    passed: number;
    accuracy: number;
    inventedVenues: number;
    modelCalls: number;
    costUsd: number;
    avgLatencyMs: number;
    avgCostPerCaseUsd: number;
  };
  results: PalEvalCaseResult[];
};
