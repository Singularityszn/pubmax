import "server-only";

import { isPubPalConversationId } from "@/lib/pubPalConversationId";

const PROVIDER_READ_TIMEOUT_MS = 8_000;

/**
 * Provider states in which the call has ended and its duration is final.
 * "initiated" and "in-progress" are still running, so they settle nothing.
 */
const ENDED_STATUSES: ReadonlySet<string> = new Set(["processing", "done", "failed"]);

/**
 * The call length ElevenLabs recorded for one of our conversations, in whole
 * seconds, or null while the call is running or when the provider cannot say.
 * This is the only duration the voice meter settles from: the browser's own
 * clock is never read. Null leaves the prepaid grant charged in full.
 */
export async function providerCallSeconds(
  conversationId: string,
  apiKey: string,
): Promise<number | null> {
  if (!isPubPalConversationId(conversationId)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), PROVIDER_READ_TIMEOUT_MS);
  try {
    const response = await fetch(
      `https://api.elevenlabs.io/v1/convai/conversations/${encodeURIComponent(conversationId)}`,
      {
        headers: { "xi-api-key": apiKey },
        signal: controller.signal,
        cache: "no-store",
        redirect: "error",
      },
    );
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      status?: unknown;
      metadata?: { call_duration_secs?: unknown } | null;
    };
    if (typeof payload.status !== "string" || !ENDED_STATUSES.has(payload.status)) return null;
    const seconds = payload.metadata?.call_duration_secs;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return null;
    return Math.ceil(seconds);
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}
