import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ owner: "owner-a" as string | null, unavailable: false, inferred: false, limited: false, authReads: 0, memoryReads: 0 }));
vi.mock("@/lib/authServer", () => ({ callerUserId: async () => { state.authReads += 1; return state.owner; } }));
vi.mock("@/lib/supabase", async (original) => ({ ...await original<typeof import("@/lib/supabase")>(), isSupabaseConfigured: () => false }));
vi.mock("@/lib/palTaste.server", () => ({ readPalTaste: async () => null }));
vi.mock("@/lib/pintDrops", () => ({ isLimited: vi.fn(async () => state.limited) }));
vi.mock("@/lib/pubPalStore", async (original) => {
  const actual = await original<typeof import("@/lib/pubPalStore")>();
  return { ...actual, listPalMemoriesResult: async (owner: string) => {
    state.memoryReads += 1;
    if (state.unavailable) return { ok: false, error: "error" };
    const result = await actual.listPalMemoriesResult(owner);
    if (result.ok && state.inferred) return { ok: true, value: result.value.map(memory => ({ ...memory, provenance: "completed_plan" })) };
    return result;
  } };
});

import { GET, POST } from "@/app/api/pub-pal/chat/route";
import { POST as confirm } from "@/app/api/pub-pal/memories/route";
import { __resetPubPalStore, createPubPalResult, updatePubPalResult } from "@/lib/pubPalStore";
import { __resetPubPalToolTurnStore, readOwnedPubPalToolTurn } from "@/lib/pubPalToolTurnStore";
import { DEFAULT_PAL_DRAFT } from "@/lib/pubPal";
import { isLimited } from "@/lib/pintDrops";
import { offlineFetch } from "@/evals/pal/offlineFetch";
import * as palStore from "@/lib/pubPalStore";
import * as turnStore from "@/lib/pubPalToolTurnStore";

const report = "I visited The Crown on 10 October 2026, drank Camden Hells and spent £26.80 in total.";
const request = (body: unknown) => new Request("http://localhost/api/pub-pal/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const opening = () => GET(new Request("http://localhost/api/pub-pal/chat"));

beforeEach(async () => {
  __resetPubPalStore();
  __resetPubPalToolTurnStore();
  state.owner = "owner-a";
  state.unavailable = false;
  state.inferred = false;
  state.limited = false;
  state.authReads = 0;
  state.memoryReads = 0;
  vi.stubGlobal("fetch", offlineFetch);
  vi.stubEnv("ELEVENLABS_API_KEY", "");
  vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "");
  expect((await createPubPalResult("owner-a", { ...DEFAULT_PAL_DRAFT, name: "Ripley", adultConfirmed: true })).ok).toBe(true);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

async function confirmNight() {
  const response = await confirm(request({ kind: "night_outcome", value: report }));
  expect(response.status).toBe(201);
  expect((await response.json()).memory.provenance).toBe("user_confirmed");
}

describe("owner-bound returning conversation", () => {
  it("confirms a real report, opens a fresh conversation and retains it for Yes without turning the bill into a pint budget", async () => {
    expect((await (await opening()).json()).answer).not.toContain("Crown");
    await confirmNight();
    const response = await opening();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    const second = await response.json();
    expect(second.answer).toContain(report);
    expect(second.answer).toContain("Something similar tonight?");
    const stored = await readOwnedPubPalToolTurn(second.conversationId, "owner-a");
    expect(stored?.turns).toEqual([{ role: "assistant", content: second.answer }]);
    {
      const followUp = await POST(request({ query: "Yes", threadId: second.conversationId }));
      expect(followUp.status).toBe(200);
      const body = await followUp.json();
      expect(body.answer).toContain(report);
      expect(body.answer).toContain("Which area and price per pint");
      expect(body.answer).not.toContain("£26.80 a pint");
      expect(body.cards).toEqual([]);
    }
    const repeated = await (await POST(request({ query: "Something similar", threadId: second.conversationId }))).json();
    expect(repeated.answer).not.toContain(report);
    expect(repeated.answer).not.toContain("Which area and price per pint");
    state.owner = "owner-b";
    const other = await (await opening()).json();
    expect(other.answer).not.toContain("Crown");
    expect(other.answer).not.toContain("£26.80");
    expect(await readOwnedPubPalToolTurn(second.conversationId, "owner-b")).toBeNull();
    const refusedContext = await (await POST(request({ query: "Something similar", threadId: second.conversationId }))).json();
    expect(refusedContext.answer).not.toContain("Crown");
    expect(refusedContext.answer).not.toContain("£26.80");
  });

  it.each([false, true])("answers a first typed greeting without a paid lookup, configured: %s", async (configured) => {
    if (configured) {
      vi.stubEnv("ELEVENLABS_API_KEY", "controlled-test-key");
      vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "controlled-test-agent");
    }
    const provider = vi.fn<typeof fetch>(async () => { throw new Error("No provider lookup is needed for a greeting"); });
    vi.stubGlobal("fetch", provider);
    await confirmNight();
    const response = await POST(request({ query: "Hi" }));
    expect(response.status).toBe(200);
    expect((await response.json()).answer).toContain(report);
    expect(provider).not.toHaveBeenCalled();
  });

  it("does not greet with unconfirmed or inferred history", async () => {
    expect((await (await opening()).json()).answer).not.toContain(report);
    await confirmNight();
    state.inferred = true;
    expect((await (await opening()).json()).answer).not.toContain(report);
  });

  it("honours the history opt-out and distinguishes unavailable reads", async () => {
    await confirmNight();
    await updatePubPalResult("owner-a", { proposalPreferences: { taste: false } });
    expect((await (await opening()).json()).answer).not.toContain("Crown");
    await updatePubPalResult("owner-a", { proposalPreferences: { taste: true } });
    state.unavailable = true;
    const body = await (await opening()).json();
    expect(body.answer).toContain("could not read your saved memories");
    expect(body.answer).not.toContain("none");
    expect(body.answer).not.toContain("Crown");
  });

  it("attributes a newly reported older visit without combining it with another night's spend", async () => {
    await confirmNight();
    const older = "I visited The Lamb on 1 September 2026, drank cask ale and spent £15 in total.";
    expect((await confirm(request({ kind: "night_outcome", value: older }))).status).toBe(201);
    const answer = (await (await opening()).json()).answer;
    expect(answer).toContain(`You told me: "${older}"`);
    expect(answer).not.toContain("Last time");
    expect(answer).not.toContain("Crown");
    expect(answer).not.toContain("£26.80");
  });

  it("refuses an anonymous opening before reading personal records", async () => {
    state.owner = null;
    expect((await opening()).status).toBe(401);
  });

  it("retires the opening after a substantive request and cannot capture a later Yes", async () => {
    await confirmNight();
    const initial = await (await opening()).json();
    await POST(request({ query: "Yes", threadId: initial.conversationId }));
    const pubs = await (await POST(request({ query: "Find four pubs in Soho", threadId: initial.conversationId }))).json();
    expect(pubs.cards).toHaveLength(4);
    const later = await (await POST(request({ query: "Yes", threadId: initial.conversationId }))).json();
    expect(later.answer).not.toContain(report);
    expect(later.answer).not.toContain("Which area and price per pint");
  });

  it("records the first ordinary owned question once after an opening", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "controlled-test-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "controlled-test-agent");
    await confirmNight();
    const initial = await (await opening()).json();
    const query = "Wine prices at Fox and Anchor this evening?";
    const response = await POST(request({ query, threadId: initial.conversationId }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.toolsUsed).toEqual(["venue_drinks"]);
    expect(body.answer).not.toContain(report);
    expect(body.conversationId).toBe(initial.conversationId);
    const stored = await readOwnedPubPalToolTurn(body.conversationId, "owner-a");
    expect(stored?.query).toBe(query);
    expect(stored?.turns).toEqual([{ role: "assistant", content: initial.answer }]);
  });

  it("keeps the get-home fence after a personal opening, a get-home ask and Yes with the old thread", async () => {
    vi.stubEnv("ELEVENLABS_API_KEY", "controlled-test-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "controlled-test-agent");
    await confirmNight();
    const initial = await (await opening()).json();
    const home = await (await POST(request({ query: "Help me get home", threadId: initial.conversationId }))).json();
    expect(home.answer).toContain("Getting Home");
    const later = await (await POST(request({ query: "Yes", threadId: initial.conversationId, turns: [
      { role: "assistant", content: initial.answer },
      { role: "user", content: "Help me get home" },
      { role: "assistant", content: home.answer },
    ] }))).json();
    expect(later.answer).toContain("Getting Home");
    expect(later.answer).not.toContain("Which area and price per pint");
    expect(later.answer).not.toContain(report);
  });

  it("limits an opening before authentication or personal reads", async () => {
    state.limited = true;
    vi.mocked(isLimited).mockClear();
    const personalRead = vi.spyOn(palStore, "getPubPalResult");
    const persist = vi.spyOn(turnStore, "registerPubPalToolTurn");
    const response = await opening();
    expect(response.status).toBe(429);
    expect(state.authReads).toBe(0);
    expect(state.memoryReads).toBe(0);
    expect(personalRead).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(isLimited).toHaveBeenCalledWith(expect.stringMatching(/^pub-pal-chat:/), expect.any(String), 20, 60_000, { failClosed: true });
  });
});
