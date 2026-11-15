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
  appendOwnedPubPalUserTurn,
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
  await registerPubPalToolTurn(CONVERSATION, {
    query: "a quiet pub tonight, I drink cask ale, no lager", cityId: "london", ownerId,
    turns: [{ role: "user", content: "I like quiet rooms" }],
  });
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

  it("refuses a positive fragment that reverses a negative preference", async () => {
    await pal(OWNER, true);
    await registerPubPalToolTurn(CONVERSATION, { query: "I don't like cask ale", cityId: "london", ownerId: OWNER });
    const body = await (await propose({ conversation_id: CONVERSATION, kind: "drink_preference", value: "cask ale" })).json();
    expect(body.result).toMatchObject({ ok: false, proposals: [] });
    expect(await storedProposals()).toEqual([]);
  });

  it("rejects an unsupported memory kind for the person's words", async () => {
    await pal(OWNER, true);
    await registerPubPalToolTurn(CONVERSATION, { query: "I like quiet rooms", cityId: "london", ownerId: OWNER });
    const body = await (await propose({ conversation_id: CONVERSATION, kind: "drink_preference", value: "quiet rooms" })).json();
    expect(body.result).toMatchObject({ ok: false, proposals: [] });
  });

  it.each([
    ["another person's preference", "My friend likes stout", "drink_preference", "stout"],
    ["a question", "Which pubs serve cask ale?", "drink_preference", "cask ale"],
    ["a food mismatch", "I like quiet rooms", "food_preference", "quiet rooms"],
    ["an accessibility mismatch", "I like quiet rooms", "accessibility_preference", "quiet rooms"],
    ["a missing condition", "I only drink stout on Fridays", "drink_preference", "stout"],
  ])("refuses %s", async (_label, query, kind, value) => {
    await pal(OWNER, true);
    await registerPubPalToolTurn(CONVERSATION, { query, cityId: "london", ownerId: OWNER });
    const body = await (await propose({ conversation_id: CONVERSATION, kind, value })).json();
    expect(body.result).toMatchObject({ ok: false, proposals: [] });
    expect(await storedProposals()).toEqual([]);
  });

  it("keeps a complete negative first-person preference", async () => {
    await pal(OWNER, true);
    await registerPubPalToolTurn(CONVERSATION, { query: "I do not like cask ale", cityId: "london", ownerId: OWNER });
    const body = await (await propose({ conversation_id: CONVERSATION, kind: "drink_preference", value: "I do not like cask ale" })).json();
    expect(body.result).toMatchObject({ ok: true, proposals: [{ kind: "remember_memory", value: "I do not like cask ale" }] });
    expect(await listPalMemoriesResult(OWNER)).toEqual({ ok: true, value: [] });
  });

  it.each([
    ["venue_preference", "I like quiet rooms"],
    ["atmosphere_preference", "I like quiet music"],
    ["accessibility_preference", "I need step-free access"],
    ["transport_preference", "I take the bus home"],
    ["drink_preference", "I like stout"],
    ["food_preference", "I like vegan food"],
    ["night_outcome", "I had a good night at The Lamb"],
    ["correction", "My local is The Lamb, not The Crown"],
  ])("accepts an explicit statement for %s", async (kind, value) => {
    await pal(OWNER, true);
    await registerPubPalToolTurn(CONVERSATION, { query: value, cityId: "london", ownerId: OWNER });
    const body = await (await propose({ conversation_id: CONVERSATION, kind, value })).json();
    expect(body.result).toMatchObject({ ok: true, proposals: [{ kind: "remember_memory", value }] });
  });

  it.each([
    ["I like stout on Fridays", "stout"],
    ["I like stout and my friend likes lager", "stout"],
    ["I like stout, but not on Fridays", "stout"],
  ])("keeps the full meaning of %s", async (query, value) => {
    await pal(OWNER, true);
    await registerPubPalToolTurn(CONVERSATION, { query, cityId: "london", ownerId: OWNER });
    const body = await (await propose({ conversation_id: CONVERSATION, kind: "drink_preference", value })).json();
    expect(body.result).toMatchObject({ ok: false, proposals: [] });
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

  it("offers a visible voice confirm card and recalls only after the owner confirms", async () => {
    await pal(OWNER, true);
    await bindPubPalToolTurn(CONVERSATION, OWNER, "london");
    expect(await appendOwnedPubPalUserTurn(CONVERSATION, OWNER, { role: "user", content: "Remember cask ale for me" }, "london")).toBe(true);

    const body = await (
      await propose({ conversation_id: CONVERSATION, kind: "drink_preference", value: "Cask ale" })
    ).json();

    expect(body.result).toMatchObject({ ok: true, proposals: [{ kind: "remember_memory", value: "Cask ale" }] });
    expect(await listPalMemoriesResult(OWNER)).toEqual({ ok: true, value: [] });
    const confirmed = await CONFIRM_MEMORY(new Request("http://localhost/api/pub-pal/memories", {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${OWNER}` },
      body: JSON.stringify({ kind: "drink_preference", value: "Cask ale" }),
    }));
    expect(confirmed.status).toBe(201);
    await bindPubPalToolTurn("conv_returnvoice01", OWNER, "london");
    const recalled = await TOOL(new Request("http://localhost/api/pub-pal/tools/recall_memories", {
      method: "POST", headers: { "content-type": "application/json", authorization: "Bearer test-llm-secret" },
      body: JSON.stringify({ conversation_id: "conv_returnvoice01" }),
    }), { params: Promise.resolve({ toolName: "recall_memories" }) });
    expect(await recalled.json()).toMatchObject({ result: { ok: true, memories: [{ kind: "drink_preference", value: "Cask ale" }] } });
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

  it.each([
    ["a venue fact", "The Crown has a beer garden"],
    ["a paraphrase that adds a claim", "Loves the cask ale at The Crown"],
    ["a word run that crosses no said line", "quiet rooms cask ale"],
  ])("makes no card from %s the person never said", async (_label, value) => {
    await pal(OWNER, true);
    await typedChat(OWNER);

    const body = await (await propose({ conversation_id: CONVERSATION, kind: "drink_preference", value })).json();

    expect(body.result).toMatchObject({ ok: false, proposals: [] });
    expect(await storedProposals()).toEqual([]);
  });

  it("makes a card from words the person said in an earlier line of the chat", async () => {
    await pal(OWNER, true);
    await typedChat(OWNER);

    const body = await (await propose({ conversation_id: CONVERSATION, kind: "venue_preference", value: "Quiet rooms." })).json();

    expect(body.result).toMatchObject({ ok: true, proposals: [{ kind: "remember_memory", value: "Quiet rooms." }] });
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
