import "server-only";

import { systemOneOutcome } from "@/lib/ai/typesafe.server";
import { log } from "@/lib/log";
import {
  decidePalMemoryRelation,
  findExactPalMemory,
  findPalMemoryCandidates,
  parsePalMemoryRelationAnswers,
  type PalMemoryDecision,
  type PalMemoryFact,
} from "@/lib/palMemoryRelation";
import { buildPalMemoryRelationQuestions } from "@/lib/palMemoryRelationQuestions";
import type { PubPalMemory } from "@/lib/pubPal";

const RELATION_TIMEOUT_MS = 4_000;

/** Why a proposal stayed an ordinary ADD card, for the log line. */
type AddReason = "no_candidates" | "no_key" | "budget" | "timeout" | "error" | "malformed-answer" | "judged";

export type PalMemoryRelationResult = PalMemoryDecision & { memory?: PubPalMemory };

/**
 * Sort a proposed fact against the person's confirmed memories. An exact
 * duplicate is a NOOP with no model call. Otherwise one TypeSafe System One
 * request carries one Choice per candidate that shares a subject with it.
 * No key, a spent budget, a timeout or a malformed answer is an ADD, so the
 * person sees the ordinary card and decides. Never throws.
 */
export async function classifyPalMemoryRelation(
  fact: PalMemoryFact,
  approved: readonly PubPalMemory[],
): Promise<PalMemoryRelationResult> {
  const exact = findExactPalMemory(fact, approved);
  if (exact) return { relation: "noop", memoryId: exact.id, memory: exact };

  const candidates = findPalMemoryCandidates(fact, approved);
  const add = (reason: AddReason): PalMemoryRelationResult => {
    log("info", "pal.memory_relation", { relation: "add", reason, candidates: candidates.length });
    return { relation: "add" };
  };
  if (candidates.length === 0) return add("no_candidates");

  const state: Record<string, { kind: string; value: string }> = { newFact: { kind: fact.kind, value: fact.value } };
  for (const [index, memory] of candidates.entries()) state[`memory${index}`] = { kind: memory.kind, value: memory.value };

  const outcome = await systemOneOutcome(state, buildPalMemoryRelationQuestions(candidates.length), {
    lane: "typesafe",
    timeoutMs: RELATION_TIMEOUT_MS,
  });
  if (outcome.status !== "ok") return add(outcome.reason);

  const judgments = parsePalMemoryRelationAnswers(outcome.result.answers, candidates);
  if (!judgments) return add("malformed-answer");
  const decision = decidePalMemoryRelation(judgments);
  if (decision.relation === "add") return add("judged");
  log("info", "pal.memory_relation", { relation: decision.relation, candidates: candidates.length });
  return { ...decision, memory: candidates.find((memory) => memory.id === decision.memoryId) };
}
