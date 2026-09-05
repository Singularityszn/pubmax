import "server-only";

// The server's half of the message thread's realtime lane.
//
// WHY A BROADCAST AND NOT POSTGRES CHANGES. `messages` is RLS deny-all with no
// policy and is not in the `supabase_realtime` publication (migration 0019), so
// a browser `postgres_changes` channel on it joins happily and then hears
// NOTHING. The thread therefore lived on its poll fallback, and the other side
// of a conversation saw a message up to ten seconds after it was sent. A
// Broadcast message is not a row read: the server names the topic and sends a
// payload-free signal through Realtime's HTTP endpoint, the browser hears it on
// a public channel of the same name, and the browser then refetches through the
// participant-gated route exactly as it did before. The signal carries NO
// content, NO handle and NO message id, so a stranger who guessed a
// conversation's uuid learns only that something happened in it.
//
// It is FIRE AND FORGET, BOUNDED: the write has already landed when this runs,
// a message must never fail because the nudge did, and a serverless function
// cannot leave a request open, so the send is awaited under a short timeout
// and a failure is one warn line. Realtime unavailable means the poll fallback
// carries the thread, which is the behaviour the thread had before.

import { log } from "@/lib/log";
import { messagesInboxTopic, messagesThreadTopic } from "@/lib/messagesTopics";
import { supabaseServerConfig } from "@/lib/supabase";

/** What a thread signal is about. The payload never says more than this. */
export type MessagesSignalEvent = "message" | "read";

export const MESSAGES_BROADCAST_TIMEOUT_MS = 1_500;

export type MessagesBroadcastDeps = Readonly<{
  fetchImpl?: typeof fetch;
  config?: { url: string; key: string } | null;
}>;

type BroadcastMessage = Readonly<{
  topic: string;
  event: MessagesSignalEvent;
  payload: Record<string, never>;
  private: false;
}>;

async function sendBroadcast(
  messages: readonly BroadcastMessage[],
  deps: MessagesBroadcastDeps,
): Promise<boolean> {
  const config = deps.config === undefined ? supabaseServerConfig() : deps.config;
  if (!config || messages.length === 0) return false;
  const fetchImpl = deps.fetchImpl ?? fetch;
  const endpoint = `${config.url.replace(/\/+$/, "")}/realtime/v1/api/broadcast`;
  try {
    const response = await fetchImpl(endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: config.key,
        authorization: `Bearer ${config.key}`,
      },
      body: JSON.stringify({ messages }),
      signal: AbortSignal.timeout(MESSAGES_BROADCAST_TIMEOUT_MS),
    });
    if (!response.ok) {
      log("warn", "messages.broadcast_refused", { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    log("warn", "messages.broadcast_failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    return false;
  }
}

/**
 * Tell both participants' open surfaces that a message landed: the thread
 * itself, and each participant's inbox. Resolves false when nothing was sent,
 * which is never an error for the caller.
 */
export function broadcastMessageSent(
  conversationId: string,
  participants: readonly string[],
  deps: MessagesBroadcastDeps = {},
): Promise<boolean> {
  const messages: BroadcastMessage[] = [
    { topic: messagesThreadTopic(conversationId), event: "message", payload: {}, private: false },
    ...participants
      .filter((handle) => handle.length > 0)
      .map((handle) => ({
        topic: messagesInboxTopic(handle),
        event: "message" as const,
        payload: {},
        private: false as const,
      })),
  ];
  return sendBroadcast(messages, deps);
}

/**
 * Tell the thread that the viewer just read what was waiting for them, so the
 * sender's "Sent" becomes "Read" without waiting for a poll.
 */
export function broadcastMessagesRead(
  conversationId: string,
  deps: MessagesBroadcastDeps = {},
): Promise<boolean> {
  return sendBroadcast(
    [{ topic: messagesThreadTopic(conversationId), event: "read", payload: {}, private: false }],
    deps,
  );
}
