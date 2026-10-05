// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getSupabaseBrowser, ensureSupabaseBrowser, isAuthConfigured } = vi.hoisted(() => ({
  getSupabaseBrowser: vi.fn(),
  ensureSupabaseBrowser: vi.fn(),
  isAuthConfigured: vi.fn(),
}));

vi.mock("@/lib/authClient", () => ({
  getSupabaseBrowser,
  ensureSupabaseBrowser,
  isAuthConfigured,
}));

import {
  INBOX_POLL_FALLBACK_MS,
  MESSAGES_POLL_FALLBACK_MS,
  MESSAGES_POLL_LIVE_MS,
  MESSAGES_REATTACH_MAX_ATTEMPTS,
  messagesReattachDelayMs,
  subscribeToInbox,
  subscribeToMessages,
} from "@/lib/messagesRealtime";
import { messagesInboxTopic, messagesThreadTopic } from "@/lib/messagesTopics";
import { defined } from "@/__tests__/helpers/defined";

type StatusCallback = (status: string) => void;
type SignalCallback = () => void;

function realtimeFixture(options?: { removeChannel?: (channel: unknown) => void }) {
  const signals = new Map<string, SignalCallback>();
  let status: StatusCallback = () => {};
  const channel = {
    on: vi.fn((_kind: string, filter: { event: string }, callback: SignalCallback) => {
      signals.set(filter.event, callback);
      return channel;
    }),
    subscribe: vi.fn((callback: StatusCallback) => {
      status = callback;
      return channel;
    }),
  };
  const removeChannel = vi.fn(options?.removeChannel ?? (() => {}));
  const client = {
    // Typed by its CALL SIGNATURE rather than its parameters: the topic and the
    // channel config are both part of what the subscriber promises, and the
    // assertions read them off `mock.calls`.
    channel: vi.fn<(topic: string, options?: { config?: { private?: boolean } }) => typeof channel>(
      () => channel,
    ),
    removeChannel,
  };
  return {
    channel,
    client,
    removeChannel,
    emit: (event: string) => signals.get(event)?.(),
    events: () => [...signals.keys()],
    emitStatus: (nextStatus: string) => status(nextStatus),
  };
}

let visibility: DocumentVisibilityState = "visible";

beforeEach(() => {
  vi.useFakeTimers();
  getSupabaseBrowser.mockReset();
  ensureSupabaseBrowser.mockReset();
  isAuthConfigured.mockReset();
  isAuthConfigured.mockReturnValue(true);
  ensureSupabaseBrowser.mockImplementation(() => new Promise(() => {}));
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => visibility,
  });
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

function hide(): void {
  visibility = "hidden";
  document.dispatchEvent(new Event("visibilitychange"));
}

function show(): void {
  visibility = "visible";
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("message realtime subscription", () => {
  it("returns a pure no-op for a missing conversation id", () => {
    const unsubscribe = subscribeToMessages("", vi.fn(), { poll: vi.fn() });

    unsubscribe();
    vi.advanceTimersByTime(60_000);
    expect(getSupabaseBrowser).not.toHaveBeenCalled();
  });

  it("polls on the fallback cadence when there is no public Supabase env, and says so", () => {
    const poll = vi.fn();
    const onStatus = vi.fn();
    isAuthConfigured.mockReturnValue(false);

    const unsubscribe = subscribeToMessages("conversation-1", vi.fn(), { poll, onStatus });

    expect(onStatus).toHaveBeenCalledWith("polling");
    vi.advanceTimersByTime(MESSAGES_POLL_FALLBACK_MS * 4);
    expect(poll).toHaveBeenCalledTimes(4);
    expect(getSupabaseBrowser).not.toHaveBeenCalled();

    unsubscribe();
    vi.advanceTimersByTime(MESSAGES_POLL_FALLBACK_MS * 2);
    expect(poll).toHaveBeenCalledTimes(4);
  });

  it("does nothing when realtime is unavailable and no poll fallback was supplied", () => {
    isAuthConfigured.mockReturnValue(false);

    const unsubscribe = subscribeToMessages("conversation-1", vi.fn());

    expect(() => unsubscribe()).not.toThrow();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("listens for BROADCAST signals on the thread topic, never a table row, and emits no payload", () => {
    const fixture = realtimeFixture();
    const onMessage = vi.fn();
    getSupabaseBrowser.mockReturnValue(fixture.client);

    const unsubscribe = subscribeToMessages("conversation-42", onMessage);

    expect(fixture.client.channel).toHaveBeenCalledWith(messagesThreadTopic("conversation-42"), {
      config: { private: true },
    });
    for (const call of fixture.channel.on.mock.calls) {
      expect(call[0]).toBe("broadcast");
    }
    expect(fixture.events().sort()).toEqual(["message", "read"]);

    fixture.emit("message");
    fixture.emit("read");
    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(onMessage).toHaveBeenCalledWith();

    unsubscribe();
    fixture.emit("message");
    expect(onMessage).toHaveBeenCalledTimes(2);
    expect(fixture.removeChannel).toHaveBeenCalledWith(fixture.channel);
  });

  it("goes live on SUBSCRIBED and keeps only the slow safety poll", () => {
    const fixture = realtimeFixture();
    const poll = vi.fn();
    const onStatus = vi.fn();
    getSupabaseBrowser.mockReturnValue(fixture.client);

    const unsubscribe = subscribeToMessages("conversation-1", vi.fn(), { poll, onStatus });
    expect(onStatus).toHaveBeenLastCalledWith("connecting");
    fixture.emitStatus("SUBSCRIBED");
    expect(onStatus).toHaveBeenLastCalledWith("live");

    vi.advanceTimersByTime(MESSAGES_POLL_LIVE_MS - 1);
    expect(poll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(fixture.removeChannel).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("falls back to the fast poll when the join times out, and on a channel error", () => {
    const fixture = realtimeFixture();
    const poll = vi.fn();
    const onStatus = vi.fn();
    getSupabaseBrowser.mockReturnValue(fixture.client);

    subscribeToMessages("conversation-1", vi.fn(), { poll, onStatus });
    vi.advanceTimersByTime(5_000);
    expect(onStatus).toHaveBeenLastCalledWith("polling");
    expect(fixture.removeChannel).toHaveBeenCalledWith(fixture.channel);

    // One poll already ran on the fallback cadence WHILE connecting, because a
    // reader waiting on a join must not wait for the join to see a message.
    expect(poll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(MESSAGES_POLL_FALLBACK_MS * 2);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("survives a synchronous CLOSED re-entry from removeChannel", () => {
    let statusCallback: StatusCallback = () => {};
    const fixture = realtimeFixture({
      removeChannel: () => statusCallback("CLOSED"),
    });
    fixture.channel.subscribe.mockImplementation((callback: StatusCallback) => {
      statusCallback = callback;
      return fixture.channel;
    });
    getSupabaseBrowser.mockReturnValue(fixture.client);

    subscribeToMessages("conversation-1", vi.fn(), { poll: vi.fn() });
    expect(() => statusCallback("CHANNEL_ERROR")).not.toThrow();
    expect(fixture.removeChannel).toHaveBeenCalledTimes(1);
  });

  it("polls while the client chunk loads, then upgrades to realtime when it lands", async () => {
    const fixture = realtimeFixture();
    const poll = vi.fn();
    const onStatus = vi.fn();
    let resolveClient: (client: unknown) => void = () => {};
    getSupabaseBrowser.mockReturnValue(null);
    ensureSupabaseBrowser.mockImplementation(
      () => new Promise((resolve) => {
        resolveClient = resolve;
      }),
    );

    subscribeToMessages("conversation-1", vi.fn(), { poll, onStatus });
    vi.advanceTimersByTime(MESSAGES_POLL_FALLBACK_MS);
    expect(poll).toHaveBeenCalledTimes(1);
    expect(fixture.client.channel).not.toHaveBeenCalled();

    resolveClient(fixture.client);
    await Promise.resolve();
    await Promise.resolve();
    expect(fixture.client.channel).toHaveBeenCalledWith(messagesThreadTopic("conversation-1"), {
      config: { private: true },
    });
    fixture.emitStatus("SUBSCRIBED");
    expect(onStatus).toHaveBeenLastCalledWith("live");
  });

  it("stops polling while the tab is hidden and refetches once the moment it is shown", () => {
    const poll = vi.fn();
    isAuthConfigured.mockReturnValue(false);

    subscribeToMessages("conversation-1", vi.fn(), { poll });
    vi.advanceTimersByTime(MESSAGES_POLL_FALLBACK_MS);
    expect(poll).toHaveBeenCalledTimes(1);

    hide();
    vi.advanceTimersByTime(MESSAGES_POLL_FALLBACK_MS * 10);
    expect(poll).toHaveBeenCalledTimes(1);

    show();
    expect(poll).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(MESSAGES_POLL_FALLBACK_MS);
    expect(poll).toHaveBeenCalledTimes(3);
  });

  it("removes its visibility listener on unsubscribe", () => {
    const poll = vi.fn();
    isAuthConfigured.mockReturnValue(false);

    const unsubscribe = subscribeToMessages("conversation-1", vi.fn(), { poll });
    unsubscribe();
    hide();
    show();
    expect(poll).not.toHaveBeenCalled();
  });
});

describe("inbox realtime subscription", () => {
  it("listens on the handle's inbox topic for message signals", () => {
    const fixture = realtimeFixture();
    const onSignal = vi.fn();
    getSupabaseBrowser.mockReturnValue(fixture.client);

    subscribeToInbox("ken", onSignal);

    expect(fixture.client.channel).toHaveBeenCalledWith(messagesInboxTopic("ken"), {
      config: { private: true },
    });
    expect(fixture.events()).toEqual(["message"]);
    fixture.emit("message");
    expect(onSignal).toHaveBeenCalledWith();
  });

  it("is a no-op for a blank handle and polls on its own slower cadence without env", () => {
    expect(vi.getTimerCount()).toBe(0);
    subscribeToInbox("", vi.fn(), { poll: vi.fn() });
    expect(vi.getTimerCount()).toBe(0);

    const poll = vi.fn();
    isAuthConfigured.mockReturnValue(false);
    subscribeToInbox("ken", vi.fn(), { poll });
    vi.advanceTimersByTime(INBOX_POLL_FALLBACK_MS - 1);
    expect(poll).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(poll).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-1 / fix task 32 - EVERY messaging channel is PRIVATE.
//
// A Supabase public channel authorises on the API key alone and this client is
// built from the public one, so a public `live:inbox:<handle>` was a live
// activity oracle on any named account. `private: true` is what makes
// supabase-js send this browser's own JWT, which the policy in migration 0148
// then judges. It is checked on BOTH lanes because a channel opened public
// here would hear nothing at all: the server broadcasts private.
// ─────────────────────────────────────────────────────────────────────────────
describe("messaging channels are private", () => {
  it("opens the thread channel private, so the browser's own JWT decides", () => {
    const fixture = realtimeFixture();
    getSupabaseBrowser.mockReturnValue(fixture.client);

    const unsubscribe = subscribeToMessages("conversation-9", vi.fn(), { poll: vi.fn() });

    const [, config] = defined(fixture.client.channel.mock.calls[0]);
    expect(config).toEqual({ config: { private: true } });
    unsubscribe();
  });

  it("opens the inbox channel private too - the topic a stranger could enumerate", () => {
    const fixture = realtimeFixture();
    getSupabaseBrowser.mockReturnValue(fixture.client);

    const unsubscribe = subscribeToInbox("ken", vi.fn(), { poll: vi.fn() });

    const [topic, config] = defined(fixture.client.channel.mock.calls[0]);
    expect(topic).toBe(messagesInboxTopic("ken"));
    expect(config).toEqual({ config: { private: true } });
    unsubscribe();
  });

  it("keeps the channel private on every re-attach after an error", () => {
    const fixture = realtimeFixture();
    let statusCallback: StatusCallback = () => {};
    fixture.channel.subscribe.mockImplementation((callback: StatusCallback) => {
      statusCallback = callback;
      return fixture.channel;
    });
    getSupabaseBrowser.mockReturnValue(fixture.client);

    const unsubscribe = subscribeToMessages("conversation-9", vi.fn(), { poll: vi.fn() });
    statusCallback("CHANNEL_ERROR");
    vi.advanceTimersByTime(messagesReattachDelayMs(1));

    expect(fixture.client.channel).toHaveBeenCalledTimes(2);
    for (const call of fixture.client.channel.mock.calls) {
      expect(call[1]).toEqual({ config: { private: true } });
    }
    unsubscribe();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// F-24 / fix task 16 - a transient socket error is not the end of the lane.
// ─────────────────────────────────────────────────────────────────────────────
describe("re-attaching after a dropped channel", () => {
  function erroringFixture() {
    const fixture = realtimeFixture();
    let statusCallback: StatusCallback = () => {};
    fixture.channel.subscribe.mockImplementation((callback: StatusCallback) => {
      statusCallback = callback;
      return fixture.channel;
    });
    getSupabaseBrowser.mockReturnValue(fixture.client);
    return { fixture, fail: () => statusCallback("CHANNEL_ERROR"), join: () => statusCallback("SUBSCRIBED") };
  }

  it("asks for the channel back ONCE under a bounded backoff, and polls meanwhile", () => {
    const { fixture, fail } = erroringFixture();
    const poll = vi.fn();
    const onStatus = vi.fn();

    const unsubscribe = subscribeToMessages("conversation-1", vi.fn(), { poll, onStatus });
    fail();

    expect(onStatus).toHaveBeenLastCalledWith("polling");
    // Nothing is re-asked before the backoff has run out.
    vi.advanceTimersByTime(messagesReattachDelayMs(1) - 1);
    expect(fixture.client.channel).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    expect(fixture.client.channel).toHaveBeenCalledTimes(2);
    // ONE re-ask, not a storm: the second attach is still connecting.
    vi.advanceTimersByTime(messagesReattachDelayMs(1) * 4);
    expect(fixture.client.channel).toHaveBeenCalledTimes(2);
    unsubscribe();
  });

  it("goes live again when the re-ask joins", () => {
    const { fail, join } = erroringFixture();
    const onStatus = vi.fn();

    const unsubscribe = subscribeToMessages("conversation-1", vi.fn(), { poll: vi.fn(), onStatus });
    join();
    expect(onStatus).toHaveBeenLastCalledWith("live");

    fail();
    expect(onStatus).toHaveBeenLastCalledWith("polling");
    vi.advanceTimersByTime(messagesReattachDelayMs(1));
    join();

    expect(onStatus).toHaveBeenLastCalledWith("live");
    unsubscribe();
  });

  it("gives up after a bounded number of attempts rather than retrying for ever", () => {
    const { fixture, fail } = erroringFixture();

    const unsubscribe = subscribeToMessages("conversation-1", vi.fn(), { poll: vi.fn() });
    for (let attempt = 1; attempt <= MESSAGES_REATTACH_MAX_ATTEMPTS + 2; attempt += 1) {
      fail();
      vi.advanceTimersByTime(messagesReattachDelayMs(attempt));
    }

    // The first attach plus the capped re-asks, and nothing beyond.
    expect(fixture.client.channel).toHaveBeenCalledTimes(MESSAGES_REATTACH_MAX_ATTEMPTS + 1);
    unsubscribe();
  });

  it("a join that LANDED clears the budget, so a long session keeps recovering", () => {
    const { fixture, fail, join } = erroringFixture();

    const unsubscribe = subscribeToMessages("conversation-1", vi.fn(), { poll: vi.fn() });
    for (let round = 0; round < MESSAGES_REATTACH_MAX_ATTEMPTS + 3; round += 1) {
      fail();
      vi.advanceTimersByTime(messagesReattachDelayMs(1));
      join();
    }

    expect(fixture.client.channel).toHaveBeenCalledTimes(MESSAGES_REATTACH_MAX_ATTEMPTS + 4);
    unsubscribe();
  });

  it("cancels a pending re-ask when the caller unsubscribes", () => {
    const { fixture, fail } = erroringFixture();

    const unsubscribe = subscribeToMessages("conversation-1", vi.fn(), { poll: vi.fn() });
    fail();
    unsubscribe();
    vi.advanceTimersByTime(messagesReattachDelayMs(1) * 10);

    expect(fixture.client.channel).toHaveBeenCalledTimes(1);
  });

  it("backs off further each attempt, and never past the ceiling", () => {
    expect(messagesReattachDelayMs(1)).toBeLessThan(messagesReattachDelayMs(2));
    expect(messagesReattachDelayMs(2)).toBeLessThan(messagesReattachDelayMs(3));
    expect(messagesReattachDelayMs(99)).toBe(messagesReattachDelayMs(50));
  });
});
