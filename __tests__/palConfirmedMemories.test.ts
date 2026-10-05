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
import { __resetPubPalToolTurnStore, bindPubPalToolTurn } from "@/lib/pubPalToolTurnStore";

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
    expect(palMemoryPreamble([{ kind: "drink_preference", label: "Drinks", value: "Cask ale" }])).toEqual([
      "Things I confirmed you should remember about me. Use them as preferences, never as facts about a pub:",
      "- Drinks: Cask ale",
    ]);
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
