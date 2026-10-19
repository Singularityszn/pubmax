// How a fact the Pal wants to remember relates to what the person already
// confirmed, the way mem0 sorts a new fact against the facts near it: ADD it
// beside them, UPDATE one of them, DELETE one of them, or NOOP because it is
// already known. Without this, "I've gone off lager" sits next to a confirmed
// "loves lager" and the Pal carries both.
//
// The decision only chooses which card the person sees. An update or a delete
// still changes nothing until the person confirms the card, and anything this
// module is unsure of is an ordinary ADD card.
//
// Pure leaf: no I/O. The judged half is `lib/palMemoryRelation.server.ts`.

import type { PubPalMemoryKind } from "@/lib/palMemoryKinds.mjs";
import { palMemoryStems } from "@/lib/palMemoryRelevance";

const PAL_MEMORY_RELATIONS = ["add", "update", "delete", "noop"] as const;

type PalMemoryRelation = (typeof PAL_MEMORY_RELATIONS)[number];

type RelatableMemory = { id: string; kind: PubPalMemoryKind; value: string };

export type PalMemoryFact = { kind: PubPalMemoryKind; value: string };

/** The most confirmed memories one proposal is judged against. */
const PAL_MEMORY_CANDIDATE_LIMIT = 5;

/**
 * Floor on a judged relation's probability AND confidence before it may turn an
 * ADD card into an update, delete or no card. Provisional: no calibration run
 * covers this question yet, so it sits high and every miss falls back to ADD.
 */
export const PAL_MEMORY_RELATION_FLOOR = 0.8;

// Words that carry how someone feels, not what about. "Loves lager" and
// "loves quiet pubs" share "love" and nothing else.
const FEELING_STEMS = new Set([
  "love", "hate", "enjo", "pref", "fanc", "gone", "off", "real", "alwa", "neve",
  "more", "less", "much", "favo", "drin", "usua", "mind", "dont", "cant", "stan",
]);

function subjectStems(text: string): Set<string> {
  const out = new Set<string>();
  for (const stem of palMemoryStems(text.replace(/['’]/g, ""))) if (!FEELING_STEMS.has(stem)) out.add(stem);
  return out;
}

function normalised(text: string): string {
  return text.toLocaleLowerCase("en-GB").replace(/[^a-z0-9£]+/g, " ").trim();
}

/**
 * The confirmed memories that share a subject with the new fact: any shared
 * subject word, or the same kind. Shared words count most. At most
 * PAL_MEMORY_CANDIDATE_LIMIT, best first.
 */
export function findPalMemoryCandidates<T extends RelatableMemory>(fact: PalMemoryFact, approved: readonly T[]): T[] {
  const factStems = subjectStems(fact.value);
  return approved
    .map((memory, position) => {
      let shared = 0;
      for (const stem of subjectStems(memory.value)) if (factStems.has(stem)) shared += 1;
      return { memory, position, score: 3 * shared + (memory.kind === fact.kind ? 1 : 0) };
    })
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .slice(0, PAL_MEMORY_CANDIDATE_LIMIT)
    .map((entry) => entry.memory);
}

/** A confirmed memory of the same kind with the same words: known already, with no model call. */
export function findExactPalMemory<T extends RelatableMemory>(fact: PalMemoryFact, approved: readonly T[]): T | null {
  const value = normalised(fact.value);
  return approved.find((memory) => memory.kind === fact.kind && normalised(memory.value) === value) ?? null;
}

export type PalMemoryJudgment = {
  memoryId: string;
  relation: PalMemoryRelation;
  probability: number;
  confidence: number;
};

export type PalMemoryDecision =
  | { relation: "add" }
  | { relation: "update" | "delete" | "noop"; memoryId: string };

const PRECEDENCE: Record<Exclude<PalMemoryRelation, "add">, number> = { noop: 0, update: 1, delete: 2 };

/**
 * One decision from the per-memory judgments. Only a judgment that clears the
 * floor counts. A NOOP wins (nothing new to say), then an UPDATE, then a
 * DELETE, and the most probable wins within one relation. Otherwise ADD.
 */
export function decidePalMemoryRelation(
  judgments: readonly PalMemoryJudgment[],
  floor = PAL_MEMORY_RELATION_FLOOR,
): PalMemoryDecision {
  const counted = judgments
    .filter((judgment) => judgment.relation !== "add")
    .filter((judgment) => judgment.probability >= floor && judgment.confidence >= floor)
    .sort(
      (a, b) =>
        PRECEDENCE[a.relation as Exclude<PalMemoryRelation, "add">] -
          PRECEDENCE[b.relation as Exclude<PalMemoryRelation, "add">] || b.probability - a.probability,
    );
  const winner = counted[0];
  if (!winner || winner.relation === "add") return { relation: "add" };
  return { relation: winner.relation, memoryId: winner.memoryId };
}

function isProbability(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isRelation(value: unknown): value is PalMemoryRelation {
  return typeof value === "string" && (PAL_MEMORY_RELATIONS as readonly string[]).includes(value);
}

/** The System One question id for the candidate at `index`. */
export function palMemoryRelationQuestionId(index: number): string {
  return `relation${index}`;
}

/**
 * Typed judgments out of a System One answer map, one per candidate, or null
 * when any answer is malformed. `"0.95"`, `95` and `true` are not probabilities.
 */
export function parsePalMemoryRelationAnswers(
  answers: unknown,
  candidates: readonly { id: string }[],
): PalMemoryJudgment[] | null {
  if (!answers || typeof answers !== "object" || Array.isArray(answers)) return null;
  const record = answers as Record<string, unknown>;
  const judgments: PalMemoryJudgment[] = [];
  for (const [index, candidate] of candidates.entries()) {
    const answer = record[palMemoryRelationQuestionId(index)];
    if (!answer || typeof answer !== "object" || Array.isArray(answer)) return null;
    const { choice, confidence, probabilities } = answer as Record<string, unknown>;
    if (!isRelation(choice) || !isProbability(confidence)) return null;
    if (!probabilities || typeof probabilities !== "object" || Array.isArray(probabilities)) return null;
    const probability = (probabilities as Record<string, unknown>)[choice];
    if (!isProbability(probability)) return null;
    judgments.push({ memoryId: candidate.id, relation: choice, probability, confidence });
  }
  return judgments;
}
