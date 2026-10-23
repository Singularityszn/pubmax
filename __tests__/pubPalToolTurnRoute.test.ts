import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  userId: "11111111-1111-4111-8111-111111111111" as string | null,
  limited: false,
}));

vi.mock("@/lib/pintDrops", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pintDrops")>();
  return { ...actual, isLimited: vi.fn(async () => authState.limited) };
});

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
import {
  __resetPubPalToolTurnStore,
  bindPubPalToolTurn,
  readOwnedPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";

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
  beforeEach(async () => {
    authState.userId = OWNER_ID;
    authState.limited = false;
    __resetPubPalToolTurnStore();
    await bindPubPalToolTurn(CONVERSATION_ID, OWNER_ID, "london");
  });

  it("asks for a session before it says a conversation is missing", async () => {
    authState.userId = null;
    const response = await post({ conversationId: UNKNOWN_ID });
    expect(response.status).toBe(401);
  });

  it("answers 429 and stores nothing once the caller is rate limited", async () => {
    authState.limited = true;
    const response = await post({
      conversationId: CONVERSATION_ID,
      threadTurn: { role: "user", content: "cheap pints in Soho" },
    });
    expect(response.status).toBe(429);
    const turn = await readOwnedPubPalToolTurn(CONVERSATION_ID, OWNER_ID);
    expect(JSON.stringify(turn)).not.toContain("cheap pints in Soho");
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
});
