import "server-only";

import { isPubPalConversationId } from "@/lib/pubPalConversationId";

const PROVIDER_READ_TIMEOUT_MS = 8_000;

/** How long a release waits for ElevenLabs to report the call ended. */
const PROVIDER_SETTLE_WINDOW_MS = 5_000;
const PROVIDER_SETTLE_POLL_MS = 1_000;

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
  timeoutMs: number = PROVIDER_READ_TIMEOUT_MS,
): Promise<number | null> {
  if (!isPubPalConversationId(conversationId)) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(timeoutMs, PROVIDER_READ_TIMEOUT_MS));
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

/**
 * `providerCallSeconds`, asked again once a second for at most
 * `PROVIDER_SETTLE_WINDOW_MS`, because a browser releases the moment it hangs
 * up and ElevenLabs reports the call as running for a moment after that. Null
 * when the window closes first: the grant stays issued, charged in full, and
 * is settled before the owner's next session is admitted.
 */
export async function providerCallSecondsOnceEnded(
  conversationId: string,
  apiKey: string,
): Promise<number | null> {
  const deadline = Date.now() + PROVIDER_SETTLE_WINDOW_MS;
  for (;;) {
    const seconds = await providerCallSeconds(conversationId, apiKey, deadline - Date.now());
    if (seconds !== null || deadline - Date.now() <= PROVIDER_SETTLE_POLL_MS) return seconds;
    await new Promise((resolve) => setTimeout(resolve, PROVIDER_SETTLE_POLL_MS));
  }
}
