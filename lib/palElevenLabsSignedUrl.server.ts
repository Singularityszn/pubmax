import "server-only";

import { conversationIdFromSignedUrl } from "@/lib/pubPalConversationId";

const SIGNED_URL_TIMEOUT_MS = 8_000;

export type PalSignedConversation =
  | { ok: true; signedUrl: string; conversationId: string }
  /** `http`: the provider refused. `no_session`: its answer held no usable URL. `unreachable`: it did not answer in time or at all. */
  | { ok: false; reason: "http" | "no_session" | "unreachable" };

/**
 * One signed URL from ElevenLabs for the Pub Pal agent, for typed chat and for
 * voice alike. The agent requires a signed URL to start a conversation, so this
 * is the only door in. The reply holds `signed_url` alone, and the conversation
 * id is a query parameter inside it. The call is bounded, so a hung provider
 * cannot run a route past its own limit.
 */
export async function fetchPalSignedConversation(input: {
  apiKey: string;
  agentId: string;
  timeoutMs?: number;
}): Promise<PalSignedConversation> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), input.timeoutMs ?? SIGNED_URL_TIMEOUT_MS);
  try {
    const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url");
    url.searchParams.set("agent_id", input.agentId);
    url.searchParams.set("include_conversation_id", "true");
    const response = await fetch(url, {
      headers: { "xi-api-key": input.apiKey },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return { ok: false, reason: "http" };
    const signedUrl = signedUrlFromBody(await response.text());
    const conversationId = signedUrl ? conversationIdFromSignedUrl(signedUrl) : "";
    if (!signedUrl || !conversationId) return { ok: false, reason: "no_session" };
    return { ok: true, signedUrl, conversationId };
  } catch {
    return { ok: false, reason: "unreachable" };
  } finally {
    clearTimeout(timeout);
  }
}

function signedUrlFromBody(body: string): string {
  try {
    const payload = JSON.parse(body) as { signed_url?: unknown } | null;
    return typeof payload?.signed_url === "string" ? payload.signed_url : "";
  } catch {
    return "";
  }
}
