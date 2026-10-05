import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const limitState = vi.hoisted(() => ({ limited: false }));

vi.mock("@/lib/pintDrops", () => ({
  isLimited: vi.fn(async () => limitState.limited),
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

vi.mock("@/lib/authServer", () => ({
  callerUserId: async (request: Request) =>
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || null,
}));

import { POST as CONFIRM_MEMORY } from "@/app/api/pub-pal/memories/route";
import { POST as TOOL } from "@/app/api/pub-pal/tools/[toolName]/route";
import type { AskProposal } from "@/lib/ask/types";
import { readConfirmedPalMemories } from "@/lib/palConfirmedMemories.server";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import {
  __resetPubPalStore,
  createPubPalResult,
  listPalMemoriesResult,
  updatePubPalResult,
} from "@/lib/pubPalStore";
import {
  __resetPubPalToolTurnStore,
  bindPubPalToolTurn,
  readPubPalToolTurn,
  registerPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";
const CONVERSATION = "conv_proposetest01";

async function pal(ownerId: string, memories: boolean) {
  expect((await createPubPalResult(ownerId, { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Morrow" })).ok).toBe(true);
  expect((await updatePubPalResult(ownerId, { proposalPreferences: { memories } })).ok).toBe(true);
}

async function typedChat(ownerId: string) {
  await registerPubPalToolTurn(CONVERSATION, { query: "a quiet pub tonight", cityId: "london", ownerId });
}

function propose(body: Record<string, unknown>, authorization = "Bearer test-llm-secret") {
  return TOOL(
    new Request("http://localhost/api/pub-pal/tools/propose_memory", {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ toolName: "propose_memory" }) },
  );
}

async function storedProposals(): Promise<AskProposal[]> {
  return (await readPubPalToolTurn(CONVERSATION))?.proposals ?? [];
}

describe("propose_memory: the Pal proposes, only the person saves", () => {
  beforeEach(() => {
    limitState.limited = false;
    vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "test-llm-secret");
    __resetPubPalStore();
    __resetPubPalToolTurnStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("adds a confirm card and saves nothing until the owner confirms it through the memories route", async () => {
    await pal(OWNER, true);
    await typedChat(OWNER);

    const response = await propose({
      conversation_id: CONVERSATION,
      parameters: { kind: "drink_preference", value: "  Cask ale,\nno lager  " },
    });
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toMatchObject({ ok: true, tool: "propose_memory" });

    const [card] = await storedProposals();
    expect(card).toMatchObject({
      kind: "remember_memory",
      memoryKind: "drink_preference",
      value: "Cask ale, no lager",
    });
    expect((await readPubPalToolTurn(CONVERSATION))?.toolsUsed).toContain("propose_memory");
    expect(await listPalMemoriesResult(OWNER)).toEqual({ ok: true, value: [] });

    if (card?.kind !== "remember_memory") throw new Error("expected a memory card");
    const confirmed = await CONFIRM_MEMORY(
      new Request("http://localhost/api/pub-pal/memories", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` },
        body: JSON.stringify({ kind: card.memoryKind, value: card.value }),
      }),
    );
    expect(confirmed.status).toBe(201);
    expect(await readConfirmedPalMemories(OWNER)).toEqual([
      { kind: "drink_preference", label: "Drinks", value: "Cask ale, no lager" },
    ]);
  });

  it("proposes nothing when the owner has memory proposals off", async () => {
    await pal(OWNER, false);
    await typedChat(OWNER);

    const body = await (await propose({ conversation_id: CONVERSATION, kind: "drink_preference", value: "Cask ale" })).json();

    expect(body.result).toMatchObject({ ok: false, proposals: [] });
    expect(await storedProposals()).toEqual([]);
  });

  it("reads the owner from the conversation binding, never from the webhook body", async () => {
    await pal(OWNER, false);
    await pal(STRANGER, true);
    await typedChat(OWNER);

    const spoofed = await (
      await propose({ conversation_id: CONVERSATION, ownerId: STRANGER, kind: "drink_preference", value: "Cask ale" })
    ).json();
    expect(spoofed.result.ok).toBe(false);
    expect(await storedProposals()).toEqual([]);

    for (const conversationId of ["conv_neverbound01", "not-a-conversation", undefined]) {
      const body = await (
        await propose({ ...(conversationId ? { conversation_id: conversationId } : {}), kind: "drink_preference", value: "Cask ale" })
      ).json();
      expect(body.result).toMatchObject({ ok: false, proposals: [] });
    }
  });

  it("refuses in a voice call, where no card can be shown, and makes no card", async () => {
    await pal(OWNER, true);
    await bindPubPalToolTurn(CONVERSATION, OWNER, "london");

    const body = await (
      await propose({ conversation_id: CONVERSATION, kind: "drink_preference", value: "Cask ale" })
    ).json();

    expect(body.result).toMatchObject({ ok: false, proposals: [] });
    expect(body.result.answerHint).not.toMatch(/card is waiting/i);
    expect(await storedProposals()).toEqual([]);
    expect((await readPubPalToolTurn(CONVERSATION))?.toolsUsed).toEqual([]);
  });

  it("refuses a kind outside the memory vocabulary or an empty value", async () => {
    await pal(OWNER, true);
    await typedChat(OWNER);

    for (const parameters of [
      { kind: "price_fact", value: "The Crown pint is £3" },
      { kind: "drink_preference", value: "   " },
      { value: "Cask ale" },
    ]) {
      const body = await (await propose({ conversation_id: CONVERSATION, parameters })).json();
      expect(body.result).toMatchObject({ ok: false, proposals: [] });
    }
    expect(await storedProposals()).toEqual([]);
  });

  it("refuses the propose webhook without the shared secret", async () => {
    await pal(OWNER, true);
    await typedChat(OWNER);

    const response = await propose(
      { conversation_id: CONVERSATION, kind: "drink_preference", value: "Cask ale" },
      "Bearer wrong-secret",
    );
    expect(response.status).toBe(401);
    expect(await storedProposals()).toEqual([]);
  });
});
