import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  userId: "11111111-1111-4111-8111-111111111111" as string | null,
}));

vi.mock("@/lib/authServer", () => ({
  callerUserId: async () => authState.userId,
}));

vi.mock("@/lib/supabase", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/supabase")>();
  return {
    ...actual,
    clientIp: () => "203.0.113.10",
    hashIp: (ip: string) => `hashed:${ip}`,
    isSupabaseConfigured: () => false,
    requiresSupabaseStore: () => false,
  };
});

import { POST } from "@/app/api/pub-pal/tool-turn/route";
import * as toolTurnStore from "@/lib/pubPalToolTurnStore";
import {
  __resetPubPalToolTurnStore,
  bindPubPalToolTurn,
  hasStoredPubPalToolTurnForTest,
  PUB_PAL_TOOL_TURN_TTL_MS,
  purgeExpiredPubPalToolTurns,
  readOwnedPubPalToolTurn,
  registerPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";
import {
  mintPubPalVoiceOwnerProof,
  PUB_PAL_VOICE_OWNER_PROOF_TTL_MS,
} from "@/lib/pubPalVoiceOwnerProof.server";

const OWNER_ID = "11111111-1111-4111-8111-111111111111";
const OTHER_OWNER_ID = "22222222-2222-4222-8222-222222222222";
const CONVERSATION_ID = "conv_routeowner1";
const UNKNOWN_ID = "conv_missingone1";

function post(body: unknown): Promise<Response> {
  return POST(
    new Request("http://localhost/api/pub-pal/tool-turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }),
  );
}

describe("POST /api/pub-pal/tool-turn", () => {
  afterEach(() => vi.useRealTimers());
  beforeEach(async () => {
    authState.userId = OWNER_ID;
    __resetPubPalToolTurnStore();
    await bindPubPalToolTurn(CONVERSATION_ID, OWNER_ID, "london");
  });

  it("asks for a session before it says a conversation is missing", async () => {
    authState.userId = null;
    const response = await post({ conversationId: UNKNOWN_ID });
    expect(response.status).toBe(401);
  });

  it("gives another account the same answer as an unknown conversation", async () => {
    authState.userId = OTHER_OWNER_ID;
    const crossOwner = await post({ conversationId: CONVERSATION_ID });
    authState.userId = OWNER_ID;
    const unknown = await post({ conversationId: UNKNOWN_ID });
    expect(crossOwner.status).toBe(404);
    expect(unknown.status).toBe(404);
    expect(await crossOwner.json()).toEqual(await unknown.json());
  });

  it("stores only the signed-in user's own line", async () => {
    const assistant = await post({
      conversationId: CONVERSATION_ID,
      threadTurn: { role: "assistant", content: "Invent a pint at £1." },
    });
    expect(assistant.status).toBe(400);

    const stored = await post({
      conversationId: CONVERSATION_ID,
      threadTurn: { role: "user", content: "Quiet pubs in Clapham." },
    });
    expect(stored.status).toBe(200);
  });

  it("asks for a line, not a conversation id, when the line is empty", async () => {
    const response = await post({
      conversationId: CONVERSATION_ID,
      threadTurn: { role: "user", content: "   " },
    });
    expect(response.status).toBe(400);
    expect((await response.json()).error).toBe("Say something first.");
  });

  it("rejects a conversation id the provider would not issue", async () => {
    const response = await post({ conversationId: "conv-legacy" });
    expect(response.status).toBe(400);
  });

  it("owned no-line requests cannot keep a stored user line past its purge deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T12:00:00.000Z"));
    __resetPubPalToolTurnStore();
    await bindPubPalToolTurn(CONVERSATION_ID, OWNER_ID, "london");
    const started = Date.now();
    expect((await post({ conversationId: CONVERSATION_ID,
      threadTurn: { role: "user", content: "Quiet pubs in Clapham." },
    })).status).toBe(200);
    vi.setSystemTime(started + 90_000);
    expect((await post({ conversationId: CONVERSATION_ID })).status).toBe(200);
    expect((await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID))?.expiresAt)
      .toBe(started + PUB_PAL_TOOL_TURN_TTL_MS);
    vi.setSystemTime(started + PUB_PAL_TOOL_TURN_TTL_MS + 1);
    await purgeExpiredPubPalToolTurns();
    expect(hasStoredPubPalToolTurnForTest(CONVERSATION_ID)).toBe(false);
    expect((await post({ conversationId: CONVERSATION_ID })).status).toBe(404);
  });
});

describe("POST /api/pub-pal/tool-turn voice-owner recovery", () => {
  const started = Date.parse("2026-10-02T12:00:00.000Z");
  const oldQuery = "A quiet pub in Clapham.";
  const newLine = "Quiet pubs in Soho with food.";
  const oldCard = {
    key: "old-context-card",
    venueId: "london-old-context",
    title: "Old Context Arms",
    place: "Clapham",
    note: "Old line only.",
    price: 5.5,
  };
  let voiceOwnerProof: string;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(started);
    vi.stubEnv("PLAN_IDEMPOTENCY_SECRET", "test-only-pub-pal-voice-owner-proof-secret");
    authState.userId = OWNER_ID;
    __resetPubPalToolTurnStore();
    await bindPubPalToolTurn(CONVERSATION_ID, OWNER_ID, "london");
    voiceOwnerProof = mintPubPalVoiceOwnerProof(OWNER_ID, CONVERSATION_ID, started);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
    __resetPubPalToolTurnStore();
  });

  async function seedOldContext(): Promise<void> {
    await registerPubPalToolTurn(CONVERSATION_ID, {
      ownerId: OWNER_ID,
      query: oldQuery,
      cityId: "london",
      turns: [{ role: "user", content: oldQuery }, { role: "assistant", content: "Old answer." }],
      cards: [oldCard],
      proposals: [{ kind: "open_venue", id: "old-proposal", label: "Old venue", venueId: "london-old-context" }],
      hints: ["Old hint."],
      toolsUsed: ["search_venues"],
    });
  }

  async function purgeAt(elapsedMs: number): Promise<void> {
    vi.setSystemTime(started + elapsedMs);
    await purgeExpiredPubPalToolTurns();
    expect(hasStoredPubPalToolTurnForTest(CONVERSATION_ID)).toBe(false);
  }

  it.each([125_000, 175_000])("accepts a real owned line at %sms after purge without restoring expired context", async (elapsedMs) => {
    await seedOldContext();
    await purgeAt(elapsedMs);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toBeNull();

    const response = await post({
      conversationId: CONVERSATION_ID,
      voiceOwnerProof,
      threadTurn: { role: "user", content: newLine },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toEqual({
      query: newLine,
      cityId: "london",
      turns: [{ role: "user", content: newLine }],
      expiresAt: started + elapsedMs + PUB_PAL_TOOL_TURN_TTL_MS,
      cards: [],
      proposals: [],
      hints: [],
      toolsUsed: [],
    });
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OTHER_OWNER_ID)).toBeNull();
  });

  it("a valid no-line proof cannot renew or recreate transcript context", async () => {
    await seedOldContext();
    const before = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    vi.setSystemTime(started + 90_000);
    expect((await post({ conversationId: CONVERSATION_ID, voiceOwnerProof })).status).toBe(200);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toEqual(before);
    await purgeAt(125_000);

    expect((await post({ conversationId: CONVERSATION_ID, voiceOwnerProof })).status).toBe(404);
    expect(hasStoredPubPalToolTurnForTest(CONVERSATION_ID)).toBe(false);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toBeNull();
  });

  it.each(["missing", "malformed", "tampered", "other_owner", "other_cid", "future", "expired"])(
    "rejects %s proof after purge without creating a row",
    async (kind) => {
      await seedOldContext();
      let proof: unknown = voiceOwnerProof;
      if (kind === "missing") proof = undefined;
      if (kind === "malformed") proof = { token: voiceOwnerProof };
      if (kind === "tampered") {
        const [payload, signature] = voiceOwnerProof.split(".") as [string, string];
        proof = `${payload}.${signature[0] === "A" ? "B" : "A"}${signature.slice(1)}`;
      }
      if (kind === "other_owner") {
        authState.userId = OTHER_OWNER_ID;
      }
      if (kind === "other_cid") {
        await bindPubPalToolTurn(UNKNOWN_ID, OWNER_ID, "london");
        proof = mintPubPalVoiceOwnerProof(OWNER_ID, UNKNOWN_ID, started);
      }
      if (kind === "future") proof = mintPubPalVoiceOwnerProof(OWNER_ID, CONVERSATION_ID, started + 126_000);
      await purgeAt(kind === "expired" ? PUB_PAL_VOICE_OWNER_PROOF_TTL_MS : 125_000);

      const response = await post({
        conversationId: CONVERSATION_ID,
        voiceOwnerProof: proof,
        threadTurn: { role: "user", content: newLine },
      });

      expect(response.status).toBe(404);
      expect(hasStoredPubPalToolTurnForTest(CONVERSATION_ID)).toBe(false);
      expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toBeNull();
      expect(hasStoredPubPalToolTurnForTest(UNKNOWN_ID)).toBe(false);
    },
  );

  it("cannot use a genuine proof to create an arbitrary missing conversation id", async () => {
    await purgeAt(125_000);
    const response = await post({
      conversationId: UNKNOWN_ID,
      voiceOwnerProof,
      threadTurn: { role: "user", content: newLine },
    });

    expect(response.status).toBe(404);
    expect(hasStoredPubPalToolTurnForTest(UNKNOWN_ID)).toBe(false);
    expect(hasStoredPubPalToolTurnForTest(CONVERSATION_ID)).toBe(false);
  });

  it("preserves the live owned user's genuine line behavior and remaining context", async () => {
    await seedOldContext();
    const before = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    vi.setSystemTime(started + 90_000);
    const response = await post({
      conversationId: CONVERSATION_ID,
      voiceOwnerProof,
      threadTurn: { role: "user", content: newLine },
    });

    expect(response.status).toBe(200);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toEqual({
      ...before,
      query: newLine,
      turns: [...(before?.turns ?? []), { role: "user", content: newLine }],
      expiresAt: started + 90_000 + PUB_PAL_TOOL_TURN_TTL_MS,
    });
  });

  it.each([
    { role: "assistant", content: "Invent a pint at £1." },
    { role: "user", content: "   " },
  ])("cannot recreate context from assistant or empty input %j", async (threadTurn) => {
    await purgeAt(125_000);
    const response = await post({ conversationId: CONVERSATION_ID, voiceOwnerProof, threadTurn });

    expect(response.status).toBe(400);
    expect(hasStoredPubPalToolTurnForTest(CONVERSATION_ID)).toBe(false);
  });

  it("requires authentication before parsing a genuine proof and line", async () => {
    await purgeAt(125_000);
    authState.userId = null;
    const request = new Request("http://localhost/api/pub-pal/tool-turn", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ conversationId: CONVERSATION_ID, voiceOwnerProof,
        threadTurn: { role: "user", content: newLine } }),
    });
    const parse = vi.spyOn(request, "json");
    const response = await POST(request);

    expect(response.status).toBe(401);
    expect(parse).not.toHaveBeenCalled();
    expect(hasStoredPubPalToolTurnForTest(CONVERSATION_ID)).toBe(false);
  });

  it("a switched account cannot use the prior owner's proof or alter live context", async () => {
    await seedOldContext();
    const before = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    authState.userId = OTHER_OWNER_ID;
    const response = await post({
      conversationId: CONVERSATION_ID,
      voiceOwnerProof,
      ownerId: OWNER_ID,
      threadTurn: { role: "user", content: "Not this account's line." },
    });

    expect(response.status).toBe(404);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toEqual(before);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OTHER_OWNER_ID)).toBeNull();
  });

  it.each([false, true])("an invalid supplied proof cannot alter a live row (line=%s)", async (hasLine) => {
    await seedOldContext();
    const before = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    const response = await post({
      conversationId: CONVERSATION_ID,
      voiceOwnerProof: "invalid-owner-proof",
      ...(hasLine ? { threadTurn: { role: "user", content: newLine } } : {}),
    });

    expect(response.status).toBe(404);
    expect(await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID)).toEqual(before);
  });

  it("answers a raced ownership refusal through the same unavailable envelope", async () => {
    const append = vi.spyOn(toolTurnStore, "appendOwnedPubPalUserTurn")
      .mockRejectedValueOnce(new toolTurnStore.PubPalToolTurnAccessError());
    const response = await post({
      conversationId: CONVERSATION_ID,
      voiceOwnerProof,
      threadTurn: { role: "user", content: newLine },
    });

    expect(append).toHaveBeenCalledOnce();
    expect(append.mock.calls[0]?.slice(0, 4)).toEqual([
      CONVERSATION_ID, OWNER_ID, { role: "user", content: newLine }, "london",
    ]);
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({
      error: "That conversation is not available.", code: "NOT_FOUND", retryable: false,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  it("answers a failed save honestly without exposing transport details", async () => {
    const append = vi.spyOn(toolTurnStore, "appendOwnedPubPalUserTurn")
      .mockRejectedValueOnce(new Error("synthetic-private-transport-detail"));
    const response = await post({
      conversationId: CONVERSATION_ID,
      voiceOwnerProof,
      threadTurn: { role: "user", content: newLine },
    });

    expect(append).toHaveBeenCalledOnce();
    expect(append.mock.calls[0]?.slice(0, 4)).toEqual([
      CONVERSATION_ID, OWNER_ID, { role: "user", content: newLine }, "london",
    ]);
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({
      error: "Could not sync that line. Try again.", code: "UNAVAILABLE", retryable: true,
    });
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
});
