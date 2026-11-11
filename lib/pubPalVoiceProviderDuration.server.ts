import "server-only";

import { isPalLocalThreadId, isPubPalConversationId } from "@/lib/pubPalConversationId";

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
 * What ElevenLabs holds for one of our conversations. `ended` carries the
 * final call length in whole seconds. `missing` is a 404: the provider has
 * no record of the conversation. `unknown` is every other answer, including a
 * running call, an error and a timeout.
 */
export type ProviderCallRecord =
  | { kind: "ended"; seconds: number }
  | { kind: "missing" }
  | { kind: "unknown" };

export async function providerCallRecord(
  conversationId: string,
  apiKey: string,
  timeoutMs: number = PROVIDER_READ_TIMEOUT_MS,
): Promise<ProviderCallRecord> {
  if (!isPubPalConversationId(conversationId) || isPalLocalThreadId(conversationId)) return { kind: "unknown" };
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
    if (response.status === 404) return { kind: "missing" };
    if (!response.ok) return { kind: "unknown" };
    const payload = (await response.json()) as {
      status?: unknown;
      metadata?: { call_duration_secs?: unknown } | null;
    };
    if (typeof payload.status !== "string" || !ENDED_STATUSES.has(payload.status)) return { kind: "unknown" };
    const seconds = payload.metadata?.call_duration_secs;
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) return { kind: "unknown" };
    return { kind: "ended", seconds: Math.ceil(seconds) };
  } catch {
    return { kind: "unknown" };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * The call length ElevenLabs recorded for one of our conversations, in whole
 * seconds, or null while the call is running or when the provider cannot say.
 * A release settles only from this provider duration, never the browser's
 * clock. Null leaves the prepaid grant charged for later settlement attempts.
 */
export async function providerCallSeconds(
  conversationId: string,
  apiKey: string,
  timeoutMs: number = PROVIDER_READ_TIMEOUT_MS,
): Promise<number | null> {
  const record = await providerCallRecord(conversationId, apiKey, timeoutMs);
  return record.kind === "ended" ? record.seconds : null;
}

/**
 * `providerCallSeconds`, asked again once a second for at most
 * `PROVIDER_SETTLE_WINDOW_MS`, because a browser releases the moment it hangs
 * up and ElevenLabs reports the call as running for a moment after that. Null
 * when the window closes first: the grant stays issued and charged in full.
 * The voice-token route owns later settlement attempts.
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
