// Signal-only realtime for the messaging surfaces (PRD E4). Kept OUT of
// lib/realtime.ts (owned elsewhere; import-only) but under the same privacy and
// resilience contract.
//
// ─────────────────────────────────────────────────────────────────────────────
// PRIVACY CONTRACT - events are SIGNALS, never CONTENT. `onSignal` is a
// ZERO-ARGUMENT nudge: on each one the caller REFETCHES through the
// participant-gated route (GET /api/messages/[id]?handle=…, GET /api/messages)
// so the courtesy check re-applies to every rendered row. No payload is read.
// ─────────────────────────────────────────────────────────────────────────────
//
// WHY BROADCAST. The thread used to subscribe to `postgres_changes` on the
// `messages` table. That table is RLS deny-all and is not in the realtime
// publication (migration 0019), so the channel joined and then heard nothing,
// and every conversation lived on the poll fallback: the other side saw a
// message up to ten seconds late. The server now sends a payload-free
// Broadcast on the same topic the moment a row lands
// (lib/messagesBroadcast.server.ts), which needs no table read at all.
//
// WHY EVERY CHANNEL IS PRIVATE. A public channel authorises on the API key
// alone, and this client is built from the PUBLIC key, so `live:inbox:<handle>`
// on a public channel handed anybody holding that key a live activity feed for
// any named account. `private: true` makes supabase-js send this browser's own
// user JWT on join, and Realtime then checks it against the policy on
// `realtime.messages` (migration 0148): your own inbox, and a conversation you
// are a participant of, and nothing else. It is not a client-side preference -
// the server broadcasts private too, so a channel opened public here would hear
// nothing at all. A browser with no session cannot join, which is correct: no
// messaging surface renders for one, and the poll fallback carries anything
// that reaches this far.
//
// RESILIENCE - polling is MANDATORY, realtime is the optimisation. No public
// Supabase env, a channel that cannot join in ~5s, or one that errors mid
// session → the caller's `poll` runs on the fallback cadence. A dropped channel
// is RE-ASKED under a bounded backoff rather than abandoned: one transient
// socket error used to downgrade a thread to polling for the life of the mount,
// which on a phone waking from sleep is the ordinary case rather than a rare
// one. The attempts are capped, so a genuinely unreachable Realtime settles on
// the poll lane instead of retrying for ever. A channel that IS live still gets
// a slow safety poll, because a socket can stay connected through a missed
// frame. A HIDDEN tab polls not at all and refetches once the
// moment it is shown again, because a phone in a pocket is the common case and
// each poll is a server round trip with several reads behind it.
//
// supabase-js loads lazily. The old helper read the client synchronously and
// polled for ever when the chunk had not landed yet; this one AWAITS the client
// so a cold open still upgrades to realtime.

import { ensureSupabaseBrowser, getSupabaseBrowser, isAuthConfigured } from "@/lib/authClient";
import { messagesInboxTopic, messagesThreadTopic } from "@/lib/messagesTopics";

/** A zero-argument nudge — deliberately carries NO payload (see header). */
export type LiveSignal = () => void;
/** Tear down the subscription (and any fallback poll). Always safe to call. */
export type Unsubscribe = () => void;

/** Where delivery is coming from right now. `live` means the socket answers. */
type MessagesLiveStatus = "connecting" | "live" | "polling";

export type MessagesSubscribeOptions = Readonly<{
  /** Refetch on the fallback cadence when realtime is unavailable or broken. */
  poll?: LiveSignal;
  /** Told each time the delivery lane changes. */
  onStatus?: (status: MessagesLiveStatus) => void;
}>;

const JOIN_TIMEOUT_MS = 5_000;
/** How many times a dropped channel is re-asked before the poll lane keeps it. */
export const MESSAGES_REATTACH_MAX_ATTEMPTS = 4;
/** First backoff step; each further attempt doubles it, capped below. */
const MESSAGES_REATTACH_BASE_MS = 1_000;
/** No backoff step is longer than this, so a woken phone recovers promptly. */
const MESSAGES_REATTACH_MAX_MS = 30_000;

/** The delay before re-asking, for attempt 1..MESSAGES_REATTACH_MAX_ATTEMPTS. */
export function messagesReattachDelayMs(attempt: number): number {
  const step = MESSAGES_REATTACH_BASE_MS * 2 ** Math.max(0, attempt - 1);
  return Math.min(step, MESSAGES_REATTACH_MAX_MS);
}
/** Without a socket a conversation still has to feel like one. */
export const MESSAGES_POLL_FALLBACK_MS = 5_000;
/** With a live socket a poll is a safety net, not the delivery lane. */
export const MESSAGES_POLL_LIVE_MS = 30_000;
/** The inbox is a list, not a conversation; it can wait a little longer. */
export const INBOX_POLL_FALLBACK_MS = 15_000;
const INBOX_POLL_LIVE_MS = 60_000;

type Cadence = Readonly<{ fallbackMs: number; liveMs: number }>;

const THREAD_CADENCE: Cadence = {
  fallbackMs: MESSAGES_POLL_FALLBACK_MS,
  liveMs: MESSAGES_POLL_LIVE_MS,
};
const INBOX_CADENCE: Cadence = {
  fallbackMs: INBOX_POLL_FALLBACK_MS,
  liveMs: INBOX_POLL_LIVE_MS,
};

function documentHidden(): boolean {
  return typeof document !== "undefined" && document.visibilityState === "hidden";
}

/**
 * The poll timer, owned in one place so the two lanes cannot disagree about
 * what a hidden tab does. `setCadence(null)` stops polling; a cadence starts
 * it, unless the document is hidden, in which case the timer waits for the
 * tab to come back and then polls at once.
 */
function pollTimer(poll: LiveSignal | undefined) {
  let cadenceMs: number | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let hiddenSince: number | null = null;

  function stop(): void {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function start(): void {
    stop();
    if (!poll || cadenceMs === null || documentHidden()) return;
    timer = setInterval(poll, cadenceMs);
  }

  function onVisibility(): void {
    if (documentHidden()) {
      hiddenSince = Date.now();
      stop();
      return;
    }
    // Shown again: whatever the lane, the reader wants what they missed NOW,
    // not at the next tick.
    if (hiddenSince !== null && poll && cadenceMs !== null) poll();
    hiddenSince = null;
    start();
  }

  if (typeof document !== "undefined") {
    document.addEventListener("visibilitychange", onVisibility);
  }

  return {
    setCadence(next: number | null): void {
      cadenceMs = next;
      start();
    },
    dispose(): void {
      stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibility);
      }
    },
  };
}

function subscribeBroadcast(
  topic: string,
  events: readonly string[],
  onSignal: LiveSignal,
  cadence: Cadence,
  options: MessagesSubscribeOptions | undefined,
): Unsubscribe {
  const poll = options?.poll;
  const onStatus = options?.onStatus;
  let disposed = false;
  let status: MessagesLiveStatus | null = null;
  const timer = pollTimer(poll);

  function setStatus(next: MessagesLiveStatus): void {
    if (disposed || status === next) return;
    status = next;
    timer.setCadence(next === "live" ? cadence.liveMs : cadence.fallbackMs);
    onStatus?.(next);
  }

  // No public env: realtime is impossible here, poll and say so.
  if (!isAuthConfigured()) {
    setStatus("polling");
    return () => {
      disposed = true;
      timer.dispose();
    };
  }

  setStatus("connecting");

  let joinTimer: ReturnType<typeof setTimeout> | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let channel: { unsubscribe?: () => unknown } | null = null;
  let removeChannel: ((channel: unknown) => unknown) | null = null;
  let client: NonNullable<ReturnType<typeof getSupabaseBrowser>> | null = null;
  let attempts = 0;

  function dropChannel(): void {
    if (joinTimer) {
      clearTimeout(joinTimer);
      joinTimer = null;
    }
    // Guards settle BEFORE removeChannel: unsubscribe fires a synchronous
    // "CLOSED" back into the status callback (see the re-entrancy note in
    // lib/realtime.ts), and that callback must find nothing left to drop.
    const dead = channel;
    channel = null;
    if (dead && removeChannel) {
      try {
        void removeChannel(dead);
      } catch {
        /* already gone */
      }
    }
  }

  /**
   * The channel is gone. Poll NOW, so the reader is never left waiting on a
   * lane that has stopped answering, and ask for it back once under a bounded
   * backoff. A retry already in flight is never doubled: the synchronous
   * "CLOSED" that `dropChannel` provokes lands here too.
   */
  function fallBackToPolling(): void {
    if (disposed) return;
    dropChannel();
    setStatus("polling");
    if (retryTimer !== null) return;
    if (!client || attempts >= MESSAGES_REATTACH_MAX_ATTEMPTS) return;
    attempts += 1;
    retryTimer = setTimeout(() => {
      retryTimer = null;
      if (disposed || !client) return;
      attach(client);
    }, messagesReattachDelayMs(attempts));
  }

  function attach(next: NonNullable<ReturnType<typeof getSupabaseBrowser>>): void {
    if (disposed) return;
    client = next;
    try {
      removeChannel = (dead) => next.removeChannel(dead as never);
      // PRIVATE (see header): supabase-js sends this browser's own user JWT on
      // join, so Realtime's policy on `realtime.messages` decides, not the
      // public key. The server broadcasts private too; the two must agree.
      const channelNext = next.channel(topic, { config: { private: true } });
      channel = channelNext;
      for (const event of events) {
        channelNext.on("broadcast" as never, { event } as never, () => {
          // SIGNAL ONLY - the payload is ignored by construction (see header).
          if (!disposed) onSignal();
        });
      }
      joinTimer = setTimeout(fallBackToPolling, JOIN_TIMEOUT_MS);
      channelNext.subscribe((state: string) => {
        if (disposed) return;
        if (state === "SUBSCRIBED") {
          if (joinTimer) {
            clearTimeout(joinTimer);
            joinTimer = null;
          }
          // A join that LANDED clears the budget, so a socket that drops once
          // an hour is re-asked each time rather than spending its four.
          attempts = 0;
          setStatus("live");
        } else if (state === "CHANNEL_ERROR" || state === "TIMED_OUT" || state === "CLOSED") {
          fallBackToPolling();
        }
      });
    } catch {
      fallBackToPolling();
    }
  }

  const ready = getSupabaseBrowser();
  if (ready) {
    attach(ready);
  } else {
    // The chunk is still loading. Poll meanwhile, and upgrade when it lands
    // rather than polling for the life of the page.
    timer.setCadence(cadence.fallbackMs);
    void ensureSupabaseBrowser()
      .then((loaded) => {
        if (disposed) return;
        if (loaded) attach(loaded);
        else fallBackToPolling();
      })
      .catch(() => fallBackToPolling());
  }

  return () => {
    disposed = true;
    if (retryTimer) {
      clearTimeout(retryTimer);
      retryTimer = null;
    }
    timer.dispose();
    dropChannel();
  };
}

/**
 * Subscribe to ONE conversation: a `message` signal when a row lands, a `read`
 * signal when the other side reads what was waiting. Both are the same nudge to
 * the caller. A falsy conversationId yields a pure no-op.
 */
export function subscribeToMessages(
  conversationId: string,
  onSignal: LiveSignal,
  options?: MessagesSubscribeOptions,
): Unsubscribe {
  if (!conversationId) return () => {};
  return subscribeBroadcast(
    messagesThreadTopic(conversationId),
    ["message", "read"],
    onSignal,
    THREAD_CADENCE,
    options,
  );
}

/**
 * Subscribe to ONE handle's inbox: a signal whenever a message lands in any of
 * their conversations. A falsy handle yields a pure no-op.
 */
export function subscribeToInbox(
  handle: string,
  onSignal: LiveSignal,
  options?: MessagesSubscribeOptions,
): Unsubscribe {
  if (!handle) return () => {};
  return subscribeBroadcast(
    messagesInboxTopic(handle),
    ["message"],
    onSignal,
    INBOX_CADENCE,
    options,
  );
}
