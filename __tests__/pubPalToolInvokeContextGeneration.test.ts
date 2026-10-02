import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
    requireSupabaseAdmin: () => {
      throw new Error("This invocation proof uses the real memory store only.");
    },
  };
});

// Keep the real regex safety fence, but never call a paid classifier.
vi.mock("@/lib/ai/typesafe.server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai/typesafe.server")>();
  return { ...actual, systemOne: vi.fn(async () => null) };
});

// Only the asynchronous handler is controlled; invocation, routing and store
// mutations remain real. Only fresh receipt setup captures an explicit origin;
// the pending invocation must capture its own before the handler barrier.
vi.mock("@/lib/ask/tools", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ask/tools")>();
  return { ...actual, runAskTool: vi.fn() };
});

import type { AskToolContext, AskToolResult } from "@/lib/ask/toolContract";
import { runAskTool } from "@/lib/ask/tools";
import { invokePubPalAskTool } from "@/lib/pubPalToolInvoke.server";
import {
  __resetPubPalToolTurnStore,
  appendOwnedPubPalUserTurn,
  appendPubPalToolTurn,
  bindPubPalToolTurn,
  hasStoredPubPalToolTurnForTest,
  PUB_PAL_TOOL_TURN_TTL_MS,
  purgeExpiredPubPalToolTurns,
  readPubPalToolInvocationTurn,
  readOwnedPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

const CONVERSATION_ID = "conv_invokecontext01";
const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const START = Date.parse("2026-10-02T12:00:00.000Z");
const OLD_QUERY = "Find quiet pubs near Soho";
const FRESH_QUERY = "Find food near Clapham";

const OLD_RESULT: AskToolResult = {
  ok: true,
  tool: "search_venues",
  data: null,
  provenance: [],
  cards: [{ key: "old-card", venueId: "old-pub", title: "Old Arms", place: "Soho", note: "Old request result.", price: null }],
  proposals: [{ id: "old-proposal", kind: "open_venue", label: "Open old pub", venueId: "old-pub" }],
  answerHint: "Old request hint.",
};

const FRESH_RESULT: AskToolResult = {
  ok: true,
  tool: "venue_drinks",
  data: null,
  provenance: [],
  cards: [{ key: "fresh-card", venueId: "fresh-pub", title: "Fresh Arms", place: "Clapham", note: "Fresh request result.", price: null }],
  proposals: [{ id: "fresh-proposal", kind: "open_venue", label: "Open fresh pub", venueId: "fresh-pub" }],
  answerHint: "Fresh request hint.",
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function holdHandler() {
  const entered = deferred<AskToolContext>();
  const release = deferred<void>();
  vi.mocked(runAskTool).mockImplementationOnce(async (_name, _args, context) => {
    entered.resolve(context);
    await release.promise;
    return structuredClone(OLD_RESULT);
  });
  return { entered: entered.promise, release: () => release.resolve() };
}

async function bindUserLine(content: string) {
  await bindPubPalToolTurn(CONVERSATION_ID, OWNER_ID, "london");
  expect(await appendOwnedPubPalUserTurn(
    CONVERSATION_ID, OWNER_ID, { role: "user", content }, "london",
  )).toBe(true);
}

async function seedFreshReceipt() {
  const invocation = await readPubPalToolInvocationTurn(CONVERSATION_ID);
  if (!invocation) throw new Error("Fresh receipt requires its live owned context.");
  await appendPubPalToolTurn(CONVERSATION_ID, {
    cards: FRESH_RESULT.cards,
    proposals: FRESH_RESULT.proposals,
    hints: [FRESH_RESULT.answerHint],
    toolsUsed: [FRESH_RESULT.tool],
  }, invocation.origin);
}

describe("Pub Pal invocation context generation (real memory store)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(START);
    __resetPubPalToolTurnStore();
    vi.mocked(runAskTool).mockReset();
  });

  afterEach(() => {
    __resetPubPalToolTurnStore();
    vi.useRealTimers();
  });

  it("does not attach an old context's delayed result to a fresh same-owner context", async () => {
    await bindUserLine(OLD_QUERY);
    vi.setSystemTime(START + 119_000);
    const held = holdHandler();
    const pending = invokePubPalAskTool({
      toolName: "search_venues", args: { query: "Soho" }, conversationId: CONVERSATION_ID,
    });
    const captured = await Promise.race([
      held.entered,
      pending.then(() => { throw new Error("Invocation completed before entering the handler."); }),
    ]);
    expect(captured).toMatchObject({ query: OLD_QUERY, cityId: "london", skipModel: true });

    // Controlled same-CID reset, not a claim that a provider reuses its IDs.
    vi.setSystemTime(START + 125_000);
    await purgeExpiredPubPalToolTurns();
    expect(hasStoredPubPalToolTurnForTest(CONVERSATION_ID)).toBe(false);
    await bindUserLine(FRESH_QUERY);
    await seedFreshReceipt();
    const freshBefore = structuredClone(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID));
    expect(freshBefore).toMatchObject({
      query: FRESH_QUERY,
      turns: [{ role: "user", content: FRESH_QUERY }],
      expiresAt: START + 125_000 + PUB_PAL_TOOL_TURN_TTL_MS,
      cards: FRESH_RESULT.cards, proposals: FRESH_RESULT.proposals,
      hints: [FRESH_RESULT.answerHint], toolsUsed: [FRESH_RESULT.tool],
    });

    held.release();
    await pending;
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toEqual(freshBefore);
  });

  it("does not attach a pending result when no context existed at invocation entry", async () => {
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toBeNull();
    const held = holdHandler();
    const pending = invokePubPalAskTool({
      toolName: "search_venues", args: { query: OLD_QUERY }, conversationId: CONVERSATION_ID,
    });
    const captured = await Promise.race([
      held.entered,
      pending.then(() => { throw new Error("Invocation completed before entering the handler."); }),
    ]);
    expect(captured.query).toBe(OLD_QUERY);

    vi.setSystemTime(START + 1_000);
    await bindUserLine(FRESH_QUERY);
    await seedFreshReceipt();
    const freshBefore = structuredClone(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID));
    expect(freshBefore).not.toBeNull();
    held.release();
    await pending;
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toEqual(freshBefore);
  });

  it("keeps a live context's result through a newer genuine user line without exposing private metadata", async () => {
    await bindUserLine(OLD_QUERY);
    const held = holdHandler();
    const pending = invokePubPalAskTool({
      toolName: "search_venues", args: { query: "Soho" }, conversationId: CONVERSATION_ID,
    });
    const captured = await Promise.race([
      held.entered,
      pending.then(() => { throw new Error("Invocation completed before entering the handler."); }),
    ]);
    expect(captured.query).toBe(OLD_QUERY);
    vi.setSystemTime(START + 60_000);
    expect(await appendOwnedPubPalUserTurn(
      CONVERSATION_ID, OWNER_ID, { role: "user", content: FRESH_QUERY }, "london",
    )).toBe(true);
    held.release();

    const outcome = await pending;
    expect(outcome).toEqual({ result: {
      ok: true, tool: OLD_RESULT.tool, answerHint: OLD_RESULT.answerHint,
      cards: OLD_RESULT.cards, proposals: OLD_RESULT.proposals, degraded: false,
    } });
    const stored = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    expect(stored).toEqual({
      query: FRESH_QUERY, cityId: "london",
      turns: [{ role: "user", content: OLD_QUERY }, { role: "user", content: FRESH_QUERY }],
      expiresAt: START + 60_000 + PUB_PAL_TOOL_TURN_TTL_MS,
      cards: OLD_RESULT.cards, proposals: OLD_RESULT.proposals,
      hints: [OLD_RESULT.answerHint], toolsUsed: [OLD_RESULT.tool],
    });
    const publicOutput = JSON.stringify({ outcome, stored, context: captured });
    expect(publicOutput).not.toContain(OWNER_ID);
    expect(publicOutput).not.toMatch(/"(?:ownerId|owner_id|createdAt|created_at|revision)"/);
  });
});
