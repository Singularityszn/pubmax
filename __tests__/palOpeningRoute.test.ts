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
import * as venueStore from "@/lib/concierge/venues.server";
import * as supabase from "@/lib/supabase";

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
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

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

  it.each([false, true])("keeps the get-home fence after a personal opening and Yes, configured: %s", async (configured) => {
    vi.stubEnv("ELEVENLABS_API_KEY", configured ? "controlled-test-key" : "");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", configured ? "controlled-test-agent" : "");
    await confirmNight();
    const initial = await (await opening()).json();
    const requests = vi.spyOn(globalThis, "fetch");
    const priorRead = vi.spyOn(turnStore, "readOwnedPubPalToolTurn").mockRejectedValue(new Error("Unavailable history"));
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
    expect(requests).not.toHaveBeenCalled();
    expect(priorRead).not.toHaveBeenCalled();
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


describe("configured chat request deadline", () => {
  beforeEach(() => {
    vi.stubEnv("ELEVENLABS_API_KEY", "controlled-test-key");
    vi.stubEnv("ELEVENLABS_PUB_PAL_AGENT_ID", "controlled-test-agent");
    vi.stubEnv("TYPESAFE_API_KEY", "");
  });

  const deadlineRequest = (query: string, stream: boolean, threadId?: string) => new Request(
    "http://localhost/api/pub-pal/chat", {
      method: "POST",
      headers: { "content-type": "application/json", ...(stream ? { accept: "application/x-ndjson" } : {}) },
      body: JSON.stringify({ query, threadId }),
    },
  );

  it.each(
    (["records", "provider", "provider-metadata"] as const).flatMap((path) =>
      [false, true].flatMap((stream) => [500, 2_000].map((lookupMs) => ({ path, stream, lookupMs })))),
  )("prevents expired runner registration writes, path: $path, stream: $stream, lookup: $lookupMs ms", async ({ path, stream, lookupMs }) => {
    if (path === "records") {
      const venues = await venueStore.loadConciergeVenues("london");
      vi.spyOn(venueStore, "loadConciergeVenues").mockResolvedValue(venues);
    }
    const threadId = "conv_registrationprior01";
    await turnStore.registerPubPalToolTurn(threadId, {
      ownerId: "owner-a", cityId: "london", query: "Find four pubs in Soho", turns: [], summary: "",
    });
    const prior = (await readOwnedPubPalToolTurn(threadId, "owner-a"))!;
    const initialRow = {
      conversation_id: threadId, owner_id: "owner-a", payload: { ...prior, surface: "text" },
      expires_at: new Date(prior.expiresAt).toISOString(),
    };
    const rows = new Map([[threadId, initialRow]]);
    const signedId = "conv_registrationprovider01";
    const metadataId = path === "provider-metadata" ? "conv_registrationmetadata01" : signedId;
    const delayedId = path === "records" ? threadId : metadataId;
    let preparationRead = true;
    let registrationRead = true;
    const upsert = vi.fn(async (row: typeof initialRow) => {
      rows.set(row.conversation_id, structuredClone(row));
      return { error: null };
    });
    vi.spyOn(supabase, "requireSupabaseAdmin").mockReturnValue({
      from: () => {
        let id = "";
        const selection = {
          eq: (_column: string, value: string) => { id = value; return selection; },
          gt: () => selection,
          maybeSingle: async () => {
            let delay = 0;
            if (preparationRead) {
              preparationRead = false;
              delay = 21_000;
            } else if (id === delayedId && registrationRead) {
              registrationRead = false;
              delay = lookupMs;
            }
            if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
            return { data: structuredClone(rows.get(id) ?? null), error: null };
          },
        };
        return { select: () => selection, upsert };
      },
    } as unknown as ReturnType<typeof supabase.requireSupabaseAdmin>);
    vi.spyOn(supabase, "isSupabaseConfigured").mockReturnValue(true);
    state.unavailable = true;
    const provider = vi.fn(async () => Response.json({
      signed_url: `wss://api.elevenlabs.io/v1/convai/conversation?conversation_id=${signedId}`,
    }));
    vi.stubGlobal("fetch", provider);
    const close = vi.fn();
    const sent: Array<{ type: string }> = [];
    const socket = vi.fn();
    vi.stubGlobal("WebSocket", class {
      private listeners: Record<string, Array<(event: unknown) => void>> = {};
      constructor() {
        socket();
        queueMicrotask(() => {
          this.emit("open", {});
          this.emit("message", { data: JSON.stringify({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { conversation_id: metadataId } }) });
        });
      }
      private emit(type: string, event: unknown) {
        for (const listener of this.listeners[type] ?? []) listener(event);
      }
      addEventListener(type: string, listener: (event: unknown) => void) {
        (this.listeners[type] ??= []).push(listener);
      }
      send(raw: string) {
        const payload = JSON.parse(raw);
        sent.push(payload);
        if (payload.type === "user_message") {
          this.emit("message", { data: JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "A useful sourced reply." } }) });
          this.emit("message", { data: JSON.stringify({ type: "agent_response_complete" }) });
        }
      }
      close() { close(); }
    });
    vi.useFakeTimers();
    let completed: { response: Response; body: string } | undefined;
    const pending = POST(deadlineRequest(path === "records" ? "Cheap pints near Soho" : "Find four quiet pubs in Soho", stream, threadId))
      .then(async (response) => { completed = { response, body: await response.text() }; });
    await vi.advanceTimersByTimeAsync(21_000);
    expect(completed).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(completed).toBeDefined();
    await pending;
    const late = lookupMs === 2_000;
    const isProvider = path !== "records";
    expect(completed!.response.status).toBe(late && isProvider && !stream ? 503 : 200);
    const events = completed!.body.trim().split("\n").map((line) => JSON.parse(line));
    if (late && isProvider) {
      expect(events).toEqual([expect.objectContaining(stream ? { type: "error" } : { code: "UNAVAILABLE" })]);
    } else {
      const body = stream ? events.at(-1).body : events[0];
      if (isProvider) {
        expect(body.answer).toBe("A useful sourced reply.");
        expect(body.conversationId).toBe(metadataId);
      } else {
        expect(body.cards).toHaveLength(4);
        expect(body.conversationId).toBe(late ? "" : threadId);
        expect(body.answer.includes("Conversation history could not be kept")).toBe(late);
      }
    }
    const writesAtDeadline = upsert.mock.calls.length;
    const sentAtDeadline = sent.length;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(upsert).toHaveBeenCalledTimes(writesAtDeadline);
    expect(sent).toHaveLength(sentAtDeadline);
    if (late) {
      expect(await readOwnedPubPalToolTurn(threadId, "owner-a")).toEqual(prior);
      if (isProvider) expect(await readOwnedPubPalToolTurn(metadataId, "owner-a")).toBeNull();
    } else {
      expect((await readOwnedPubPalToolTurn(delayedId, "owner-a"))?.query)
        .toBe(isProvider ? "Find four quiet pubs in Soho" : "Cheap pints near Soho");
    }
    expect(upsert).toHaveBeenCalledTimes((path === "provider-metadata" ? 1 : 0) + (late ? 0 : 1));
    expect(provider).toHaveBeenCalledTimes(isProvider ? 1 : 0);
    expect(socket).toHaveBeenCalledTimes(isProvider ? 1 : 0);
    expect(close).toHaveBeenCalledTimes(isProvider ? 1 : 0);
    expect(sent.filter((event) => event.type === "user_message")).toHaveLength(isProvider && !late ? 1 : 0);
  });

  it.each([false, true])("settles an owned records follow-up and ignores a late venue read, stream: %s", async (stream) => {
    const threadId = "conv_recordsdeadline01";
    await turnStore.registerPubPalToolTurn(threadId, {
      ownerId: "owner-a", cityId: "london", query: "Find four pubs in Soho", turns: [], summary: "",
    });
    const prior = await readOwnedPubPalToolTurn(threadId, "owner-a");
    const venues = await venueStore.loadConciergeVenues("london");
    let release!: (value: typeof venues) => void;
    const venueRead = new Promise<typeof venues>((resolve) => { release = resolve; });
    vi.spyOn(venueStore, "loadConciergeVenues").mockReturnValue(venueRead);
    vi.spyOn(turnStore, "readOwnedPubPalToolTurn").mockImplementationOnce(() => new Promise((resolve) => {
      setTimeout(() => resolve(prior), 21_000);
    }));
    const persist = vi.spyOn(turnStore, "registerPubPalToolTurn");
    const provider = vi.spyOn(globalThis, "fetch");
    vi.useFakeTimers();
    let completed: { response: Response; body: string } | undefined;
    const pending = POST(deadlineRequest("Same area, but under £6.50 a pint.", stream, threadId)).then(async (response) => {
      completed = { response, body: await response.text() };
    });
    await vi.advanceTimersByTimeAsync(21_000);
    expect(completed).toBeUndefined();
    await vi.advanceTimersByTimeAsync(1_000);
    const atDeadline = completed;
    release(venues);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(persist).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(atDeadline).toBeDefined();
    await pending;
    expect(completed!.response.status).toBe(stream ? 200 : 503);
    expect(JSON.parse(completed!.body)).toMatchObject(stream ? { type: "error" } : { code: "UNAVAILABLE" });
    expect((await readOwnedPubPalToolTurn(threadId, "owner-a"))?.query).toBe("Find four pubs in Soho");
  });

  it.each([false, true])("caps a records history write at the remaining turn budget, stream: %s", async (stream) => {
    const venues = await venueStore.loadConciergeVenues("london");
    let venueRead: Promise<typeof venues> | undefined;
    vi.spyOn(venueStore, "loadConciergeVenues").mockImplementation(() => venueRead ??= new Promise((resolve) => {
      setTimeout(() => resolve(venues), 21_500);
    }));
    const persist = vi.spyOn(turnStore, "registerPubPalToolTurn").mockImplementation(() => new Promise(() => {}));
    const provider = vi.spyOn(globalThis, "fetch");
    vi.useFakeTimers();
    let completed: { response: Response; body: string } | undefined;
    const pending = POST(deadlineRequest("Cheap pints near Soho", stream)).then(async (response) => {
      completed = { response, body: await response.text() };
    });
    await vi.advanceTimersByTimeAsync(21_500);
    expect(completed).toBeUndefined();
    expect(persist).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(500);
    expect(completed).toBeDefined();
    await pending;
    expect(completed!.response.status).toBe(200);
    const event = JSON.parse(completed!.body);
    const body = stream ? event.body : event;
    expect(body.cards).toHaveLength(4);
    expect(body.answer).toContain("Conversation history could not be kept");
    expect(body.conversationId).toBe("");
    expect(provider).not.toHaveBeenCalled();
  });

  it.each(
    [false, true].flatMap((stream) => [false, true].flatMap((toolsRan) => [false, true].flatMap((stalled) =>
      (stalled ? [false, true] : [false]).map((readbackFirst) => ({ stream, toolsRan, stalled, readbackFirst }))))),
  )(
    "settles provider readback before the deadline, stream: $stream, tools: $toolsRan, stalled: $stalled, readback first: $readbackFirst",
    async ({ stream, toolsRan, stalled, readbackFirst }) => {
      const signedUrl = "wss://api.elevenlabs.io/v1/convai/conversation?conversation_id=conv_deadlineprovider01";
      const provider = vi.fn(async () => Response.json({ signed_url: signedUrl }));
      vi.stubGlobal("fetch", provider);
      const readback = { query: "Find four quiet pubs in Soho", cityId: "london" as const, turns: [], summary: "", expiresAt: Date.now() + 60_000,
        cards: [{ key: "crown", venueId: "venue-crown", title: "The Crown", place: "Soho", note: "Listed pint", price: 4.8 }],
        proposals: [], hints: [], toolsUsed: ["search_venues"],
      };
      let releaseReadback!: (turn: typeof readback | null) => void;
      const read = vi.spyOn(turnStore, "readPubPalToolTurn").mockImplementation(() => stalled
        ? new Promise<typeof readback | null>((resolve) => { releaseReadback = resolve; })
        : Promise.resolve(readback));
      const close = vi.fn();
      const sent: unknown[] = [];
      let emit!: (type: string, payload: unknown) => void;
      vi.stubGlobal("WebSocket", class {
        private listeners: Record<string, Array<(event: unknown) => void>> = {};
        constructor() {
          emit = (type, payload) => {
            for (const listener of this.listeners[type] ?? []) listener(payload);
          };
          queueMicrotask(() => {
            emit("open", {});
            emit("message", { data: JSON.stringify({ type: "conversation_initiation_metadata", conversation_initiation_metadata_event: { conversation_id: "conv_deadlineprovider01" } }) });
          });
        }
        addEventListener(type: string, listener: (event: unknown) => void) {
          (this.listeners[type] ??= []).push(listener);
        }
        send(raw: string) {
          const payload = JSON.parse(raw);
          sent.push(payload);
          if (payload.type === "user_message") setTimeout(() => {
            if (toolsRan) {
              emit("message", { data: JSON.stringify({ type: "agent_tool_request", agent_tool_request: { tool_call_id: "call_1" } }) });
              emit("message", { data: JSON.stringify({ type: "agent_tool_response", agent_tool_response: { tool_call_id: "call_1" } }) });
            }
            emit("message", { data: JSON.stringify({ type: "agent_response", agent_response_event: { agent_response: "A useful sourced reply." } }) });
            emit("message", { data: JSON.stringify({ type: "agent_response_complete" }) });
          }, 21_500);
        }
        close() { close(); }
      });
      vi.useFakeTimers();
      let completed: { response: Response; body: string } | undefined;
      const pending = POST(deadlineRequest("Find four quiet pubs in Soho", stream)).then(async (response) => {
        completed = { response, body: await response.text() };
      });
      await vi.advanceTimersByTimeAsync(21_900);
      if (stalled) expect(completed).toBeUndefined();
      expect(read).toHaveBeenCalledTimes(1);
      if (readbackFirst) {
        // The clock can reach expiry before the event loop runs the main timer.
        // Complete the store read then, so its deadline check settles first.
        vi.setSystemTime(Date.now() + 100);
        releaseReadback(null);
        await vi.advanceTimersByTimeAsync(0);
      }
      await vi.advanceTimersByTimeAsync(100);
      expect(completed).toBeDefined();
      expect(close).toHaveBeenCalledTimes(1);
      await pending;
      expect(completed!.response.status).toBe(200);
      const event = JSON.parse(completed!.body);
      const body = stream ? event.body : event;
      expect(body.answer).toBe("A useful sourced reply.");
      expect(body.cards).toEqual(stalled ? [] : readback.cards);
      expect(body.toolsUsed).toEqual(stalled ? [] : ["search_venues"]);
      const sentAtDeadline = sent.length;
      emit("open", {});
      emit("message", { data: JSON.stringify({ type: "ping" }) });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(sent).toHaveLength(sentAtDeadline);
      expect(read).toHaveBeenCalledTimes(1);
      expect(provider).toHaveBeenCalledTimes(1);
    },
  );

  it.each([false, true])("settles a stalled signed URL body without late provider work, stream: %s", async (stream) => {
    let release!: () => void;
    const provider = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        release = () => {
          controller.enqueue(new TextEncoder().encode(JSON.stringify({ signed_url: "wss://api.elevenlabs.io/v1/convai/conversation?conversation_id=conv_latesignedurl01" })));
          controller.close();
        };
      },
    })));
    vi.stubGlobal("fetch", provider);
    const socket = vi.fn();
    vi.stubGlobal("WebSocket", socket);
    const persist = vi.spyOn(turnStore, "registerPubPalToolTurn");
    vi.useFakeTimers();
    let completed: { response: Response; body: string } | undefined;
    const pending = POST(deadlineRequest("Find four quiet pubs in Soho", stream)).then(async (response) => {
      completed = { response, body: await response.text() };
    });
    await vi.advanceTimersByTimeAsync(22_000);
    expect(completed).toBeDefined();
    await pending;
    expect(completed!.response.status).toBe(stream ? 200 : 503);
    expect(JSON.parse(completed!.body)).toMatchObject(stream ? { type: "error" } : { code: "UNAVAILABLE" });
    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(socket).not.toHaveBeenCalled();
    expect(persist).not.toHaveBeenCalled();
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("reuses the prepared owned opening instead of a second history read, stream: %s", async (stream) => {
    await confirmNight();
    const initial = await (await opening()).json();
    const prior = await readOwnedPubPalToolTurn(initial.conversationId, "owner-a");
    const read = vi.spyOn(turnStore, "readOwnedPubPalToolTurn")
      .mockResolvedValueOnce(prior).mockImplementation(() => new Promise(() => {}));
    const provider = vi.spyOn(globalThis, "fetch");
    state.authReads = 0;
    vi.useFakeTimers();
    let response: Response | undefined;
    const pending = POST(deadlineRequest("Yes", stream, initial.conversationId)).then((value) => { response = value; });
    await vi.advanceTimersByTimeAsync(22_000);
    expect(response).toBeDefined();
    await pending;
    expect(response!.status).toBe(200);
    expect((await response!.json()).answer).toContain("Which area and price per pint");
    expect(read).toHaveBeenCalledTimes(1);
    expect(state.authReads).toBe(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([false, true])("times out a greeting read and does not write when it resolves late, stream: %s", async (stream) => {
    const pal = await palStore.getPubPalResult("owner-a");
    let release!: (value: typeof pal) => void;
    vi.spyOn(palStore, "getPubPalResult").mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const persist = vi.spyOn(turnStore, "registerPubPalToolTurn");
    const provider = vi.spyOn(globalThis, "fetch");
    vi.useFakeTimers();
    let response: Response | undefined;
    const pending = POST(deadlineRequest("Hi", stream)).then((value) => { response = value; });
    await vi.advanceTimersByTimeAsync(22_000);
    expect(response).toBeDefined();
    await pending;
    expect(response!.status).toBe(503);
    expect((await response!.json()).code).toBe("UNAVAILABLE");
    release(pal);
    await vi.advanceTimersByTimeAsync(0);
    expect(persist).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([
    { stream: false, lookupMs: 21_000 },
    { stream: true, lookupMs: 21_000 },
    { stream: false, lookupMs: 23_000 },
    { stream: true, lookupMs: 23_000 },
  ])("completes opening registration only before expiry, stream: $stream, lookup: $lookupMs ms", async ({ stream, lookupMs }) => {
    await confirmNight();
    const initial = await (await opening()).json();
    const prior = (await readOwnedPubPalToolTurn(initial.conversationId, "owner-a"))!;
    let row = {
      conversation_id: initial.conversationId,
      owner_id: "owner-a",
      payload: { ...prior, surface: "text" },
      expires_at: new Date(prior.expiresAt).toISOString(),
    };
    const lookup = vi.fn().mockResolvedValueOnce({ data: structuredClone(row), error: null })
      .mockImplementationOnce(() => new Promise((resolve) => {
        setTimeout(() => resolve({ data: structuredClone(row), error: null }), lookupMs);
      }))
      .mockImplementation(async () => ({ data: structuredClone(row), error: null }));
    const upsert = vi.fn(async (value: typeof row) => { row = structuredClone(value); return { error: null }; });
    const selection = { eq: () => selection, gt: () => selection, maybeSingle: lookup };
    vi.spyOn(supabase, "requireSupabaseAdmin").mockReturnValue({
      from: () => ({ select: () => selection, upsert }),
    } as unknown as ReturnType<typeof supabase.requireSupabaseAdmin>);
    vi.spyOn(supabase, "isSupabaseConfigured").mockReturnValue(true);
    const provider = vi.spyOn(globalThis, "fetch");
    vi.useFakeTimers();
    let completed: { response: Response; body: string } | undefined;
    const pending = POST(deadlineRequest("Yes", stream, initial.conversationId)).then(async (response) => {
      completed = { response, body: await response.text() };
    });
    await vi.advanceTimersByTimeAsync(22_000);
    expect(completed).toBeDefined();
    await pending;
    expect(completed!.response.status).toBe(lookupMs < 22_000 ? 200 : 503);
    if (lookupMs < 22_000) {
      expect(JSON.parse(completed!.body).answer).toContain("Which area and price per pint");
    } else {
      expect(JSON.parse(completed!.body)).toMatchObject({ code: "UNAVAILABLE" });
    }
    await vi.advanceTimersByTimeAsync(1_000);
    const stored = await readOwnedPubPalToolTurn(initial.conversationId, "owner-a");
    if (lookupMs < 22_000) {
      expect(stored).toMatchObject({ query: "Yes", turns: prior.turns, hints: [JSON.parse(completed!.body).answer] });
      expect(upsert).toHaveBeenCalledTimes(1);
    } else {
      expect(stored).toEqual(prior);
      expect(upsert).not.toHaveBeenCalled();
    }
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([false, true])("times out a pending opening write without starting a provider, stream: %s", async (stream) => {
    const persist = vi.spyOn(turnStore, "registerPubPalToolTurn").mockImplementation(() => new Promise(() => {}));
    const provider = vi.spyOn(globalThis, "fetch");
    vi.useFakeTimers();
    let response: Response | undefined;
    const pending = POST(deadlineRequest("Hi", stream)).then((value) => { response = value; });
    await vi.advanceTimersByTimeAsync(22_000);
    expect(response).toBeDefined();
    await pending;
    expect(response!.status).toBe(503);
    expect(persist).toHaveBeenCalledTimes(1);
    expect(provider).not.toHaveBeenCalled();
  });

  it.each([false, true])("times out paid admission and cannot start a provider after late admission, stream: %s", async (stream) => {
    let release!: (value: boolean) => void;
    vi.mocked(isLimited).mockResolvedValueOnce(false).mockImplementationOnce(() => new Promise((resolve) => { release = resolve; }));
    const provider = vi.spyOn(globalThis, "fetch");
    vi.useFakeTimers();
    let response: Response | undefined;
    const pending = POST(deadlineRequest("Find four quiet pubs in Soho", stream)).then((value) => { response = value; });
    await vi.advanceTimersByTimeAsync(22_000);
    expect(response).toBeDefined();
    await pending;
    expect(response!.status).toBe(503);
    release(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(provider).not.toHaveBeenCalled();
  });
});
