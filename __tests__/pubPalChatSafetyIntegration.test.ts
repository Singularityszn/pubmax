import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/authServer", () => ({ callerUserId: async () => "owner-a" }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: async () => false }));
vi.mock("@/lib/ai/typesafe.server", () => ({ systemOne: vi.fn() }));
vi.mock("@/lib/supabase", async (original) => ({
  ...await original<typeof import("@/lib/supabase")>(),
  isSupabaseConfigured: () => false,
}));

import { POST } from "@/app/api/pub-pal/chat/route";
import { systemOne } from "@/lib/ai/typesafe.server";
import { runPalElevenLabsChatTurn } from "@/lib/palElevenLabsChat.server";
import { __resetPubPalToolTurnStore, registerPubPalToolTurn } from "@/lib/pubPalToolTurnStore";
import { offlineFetch } from "@/evals/pal/offlineFetch";

const query = "Wine prices at Fox and Anchor this evening?";
const threadId = "conv_safetyowned1";
const safetyQuestion = "Can I drink 1.5 pints before driving?";

function request(body: unknown, stream: boolean) {
  return new Request("http://localhost/api/pub-pal/chat", {
    method: "POST",
    headers: { "content-type": "application/json", ...(stream ? { accept: "application/x-ndjson" } : {}) },
    body: JSON.stringify(body),
  });
}

async function answer(response: Response) {
  expect(response.status).toBe(200);
  if (!response.headers.get("content-type")?.includes("application/x-ndjson")) return response.json();
  const events = (await response.text()).trim().split("\n").map((line) => JSON.parse(line));
  expect(events.at(-1)?.type).toBe("final");
  return events.at(-1).body;
}

beforeEach(() => {
  __resetPubPalToolTurnStore();
  vi.stubEnv("ELEVENLABS_API_KEY", "test-key");
  vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "test-agent");
  vi.stubGlobal("fetch", offlineFetch);
  vi.mocked(systemOne).mockReset().mockResolvedValue(null);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("typed POST with the real chat service and safety resolver", () => {
  it.each([false, true])("classifies a records-only request once, stream: %s", async (stream) => {
    const body = await answer(await POST(request({ query }, stream)));
    expect(body.toolsUsed).toEqual(["venue_drinks"]);
    expect(body.answer).toContain("Fox");
    expect(systemOne).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("includes owned history in the single classification, stream: %s", async (stream) => {
    await registerPubPalToolTurn(threadId, { query: "Find pubs in Soho", cityId: "london", ownerId: "owner-a" });
    const body = await answer(await POST(request({ query, threadId }, stream)));
    expect(body.toolsUsed).toEqual(["venue_drinks"]);
    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(systemOne).toHaveBeenCalledWith(
      { message: query, recentTurns: [{ role: "user", content: "Find pubs in Soho" }] },
      expect.anything(), expect.anything(),
    );
  });

  it.each([false, true].flatMap((stream) => ["current", "browser", "stored"].map((source) => ({ stream, source }))))(
    "keeps $source safety fencing, stream: $stream", async ({ stream, source }) => {
      if (source === "stored") {
        await registerPubPalToolTurn(threadId, { query: safetyQuestion, cityId: "london", ownerId: "owner-a" });
      }
      const body = await answer(await POST(request({
        query: source === "current" ? safetyQuestion : query,
        threadId,
        turns: source === "browser" ? [{ role: "user", content: safetyQuestion }] : [],
      }, stream)));
      expect(body.answer).toContain("I can't tell you whether to have another drink.");
      expect(body.cards).toEqual([]);
      expect(body.toolsUsed).toEqual([]);
      expect(vi.mocked(systemOne).mock.calls.length).toBeLessThanOrEqual(1);
    },
  );

  it("does not fence another owner's stored history or browser assistant turns", async () => {
    await registerPubPalToolTurn(threadId, { query: safetyQuestion, cityId: "london", ownerId: "owner-b" });
    const body = await answer(await POST(request({ query, threadId, turns: [{ role: "assistant", content: safetyQuestion }] }, false)));
    expect(body.toolsUsed).toEqual(["venue_drinks"]);
    expect(body.answer).not.toContain("Getting Home");
    expect(systemOne).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("honours a semantic safety refusal before an opening, stream: %s", async (stream) => {
    await registerPubPalToolTurn(threadId, {
      query: "", cityId: "london", ownerId: "owner-a",
      turns: [{ role: "assistant", content: "Something similar tonight?" }],
      hints: ["Something similar tonight?"],
    });
    vi.mocked(systemOne).mockResolvedValue({
      model: "test-classifier", usage: { input_tokens: 1, output_tokens: 1 },
      answers: {
        fitToTravelAfterDrinking: { type: "noul", noul: 0.9 },
        getHomeTonight: { type: "noul", noul: 0 },
      },
    });
    const body = await answer(await POST(request({ query: "Yes", threadId }, stream)));
    expect(body.answer).toContain("I can't tell you whether to have another drink.");
    expect(body.answer).not.toContain("Which area");
    expect(body.toolsUsed).toEqual([]);
    expect(systemOne).toHaveBeenCalledTimes(1);
  });

  it("classifies a keyless request once", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "");
    const body = await answer(await POST(request({ query }, false)));
    expect(body.toolsUsed).toEqual(["venue_drinks"]);
    expect(systemOne).toHaveBeenCalledTimes(1);
  });

  it("excludes stored assistant safety text", async () => {
    await registerPubPalToolTurn(threadId, {
      query: "Find pubs in Soho", cityId: "london", ownerId: "owner-a",
      turns: [{ role: "assistant", content: safetyQuestion }],
    });
    const body = await answer(await POST(request({ query, threadId }, false)));
    expect(body.toolsUsed).toEqual(["venue_drinks"]);
    expect(body.answer).not.toContain("Getting Home");
    expect(systemOne).toHaveBeenCalledTimes(1);
  });

  it("delivers both history windows to the single classifier call", async () => {
    const browserTurns = Array.from({ length: 6 }, (_, index) => ({ role: "user" as const, content: `Browser question ${index}` }));
    const storedTurns = Array.from({ length: 5 }, (_, index) => ({ role: "user" as const, content: `Stored question ${index}` }));
    await registerPubPalToolTurn(threadId, {
      query: "Find pubs in Soho", cityId: "london", ownerId: "owner-a", turns: storedTurns,
    });
    const body = await answer(await POST(request({ query, threadId, turns: browserTurns }, false)));
    expect(body.toolsUsed).toEqual(["venue_drinks"]);
    expect(systemOne).toHaveBeenCalledTimes(1);
    expect(systemOne).toHaveBeenCalledWith({ message: query, recentTurns: [
      ...browserTurns, ...storedTurns, { role: "user", content: "Find pubs in Soho" },
    ] }, expect.anything(), expect.anything());
  });

  it("still classifies a direct service call once", async () => {
    const outcome = await runPalElevenLabsChatTurn({ query, ownerId: "owner-a" });
    expect(outcome.ok && outcome.toolsUsed).toEqual(["venue_drinks"]);
    expect(systemOne).toHaveBeenCalledTimes(1);
  });
});
