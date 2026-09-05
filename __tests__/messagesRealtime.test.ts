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
  subscribeToInbox,
  subscribeToMessages,
} from "@/lib/messagesRealtime";
import { messagesInboxTopic, messagesThreadTopic } from "@/lib/messagesTopics";

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
    channel: vi.fn(() => channel),
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

    expect(fixture.client.channel).toHaveBeenCalledWith(messagesThreadTopic("conversation-42"));
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
    expect(fixture.client.channel).toHaveBeenCalledWith(messagesThreadTopic("conversation-1"));
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

    expect(fixture.client.channel).toHaveBeenCalledWith(messagesInboxTopic("ken"));
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
