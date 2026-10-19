import { readFileSync } from "node:fs";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { PubPalMemoryKind } from "@/lib/palMemoryKinds.mjs";

/**
 * A FACT THE PAL PROPOSES IS SORTED AGAINST WHAT THE PERSON ALREADY CONFIRMED.
 *
 * `__tests__/fixtures/palMemoryRelations.json` holds the cases. The pure half
 * (`lib/palMemoryRelation.ts`) must find the memory each case acts on and
 * settle exact duplicates with no model call. The judged half
 * (`lib/palMemoryRelation.server.ts`) runs with TypeSafe mocked: a judge that
 * answers each case's expected relation, and every way the judge can fail,
 * which must leave an ordinary ADD card. The last block drives the real
 * propose_memory webhook and the person's own confirm through the memories
 * routes, and holds the acceptance line: no case leaves two confirmed
 * memories about the same thing.
 */

type FixtureMemory = { id: string; kind: PubPalMemoryKind; value: string };
type FixtureCase = {
  id: string;
  existing: FixtureMemory[];
  newFact: { kind: PubPalMemoryKind; value: string };
  expected: "add" | "update" | "delete" | "noop";
  target?: string;
  exact?: boolean;
  noCandidates?: boolean;
};

const { cases } = JSON.parse(
  readFileSync(join(process.cwd(), "__tests__/fixtures/palMemoryRelations.json"), "utf8"),
) as { cases: FixtureCase[] };

const judge = vi.hoisted(() => ({
  /** The value of the memory the judge should relate, and how. Null answers ADD everywhere. */
  expect: null as null | { value: string; relation: string },
  outcome: null as null | { status: "skipped"; reason: "no_key" | "budget" } | { status: "failed"; reason: "timeout" | "error" },
  answers: null as unknown,
  calls: 0,
}));

vi.mock("@/lib/ai/typesafe.server", () => ({
  systemOneOutcome: vi.fn(async (state: Record<string, { value: string }>, questions: Record<string, unknown>) => {
    judge.calls += 1;
    if (judge.outcome) return judge.outcome;
    if (judge.answers !== null) return { status: "ok", result: { answers: judge.answers } };
    const answers: Record<string, unknown> = {};
    for (const [index] of Object.keys(questions).entries()) {
      const memory = state[`memory${index}`];
      const relation = judge.expect && memory?.value === judge.expect.value ? judge.expect.relation : "add";
      answers[`relation${index}`] = { choice: relation, confidence: 0.92, probabilities: { [relation]: 0.94 } };
    }
    return { status: "ok", result: { answers } };
  }),
}));

vi.mock("@/lib/pintDrops", () => ({ isLimited: vi.fn(async () => false) }));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

vi.mock("@/lib/authServer", () => ({
  callerUserId: async (request: Request) =>
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
}));

import { POST as CONFIRM_MEMORY } from "@/app/api/pub-pal/memories/route";
import { DELETE as DELETE_MEMORY, PATCH as PATCH_MEMORY } from "@/app/api/pub-pal/memories/[memoryId]/route";
import { POST as TOOL } from "@/app/api/pub-pal/tools/[toolName]/route";
import type { AskProposal } from "@/lib/ask/types";
import { confirmPalMemoryProposal } from "@/lib/palMemoryConfirmClient";
import {
  decidePalMemoryRelation,
  findExactPalMemory,
  findPalMemoryCandidates,
  parsePalMemoryRelationAnswers,
  PAL_MEMORY_RELATION_FLOOR,
} from "@/lib/palMemoryRelation";
import { classifyPalMemoryRelation } from "@/lib/palMemoryRelation.server";
import { DEFAULT_PAL_DRAFT, type PubPalMemory } from "@/lib/pubPal";
import {
  __resetPubPalStore,
  confirmPalMemoryResult,
  createPubPalResult,
  listPalMemoriesResult,
  updatePubPalResult,
} from "@/lib/pubPalStore";
import {
  __resetPubPalToolTurnStore,
  readPubPalToolTurn,
  registerPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

const OWNER = "11111111-1111-4111-8111-111111111111";
const CONVERSATION = "conv_relationtest01";

function asMemories(existing: FixtureMemory[]): PubPalMemory[] {
  return existing.map((memory) => ({
    ...memory,
    palId: "pal-1",
    provenance: "user_confirmed",
    createdAt: "2026-10-01T20:00:00.000Z",
    updatedAt: "2026-10-01T20:00:00.000Z",
  }));
}

function targetOf(testCase: FixtureCase): FixtureMemory {
  const target = testCase.existing.find((memory) => memory.id === testCase.target);
  if (!target) throw new Error(`${testCase.id} names no target`);
  return target;
}

beforeEach(() => {
  judge.expect = null;
  judge.outcome = null;
  judge.answers = null;
  judge.calls = 0;
});

describe("the fixture set", () => {
  it("covers every relation with at least twenty cases", () => {
    expect(cases.length).toBeGreaterThanOrEqual(20);
    for (const relation of ["add", "update", "delete", "noop"]) {
      expect(cases.some((testCase) => testCase.expected === relation), relation).toBe(true);
    }
  });
});

describe("finding the memories a new fact is about", () => {
  it.each(cases.filter((testCase) => testCase.target))("$id: the memory it acts on is a candidate", (testCase) => {
    const candidates = findPalMemoryCandidates(testCase.newFact, testCase.existing);
    expect(candidates.map((memory) => memory.id)).toContain(testCase.target);
  });

  it.each(cases.filter((testCase) => testCase.noCandidates))("$id: nothing to judge", (testCase) => {
    expect(findPalMemoryCandidates(testCase.newFact, testCase.existing)).toEqual([]);
  });

  it("does not match two memories on a feeling word alone", () => {
    const loved = [{ id: "m1", kind: "atmosphere_preference" as const, value: "Loves quiet pubs" }];
    expect(findPalMemoryCandidates({ kind: "drink_preference", value: "Loves lager" }, loved)).toEqual([]);
  });

  it("settles exact duplicates and nothing else", () => {
    for (const testCase of cases) {
      const exact = findExactPalMemory(testCase.newFact, testCase.existing);
      expect(exact?.id ?? null, testCase.id).toBe(testCase.exact ? testCase.target : null);
    }
  });
});

describe("one decision from the judgments", () => {
  const judged = (relation: "add" | "update" | "delete" | "noop", probability = 0.9, confidence = 0.9, memoryId = "m1") => ({
    memoryId,
    relation,
    probability,
    confidence,
  });

  it("keeps an add when no judgment clears the floor", () => {
    const under = PAL_MEMORY_RELATION_FLOOR - 0.01;
    expect(decidePalMemoryRelation([judged("update", under)])).toEqual({ relation: "add" });
    expect(decidePalMemoryRelation([judged("delete", 0.95, under)])).toEqual({ relation: "add" });
    expect(decidePalMemoryRelation([])).toEqual({ relation: "add" });
  });

  it("prefers a noop, then an update, then a delete, then the most probable", () => {
    expect(decidePalMemoryRelation([judged("update", 0.99, 0.9, "m1"), judged("noop", 0.85, 0.9, "m2")])).toEqual({
      relation: "noop",
      memoryId: "m2",
    });
    expect(decidePalMemoryRelation([judged("delete", 0.99, 0.9, "m1"), judged("update", 0.85, 0.9, "m2")])).toEqual({
      relation: "update",
      memoryId: "m2",
    });
    expect(decidePalMemoryRelation([judged("update", 0.85, 0.9, "m1"), judged("update", 0.95, 0.9, "m2")])).toEqual({
      relation: "update",
      memoryId: "m2",
    });
  });

  it("refuses answers that are not real probabilities or not a relation", () => {
    const candidates = [{ id: "m1" }];
    const answer = (value: unknown) => parsePalMemoryRelationAnswers({ relation0: value }, candidates);
    expect(answer({ choice: "update", confidence: 0.9, probabilities: { update: 0.9 } })).toEqual([judged("update")]);
    expect(answer({ choice: "update", confidence: "0.9", probabilities: { update: 0.9 } })).toBeNull();
    expect(answer({ choice: "update", confidence: 0.9, probabilities: { update: 95 } })).toBeNull();
    expect(answer({ choice: "merge", confidence: 0.9, probabilities: { merge: 0.9 } })).toBeNull();
    expect(parsePalMemoryRelationAnswers({}, candidates)).toBeNull();
  });
});

describe("the judged relation, with TypeSafe mocked", () => {
  it.each(cases)("$id: $expected", async (testCase) => {
    if (testCase.target) judge.expect = { value: targetOf(testCase).value, relation: testCase.expected };
    const decision = await classifyPalMemoryRelation(testCase.newFact, asMemories(testCase.existing));

    expect(decision.relation).toBe(testCase.expected);
    if (testCase.target) expect(decision.memory?.id).toBe(testCase.target);
    if (testCase.exact || testCase.noCandidates) expect(judge.calls).toBe(0);
  });

  const contradiction = cases.find((testCase) => testCase.id === "contradiction-lager")!;
  const fallbacks = [
    { name: "no key", outcome: { status: "skipped", reason: "no_key" } as const },
    { name: "spent budget", outcome: { status: "skipped", reason: "budget" } as const },
    { name: "timeout", outcome: { status: "failed", reason: "timeout" } as const },
    { name: "error", outcome: { status: "failed", reason: "error" } as const },
  ];

  it.each(fallbacks)("falls back to an ordinary add on $name", async ({ outcome }) => {
    judge.outcome = outcome;
    const decision = await classifyPalMemoryRelation(contradiction.newFact, asMemories(contradiction.existing));
    expect(decision).toEqual({ relation: "add" });
    expect(judge.calls).toBe(1);
  });

  it("falls back to an ordinary add on a malformed answer", async () => {
    judge.answers = { relation0: { choice: "update", confidence: 0.9 } };
    expect(await classifyPalMemoryRelation(contradiction.newFact, asMemories(contradiction.existing))).toEqual({
      relation: "add",
    });
  });

  it("falls back to an ordinary add when the judge is unsure", async () => {
    judge.answers = { relation0: { choice: "update", confidence: 0.6, probabilities: { update: 0.62 } } };
    expect(await classifyPalMemoryRelation(contradiction.newFact, asMemories(contradiction.existing))).toEqual({
      relation: "add",
    });
  });
});

describe("propose, then the person confirms: no case leaves two memories about one thing", () => {
  beforeEach(async () => {
    vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "test-llm-secret");
    __resetPubPalStore();
    __resetPubPalToolTurnStore();
    expect((await createPubPalResult(OWNER, { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Morrow" })).ok).toBe(true);
    expect((await updatePubPalResult(OWNER, { proposalPreferences: { memories: true } })).ok).toBe(true);
    await registerPubPalToolTurn(CONVERSATION, { query: "a quiet pub tonight", cityId: "london", ownerId: OWNER });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** The browser's fetch, answered by the real memory routes. */
  const routes: typeof fetch = async (input, init) => {
    const url = new URL(String(input), "http://localhost");
    const request = new Request(url, init);
    const memoryId = url.pathname.match(/^\/api\/pub-pal\/memories\/([^/]+)$/)?.[1];
    if (!memoryId) return CONFIRM_MEMORY(request);
    const context = { params: Promise.resolve({ memoryId: decodeURIComponent(memoryId) }) };
    return request.method === "DELETE" ? DELETE_MEMORY(request, context) : PATCH_MEMORY(request, context);
  };

  async function propose(fact: { kind: string; value: string }): Promise<{ hint: string; cards: AskProposal[] }> {
    const response = await TOOL(
      new Request("http://localhost/api/pub-pal/tools/propose_memory", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-llm-secret" },
        body: JSON.stringify({ conversation_id: CONVERSATION, parameters: fact }),
      }),
      { params: Promise.resolve({ toolName: "propose_memory" }) },
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { result: { ok: boolean; answerHint: string } };
    expect(body.result.ok).toBe(true);
    return { hint: body.result.answerHint, cards: (await readPubPalToolTurn(CONVERSATION))?.proposals ?? [] };
  }

  async function confirmed(): Promise<PubPalMemory[]> {
    const listed = await listPalMemoriesResult(OWNER);
    if (!listed.ok) throw new Error("memory store unavailable");
    return listed.value;
  }

  /** The person's Confirm tap, with the fields PalChat passes from the card. */
  function confirmCard(card: Extract<AskProposal, { kind: "remember_memory" }>) {
    return confirmPalMemoryProposal(
      {
        id: card.id,
        memoryKind: card.memoryKind,
        value: card.value,
        relation: card.relation,
        supersedesMemoryId: card.supersedesMemoryId,
        supersedesValue: card.supersedesValue,
      },
      { userId: OWNER, accessToken: OWNER },
      routes,
    );
  }

  async function proposeCard(fact: { kind: string; value: string }) {
    const card = (await propose(fact)).cards.at(-1);
    if (card?.kind !== "remember_memory" || !card.supersedesMemoryId) throw new Error("expected a replacement card");
    return card;
  }

  it.each(cases)("$id", async (testCase) => {
    const realIds = new Map<string, string>();
    for (const memory of [...testCase.existing].reverse()) {
      const saved = await confirmPalMemoryResult(OWNER, { kind: memory.kind, value: memory.value });
      if (!saved.ok) throw new Error("seed failed");
      realIds.set(memory.id, saved.value.id);
    }
    if (testCase.target) judge.expect = { value: targetOf(testCase).value, relation: testCase.expected };

    const { hint, cards } = await propose(testCase.newFact);
    // Nothing changes before the person taps Confirm.
    expect((await confirmed()).length).toBe(testCase.existing.length);

    if (testCase.expected === "noop") {
      expect(cards).toEqual([]);
      expect(hint).toContain(targetOf(testCase).value);
      return;
    }
    const [card] = cards;
    if (card?.kind !== "remember_memory") throw new Error("expected a memory card");
    expect(card.relation).toBe(testCase.expected === "add" ? undefined : testCase.expected);
    if (testCase.target) expect(card.supersedesMemoryId).toBe(realIds.get(testCase.target));

    const outcome = await confirmCard(card);
    expect(outcome).toEqual({ ok: true });

    const after = await confirmed();
    const values = after.map((memory) => memory.value);
    if (testCase.expected === "add") {
      expect(after.length).toBe(testCase.existing.length + 1);
      expect(values).toContain(testCase.newFact.value);
      return;
    }
    const target = targetOf(testCase);
    expect(values).not.toContain(target.value);
    if (testCase.expected === "update") {
      expect(after.length).toBe(testCase.existing.length);
      const replaced = after.find((memory) => memory.id === realIds.get(target.id));
      expect(replaced?.value).toBe(testCase.newFact.value);
      // The new fact's kind wins, except a bare correction, which keeps the subject it corrects.
      expect(replaced?.kind).toBe(testCase.newFact.kind === "correction" ? target.kind : testCase.newFact.kind);
    } else {
      expect(after.length).toBe(testCase.existing.length - 1);
    }
  });

  it("keeps the new fact when the memory an update card replaces was deleted first", async () => {
    const seeded = await confirmPalMemoryResult(OWNER, { kind: "drink_preference", value: "Loves lager" });
    if (!seeded.ok) throw new Error("seed failed");
    judge.expect = { value: "Loves lager", relation: "update" };
    const { cards } = await propose({ kind: "drink_preference", value: "Has gone off lager" });
    const [card] = cards;
    if (card?.kind !== "remember_memory" || !card.supersedesMemoryId) throw new Error("expected an update card");

    await DELETE_MEMORY(
      new Request(`http://localhost/api/pub-pal/memories/${card.supersedesMemoryId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${OWNER}` },
      }),
      { params: Promise.resolve({ memoryId: card.supersedesMemoryId }) },
    );
    const outcome = await confirmCard(card);

    expect(outcome).toEqual({ ok: true });
    expect((await confirmed()).map((memory) => memory.value)).toEqual(["Has gone off lager"]);
  });

  it("refuses a second update card once the first has replaced the memory", async () => {
    const seeded = await confirmPalMemoryResult(OWNER, { kind: "drink_preference", value: "Loves lager" });
    if (!seeded.ok) throw new Error("seed failed");
    judge.expect = { value: "Loves lager", relation: "update" };
    const first = await proposeCard({ kind: "drink_preference", value: "Has gone off lager" });
    const second = await proposeCard({ kind: "drink_preference", value: "Drinks only stout now" });

    expect(await confirmCard(first)).toEqual({ ok: true });
    const stale = await confirmCard(second);

    expect(stale).toEqual({ ok: false, error: expect.stringContaining("changed since this card was made") });
    expect((await confirmed()).map((memory) => memory.value)).toEqual(["Has gone off lager"]);
  });

  it("refuses a forget card once the person has edited the memory", async () => {
    const seeded = await confirmPalMemoryResult(OWNER, { kind: "accessibility_preference", value: "Needs step-free access" });
    if (!seeded.ok) throw new Error("seed failed");
    judge.expect = { value: "Needs step-free access", relation: "delete" };
    const card = await proposeCard({ kind: "accessibility_preference", value: "No longer needs step-free access" });
    expect(card.relation).toBe("delete");

    const edited = await PATCH_MEMORY(
      new Request(`http://localhost/api/pub-pal/memories/${card.supersedesMemoryId}`, {
        method: "PATCH",
        headers: { authorization: `Bearer ${OWNER}`, "content-type": "application/json" },
        body: JSON.stringify({ value: "Needs step-free access and a lift" }),
      }),
      { params: Promise.resolve({ memoryId: card.supersedesMemoryId as string }) },
    );
    expect(edited.status).toBe(200);

    expect(await confirmCard(card)).toEqual({ ok: false, error: expect.stringContaining("changed since this card was made") });
    expect((await confirmed()).map((memory) => memory.value)).toEqual(["Needs step-free access and a lift"]);
  });

  it("still deletes from the Pal page, which names no expected value", async () => {
    const seeded = await confirmPalMemoryResult(OWNER, { kind: "drink_preference", value: "Loves lager" });
    if (!seeded.ok) throw new Error("seed failed");
    const response = await DELETE_MEMORY(
      new Request(`http://localhost/api/pub-pal/memories/${seeded.value.id}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${OWNER}` },
      }),
      { params: Promise.resolve({ memoryId: seeded.value.id }) },
    );
    expect(response.status).toBe(200);
    expect(await confirmed()).toEqual([]);
  });
});
