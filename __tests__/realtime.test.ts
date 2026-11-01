import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Realtime helper (issue #37). Two things matter and are unit-testable
// without a live socket:
//   1. countSpillingNow — a pure recency counter.
//   2. The SIGNAL-ONLY contract: on a private broadcast the helper invokes the
//      caller's nudge and NEVER hands over a payload (which would leak a
//      hidden/anonymous drop, bypassing #29). We assert this with a fake
//      channel that captures the registered handler and fires it with a raw
//      row — the nudge must receive NOTHING from that row.
//
// authClient is mocked so no real Supabase env / browser is needed.

// ── Fake browser client + channel ────────────────────────────────────────────
type ChangeHandler = (payload: unknown) => void;

let capturedHandler: ChangeHandler | null = null;
let capturedEvent: string | null = null;
let capturedChannel: { name: string; privateChannel: boolean | undefined } | null = null;
let subscribeCb: ((status: string) => void) | null = null;
let removed = false;
let initialSession: object | null = {};
let authChanged: ((_event: string, session: object | null) => void) | null = null;
let authRemoved = false;
let clientReady = true;
let loadClient = () => Promise.resolve(fakeSupabase);

function makeFakeChannel() {
  return {
    on(event: string, _filter: unknown, handler: ChangeHandler) {
      capturedEvent = event;
      capturedHandler = handler;
      return this;
    },
    subscribe(cb: (status: string) => void) {
      subscribeCb = cb;
      return this;
    },
  };
}

const fakeSupabase = {
  auth: {
    onAuthStateChange(callback: (_event: string, session: object | null) => void) {
      authChanged = callback;
      queueMicrotask(() => callback("INITIAL_SESSION", initialSession));
      return { data: { subscription: { unsubscribe: () => { authRemoved = true; } } } };
    },
  },
  channel: (name: string, opts?: { config?: { private?: boolean } }) => {
    capturedChannel = { name, privateChannel: opts?.config?.private };
    return makeFakeChannel();
  },
  removeChannel: () => {
    removed = true;
  },
};

vi.mock("@/lib/authClient", () => ({
  getSupabaseBrowser: () => clientReady ? fakeSupabase : null,
  ensureSupabaseBrowser: () => loadClient(),
  isAuthConfigured: () => true,
}));

// Imported AFTER the mock is registered.
import { PINT_DROPS_LIVE_EVENT, PINT_DROPS_LIVE_TOPIC } from "@/lib/pintDropsTopics";
import {
  countSpillingNow,
  SPILLING_NOW_WINDOW_MIN,
  subscribeToComments,
  subscribeToNewDrops,
} from "@/lib/realtime";

beforeEach(() => {
  vi.stubGlobal("window", {});
  initialSession = {};
  authChanged = null;
  authRemoved = false;
  clientReady = true;
  loadClient = () => Promise.resolve(fakeSupabase);
  capturedHandler = null;
  capturedEvent = null;
  capturedChannel = null;
  subscribeCb = null;
  removed = false;
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("countSpillingNow (pure)", () => {
  const now = Date.parse("2026-07-06T22:00:00.000Z");
  const minsAgo = (m: number) => new Date(now - m * 60_000).toISOString();

  it("counts only drops within the window", () => {
    const drops = [
      { createdAt: minsAgo(5) }, // in
      { createdAt: minsAgo(59) }, // in
      { createdAt: minsAgo(61) }, // out (older than 60m)
    ];
    expect(countSpillingNow(drops, now)).toBe(2);
  });

  it("uses the default 60-minute window", () => {
    expect(SPILLING_NOW_WINDOW_MIN).toBe(60);
    const drops = [{ createdAt: minsAgo(30) }];
    expect(countSpillingNow(drops, now)).toBe(1);
  });

  it("ignores bad, missing, and future timestamps (no inflation)", () => {
    const drops = [
      { createdAt: "not-a-date" },
      { createdAt: null },
      {},
      { createdAt: new Date(now + 60_000).toISOString() }, // future
      { createdAt: minsAgo(1) }, // the only valid one
    ];
    expect(countSpillingNow(drops, now)).toBe(1);
  });

  it("respects a custom window", () => {
    const drops = [{ createdAt: minsAgo(20) }];
    expect(countSpillingNow(drops, now, 10)).toBe(0);
    expect(countSpillingNow(drops, now, 30)).toBe(1);
  });
});

describe("subscribeToNewDrops — SIGNAL ONLY", () => {
  it("fires the nudge on a private broadcast WITHOUT passing the payload", async () => {
    const nudge = vi.fn();
    const unsub = subscribeToNewDrops(nudge);
    await vi.advanceTimersByTimeAsync(0);
    // Simulate a successful channel join so the watchdog is cancelled.
    subscribeCb?.("SUBSCRIBED");
    expect(capturedHandler).toBeTypeOf("function");
    expect(capturedEvent).toBe("broadcast");
    expect(capturedChannel).toEqual({
      name: PINT_DROPS_LIVE_TOPIC,
      privateChannel: true,
    });
    expect(PINT_DROPS_LIVE_EVENT).toBe("drop");

    // A payload must not become arguments, even when it carries the raw row.
    capturedHandler?.({
      eventType: "INSERT",
      new: { id: "d1", handle: "secret-user", visibility: "anonymous" },
    });

    // The nudge was called — but with NO arguments (signal, not content).
    expect(nudge).toHaveBeenCalledTimes(1);
    expect(nudge.mock.calls[0]).toHaveLength(0);

    unsub();
    expect(removed).toBe(true);
    expect(authRemoved).toBe(true);
  });

  it("falls back to polling on a 30s interval if the channel never joins", async () => {
    const poll = vi.fn();
    const unsub = subscribeToNewDrops(() => {}, { poll });
    await vi.advanceTimersByTimeAsync(0);
    // Never call subscribeCb('SUBSCRIBED') — let the join watchdog (5s) fire.
    vi.advanceTimersByTime(5_000);
    // Now the poll interval (30s) should be running.
    vi.advanceTimersByTime(30_000);
    expect(poll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(30_000);
    expect(poll).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("falls back to polling if the channel errors mid-session", async () => {
    const poll = vi.fn();
    const unsub = subscribeToNewDrops(() => {}, { poll });
    await vi.advanceTimersByTimeAsync(0);
    subscribeCb?.("SUBSCRIBED"); // joins fine
    subscribeCb?.("CHANNEL_ERROR"); // then drops
    vi.advanceTimersByTime(30_000);
    expect(poll).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("starts on the poll lane, joins after sign-in and detaches after sign-out", async () => {
    initialSession = null;
    const nudge = vi.fn();
    const poll = vi.fn();
    const unsub = subscribeToNewDrops(nudge, { poll });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(capturedChannel).toBeNull();
    expect(poll).toHaveBeenCalledTimes(1);
    authChanged?.("SIGNED_IN", {});
    await vi.advanceTimersByTimeAsync(0);
    subscribeCb?.("SUBSCRIBED");
    expect(capturedChannel?.privateChannel).toBe(true);
    const previousSignal = capturedHandler;
    authChanged?.("SIGNED_OUT", null);
    await vi.advanceTimersByTimeAsync(0);
    previousSignal?.({});
    expect(removed).toBe(true);
    expect(nudge).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll).toHaveBeenCalledTimes(2);
    unsub();
  });

  it("upgrades a cold client to live delivery and stops its temporary poll", async () => {
    clientReady = false;
    let loaded!: (value: typeof fakeSupabase) => void;
    loadClient = () => new Promise((resolve) => { loaded = resolve; });
    const poll = vi.fn();
    const unsub = subscribeToNewDrops(vi.fn(), { poll });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll).toHaveBeenCalledTimes(1);
    loaded(fakeSupabase);
    await vi.advanceTimersByTimeAsync(0);
    subscribeCb?.("SUBSCRIBED");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("does not attach when the client finishes loading after cleanup", async () => {
    clientReady = false;
    let loaded!: (value: typeof fakeSupabase) => void;
    loadClient = () => new Promise((resolve) => { loaded = resolve; });
    const poll = vi.fn();
    const unsub = subscribeToNewDrops(vi.fn(), { poll });
    unsub();
    loaded(fakeSupabase);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(capturedChannel).toBeNull();
    expect(authChanged).toBeNull();
    expect(poll).not.toHaveBeenCalled();
  });

  it("ignores an auth event already queued when the caller unmounts", async () => {
    const unsub = subscribeToNewDrops(vi.fn(), { poll: vi.fn() });
    unsub();
    await vi.advanceTimersByTimeAsync(0);
    expect(capturedChannel).toBeNull();
    expect(authRemoved).toBe(true);
  });
});

describe("subscribeToComments", () => {
  beforeEach(() => {
    vi.stubGlobal("window", {});
  });

  it("is a no-op for a falsy dropId", () => {
    const nudge = vi.fn();
    const unsub = subscribeToComments("", nudge);
    expect(capturedHandler).toBeNull();
    expect(() => unsub()).not.toThrow();
  });

  it("is a no-op when enabled is false (gated drop — no refetch subscription)", () => {
    const nudge = vi.fn();
    const unsub = subscribeToComments("drop-1", nudge, { enabled: false });
    expect(capturedHandler).toBeNull();
    expect(() => unsub()).not.toThrow();
  });

  it("polls the filtered API even when a Realtime channel could report subscribed", () => {
    const nudge = vi.fn();
    const unsub = subscribeToComments("drop-1", nudge);

    expect(capturedHandler).toBeNull();
    expect(subscribeCb).toBeNull();
    vi.advanceTimersByTime(30_000);
    expect(nudge).toHaveBeenCalledTimes(1);
    expect(nudge.mock.calls[0]).toHaveLength(0);

    unsub();
    vi.advanceTimersByTime(30_000);
    expect(nudge).toHaveBeenCalledTimes(1);
  });

  it("uses an explicit filtered-API poll callback when supplied", () => {
    const nudge = vi.fn();
    const poll = vi.fn();
    const unsub = subscribeToComments("drop-1", nudge, { poll });

    vi.advanceTimersByTime(30_000);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(nudge).not.toHaveBeenCalled();
    unsub();
  });

  it("does not retain a polling timer during server rendering", () => {
    vi.unstubAllGlobals();
    const nudge = vi.fn();
    const unsub = subscribeToComments("drop-1", nudge);

    vi.advanceTimersByTime(60_000);
    expect(nudge).not.toHaveBeenCalled();
    expect(() => unsub()).not.toThrow();
  });
});

describe("subscribeToNewDrops: a hidden tab and the live channel", () => {
  type FakeDocument = EventTarget & { visibilityState: "visible" | "hidden" };
  let page: FakeDocument;

  function setVisibility(state: "visible" | "hidden") {
    page.visibilityState = state;
    page.dispatchEvent(new Event("visibilitychange"));
  }

  async function coldClientHiddenTickThenJoin(poll: () => void) {
    page = Object.assign(new EventTarget(), { visibilityState: "visible" as const });
    vi.stubGlobal("document", page);
    clientReady = false;
    let loaded!: (value: typeof fakeSupabase) => void;
    loadClient = () => new Promise((resolve) => { loaded = resolve; });
    const unsub = subscribeToNewDrops(vi.fn(), { poll });
    setVisibility("hidden");
    await vi.advanceTimersByTimeAsync(30_000);
    expect(poll).not.toHaveBeenCalled();
    loaded(fakeSupabase);
    await vi.advanceTimersByTimeAsync(0);
    subscribeCb?.("SUBSCRIBED");
    return unsub;
  }

  it("runs a poll the hidden tab held once on return, after the channel joined", async () => {
    const poll = vi.fn();
    const unsub = await coldClientHiddenTickThenJoin(poll);

    setVisibility("visible");
    expect(poll).toHaveBeenCalledTimes(1);

    // The channel carries changes from here on, so the poll does not resume.
    await vi.advanceTimersByTimeAsync(60_000);
    setVisibility("hidden");
    setVisibility("visible");
    expect(poll).toHaveBeenCalledTimes(1);
    unsub();
  });

  it("drops the held poll when the subscription is torn down first", async () => {
    const poll = vi.fn();
    const unsub = await coldClientHiddenTickThenJoin(poll);

    unsub();
    setVisibility("visible");
    expect(poll).not.toHaveBeenCalled();
  });
});
