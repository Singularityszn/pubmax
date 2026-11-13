import { authedActionFetch } from "@/lib/authedFetch";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { discardBody } from "@/lib/responseBody";

// The two calls a live voice session makes to its own server besides the grant.

export async function syncVoiceToolTurn(input: {
  conversationId: string;
  threadTurn?: { role: "user"; content: string };
}): Promise<void> {
  try {
    const response = await authedActionFetch("/api/pub-pal/tool-turn", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        conversationId: input.conversationId,
        cityId: DEFAULT_CITY_ID,
        ...(input.threadTurn ? { threadTurn: input.threadTurn } : {}),
      }),
    }, { requiresIdentity: true });
    discardBody(response);
  } catch {
    // Best effort: fencing still runs on the tool query alone when sync fails.
  }
}

/**
 * Tells the server a session ended. It names the conversation and nothing
 * else: the allowance is settled from the provider's own record of the call,
 * never from a figure the browser measures.
 */
export async function releaseVoiceSession(conversationId: string | null): Promise<void> {
  try {
    const response = await authedActionFetch("/api/pub-pal/voice-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      keepalive: true,
      body: JSON.stringify({ action: "release", ...(conversationId ? { conversationId } : {}) }),
    }, { requiresIdentity: true });
    discardBody(response);
  } catch {
    // Best effort: a failed release must not block ending the local session.
  }
}
