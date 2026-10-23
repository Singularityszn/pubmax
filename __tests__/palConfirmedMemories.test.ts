import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const limitState = vi.hoisted(() => ({ limited: false }));
const storeState = vi.hoisted(() => ({ failure: null as null | "result" | "throw" }));

vi.mock("@/lib/pubPalStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pubPalStore")>();
  return {
    ...actual,
    listPalMemoriesResult: async (ownerId: string) => {
      if (storeState.failure === "throw") throw new Error("store down");
      if (storeState.failure === "result") return { ok: false as const, error: "error" as const };
      return actual.listPalMemoriesResult(ownerId);
    },
  };
});

vi.mock("@/lib/pintDrops", () => ({
  isLimited: vi.fn(async () => limitState.limited),
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return { ...actual, isSupabaseConfigured: () => false };
});

import { POST } from "@/app/api/pub-pal/tools/[toolName]/route";
import {
  PAL_RECALL_MEMORY_LIMIT,
  readConfirmedPalMemories,
  palMemoryPreamble,
} from "@/lib/palConfirmedMemories.server";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import {
  __resetPubPalStore,
  confirmPalMemoryResult,
  createPubPalResult,
  deletePalMemoryResult,
} from "@/lib/pubPalStore";
import {
  __resetPubPalToolTurnStore,
  appendOwnedPubPalUserTurn,
  bindPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

const OWNER = "11111111-1111-4111-8111-111111111111";
const STRANGER = "22222222-2222-4222-8222-222222222222";

async function palWithMemories(ownerId: string, entries: Array<{ kind: string; value: string }>) {
  const created = await createPubPalResult(ownerId, { ...DEFAULT_PAL_DRAFT, adultConfirmed: true, name: "Morrow" });
  expect(created.ok).toBe(true);
  const ids: string[] = [];
  for (const entry of entries) {
    const confirmed = await confirmPalMemoryResult(ownerId, entry);
    if (!confirmed.ok) throw new Error("memory was not confirmed");
    ids.push(confirmed.value.id);
  }
  return ids;
}

function recall(conversationId: string | undefined, authorization = "Bearer test-llm-secret") {
  return POST(
    new Request("http://localhost/api/pub-pal/tools/recall_memories", {
      method: "POST",
      headers: { "content-type": "application/json", authorization },
      body: JSON.stringify(conversationId ? { conversation_id: conversationId } : {}),
    }),
    { params: Promise.resolve({ toolName: "recall_memories" }) },
  );
}

describe("confirmed Pub Pal memories in the agent loop", () => {
  beforeEach(() => {
    limitState.limited = false;
    storeState.failure = null;
    vi.stubEnv("ELEVENLABS_LLM_SHARED_SECRET", "test-llm-secret");
    __resetPubPalStore();
    __resetPubPalToolTurnStore();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reads the owner's confirmed memories, newest first, and nothing for an account with no Pal", async () => {
    await palWithMemories(OWNER, [
      { kind: "drink_preference", value: "Cask ale, no lager" },
      { kind: "accessibility_preference", value: "Step-free   entrance\nplease" },
    ]);
    const memories = (await readConfirmedPalMemories(OWNER)) ?? [];
    expect(memories.map((memory) => memory.kind).sort()).toEqual(["accessibility_preference", "drink_preference"]);
    expect(memories.find((memory) => memory.kind === "accessibility_preference")?.value).toBe("Step-free entrance please");
    expect(await readConfirmedPalMemories(STRANGER)).toEqual([]);
  });

  it("recalls explicitly reported spend in a new owner-bound conversation", async () => {
    const outcome = "On 19 October 2026 I spent £26.80 at Golden Lion and drank cask ale.";
    await palWithMemories(OWNER, [{ kind: "night_outcome", value: outcome }]);
    for (const id of ["conv_spendfirst01", "conv_spendreturn1"]) {
      await bindPubPalToolTurn(id, OWNER, "london");
      await appendOwnedPubPalUserTurn(id, OWNER, { role: "user", content: "What did I spend last time?" }, "london");
      const body = await (await recall(id)).json();
      expect(body.result.memories).toContainEqual({ kind: "night_outcome", value: outcome });
      expect(body.result.answerHint).toMatch(/reported spend/i);
      expect(body.result.answerHint).toContain("£26.80");
      expect(body.result.answerHint).toMatch(/never.*(?:infer|sum)/i);
    }
    const typed = palMemoryPreamble(await readConfirmedPalMemories(OWNER, "What did I spend last time?")).join(" ");
    expect(typed).toContain(outcome);
    expect(typed).toMatch(/reported spend/i);
    await bindPubPalToolTurn("conv_spendother01", STRANGER, "london");
    expect(JSON.stringify(await (await recall("conv_spendother01")).json())).not.toContain("26.80");
  });

  it("caps how many memories reach the prompt", async () => {
    await palWithMemories(
      OWNER,
      Array.from({ length: PAL_RECALL_MEMORY_LIMIT + 3 }, (_, index) => ({ kind: "venue_preference", value: `Pub note ${index}` })),
    );
    expect(await readConfirmedPalMemories(OWNER)).toHaveLength(PAL_RECALL_MEMORY_LIMIT);
  });

  it("drops a memory the moment the owner deletes it", async () => {
    const [cask] = await palWithMemories(OWNER, [
      { kind: "drink_preference", value: "Cask ale" },
      { kind: "transport_preference", value: "Near the Northern line" },
    ]);
    expect((await deletePalMemoryResult(OWNER, cask as string)).ok).toBe(true);
    expect(((await readConfirmedPalMemories(OWNER)) ?? []).map((memory) => memory.value)).toEqual(["Near the Northern line"]);
  });

  it("frames the typed preamble as preferences, and says so when nothing is confirmed", () => {
    expect(palMemoryPreamble([])).toEqual(["I have not confirmed anything for you to remember about me."]);
    const unavailable = palMemoryPreamble(null).join(" ");
    expect(unavailable).toMatch(/could not be read/i);
    expect(unavailable).not.toMatch(/not confirmed anything/i);
    const preamble = palMemoryPreamble([{ kind: "drink_preference", label: "Drinks", value: "Cask ale" }]);
    expect(preamble).toContain("- Drinks: Cask ale");
    expect(preamble[0]).toMatch(/Preferences guide picks/);
    expect(preamble[0]).toMatch(/personal reports.*reported spend/);
    expect(preamble[0]).toMatch(/Never infer a bill/);
  });

  it("answers the recall webhook with the memories of the account bound to the conversation", async () => {
    await palWithMemories(OWNER, [{ kind: "drink_preference", value: "Cask ale" }]);
    await palWithMemories(STRANGER, [{ kind: "drink_preference", value: "Stranger's lager" }]);
    await bindPubPalToolTurn("conv_ownervoice01", OWNER, "london");

    const response = await recall("conv_ownervoice01");
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.result).toMatchObject({
      ok: true,
      tool: "recall_memories",
      memories: [{ kind: "drink_preference", value: "Cask ale" }],
    });
    expect(body.result.answerHint).toContain("Drinks: Cask ale");
    expect(JSON.stringify(body)).not.toContain("Stranger");
  });

  it("picks the voice call's memories by what the person last said, not only the newest", async () => {
    await palWithMemories(OWNER, [
      { kind: "transport_preference", value: "Gets the Northern line home" },
      ...Array.from({ length: PAL_RECALL_MEMORY_LIMIT + 2 }, (_, index) => ({ kind: "venue_preference", value: `Pub note ${index}` })),
    ]);
    await bindPubPalToolTurn("conv_ownervoice01", OWNER, "london");

    const before = (await (await recall("conv_ownervoice01")).json()).result;
    expect(before.answerHint).not.toContain("Northern line");

    expect(
      await appendOwnedPubPalUserTurn("conv_ownervoice01", OWNER, { role: "user", content: "How am I getting home tonight?" }, "london"),
    ).toBe(true);
    const after = (await (await recall("conv_ownervoice01")).json()).result;
    expect(after.answerHint).toContain("Getting around: Gets the Northern line home");
    expect(after.memories).toHaveLength(PAL_RECALL_MEMORY_LIMIT);
  });

  it("picks a typed turn's memories by its ask", async () => {
    await palWithMemories(OWNER, [
      { kind: "drink_preference", value: "Allergic to sulphites, so no wine" },
      ...Array.from({ length: PAL_RECALL_MEMORY_LIMIT + 2 }, (_, index) => ({ kind: "venue_preference", value: `Pub note ${index}` })),
    ]);
    const plain = ((await readConfirmedPalMemories(OWNER)) ?? []).map((memory) => memory.value);
    const wine = ((await readConfirmedPalMemories(OWNER, "Fancy a glass of wine?")) ?? []).map((memory) => memory.value);
    expect(plain).not.toContain("Allergic to sulphites, so no wine");
    expect(wine[0]).toBe("Allergic to sulphites, so no wine");
  });

  it("reports a memory store failure as unavailable, never as nothing confirmed", async () => {
    await palWithMemories(OWNER, [{ kind: "drink_preference", value: "Cask ale" }]);
    await bindPubPalToolTurn("conv_ownervoice01", OWNER, "london");
    for (const failure of ["result", "throw"] as const) {
      storeState.failure = failure;
      const body = await (await recall("conv_ownervoice01")).json();
      expect(body.result).toMatchObject({ ok: false, memories: [] });
      expect(body.result.answerHint).not.toMatch(/not confirmed anything/i);
      expect(await readConfirmedPalMemories(OWNER)).toBeNull();
    }
  });

  it("answers an account with no Pal as nothing confirmed", async () => {
    await bindPubPalToolTurn("conv_ownervoice01", STRANGER, "london");
    const body = await (await recall("conv_ownervoice01")).json();
    expect(body.result).toMatchObject({ ok: true, memories: [] });
  });

  it("returns nothing for a conversation no signed-in account opened", async () => {
    await palWithMemories(OWNER, [{ kind: "drink_preference", value: "Cask ale" }]);
    for (const conversationId of ["conv_neverbound01", "not-a-conversation", undefined]) {
      const body = await (await recall(conversationId)).json();
      expect(body.result).toMatchObject({ ok: false, memories: [] });
      expect(JSON.stringify(body)).not.toContain("Cask ale");
    }
  });

  it("refuses the recall webhook without the shared secret", async () => {
    await palWithMemories(OWNER, [{ kind: "drink_preference", value: "Cask ale" }]);
    await bindPubPalToolTurn("conv_ownervoice01", OWNER, "london");
    const response = await recall("conv_ownervoice01", "Bearer wrong-secret");
    expect(response.status).toBe(401);
    expect(await response.text()).not.toContain("Cask ale");
  });

  it("rate limits the recall webhook like every other Pal tool", async () => {
    limitState.limited = true;
    const response = await recall("conv_ownervoice01");
    expect(response.status).toBe(429);
  });
});
