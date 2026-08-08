import { callerUserId } from "@/lib/authServer";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { log } from "@/lib/log";
import { clientIp, hashIp, isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

const usage = new Map<string, { count: number; month: string }>();
const MONTHLY_TRIAL_SESSIONS = 10;
const RELEASE_ERROR_MAX_LENGTH = 160;

function releaseErrorMessage(error: unknown): string {
  const message =
    error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error
        ? String(error.message)
        : String(error);
  return message.slice(0, RELEASE_ERROR_MAX_LENGTH);
}

function logReleaseFailure(input: {
  ownerId: string;
  usageMonth: string;
  reason: "rpc_error" | "rpc_exception" | "not_released";
  error: unknown;
}): void {
  log("error", "pub_pal.voice_quota_release_failed", {
    ownerId: input.ownerId,
    usageMonth: input.usageMonth,
    reason: input.reason,
    error: releaseErrorMessage(input.error),
  });
}

export async function POST(request: Request): Promise<Response> {
  const limiterKey = `pub-pal-voice-token:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const userId = await callerUserId(request);
  if (!userId) return publicApiError("Sign in to talk with your Pub Pal.", "UNAUTHENTICATED", 401);
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const agentId = process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim();
  if (!apiKey || !agentId) return publicApiError("Voice is not configured yet.", "UNAVAILABLE", 503, { retryable: true, compatibilityFields: { fallback: "text" } });
  const month = new Date().toISOString().slice(0, 7);
  const usageMonth = `${month}-01`;
  const supabaseConfigured = isSupabaseConfigured();
  const current = usage.get(userId);
  const meter = current?.month === month ? current : { count: 0, month };
  if (!supabaseConfigured && meter.count >= MONTHLY_TRIAL_SESSIONS) return publicApiError("Your trial voice allowance is used for this month.", "VOICE_ALLOWANCE_USED", 429, { compatibilityFields: { fallback: "text", remaining: 0 } });

  const admin = supabaseConfigured ? requireSupabaseAdmin() : null;
  if (admin) {
    try {
      const { data, error } = await admin.rpc("consume_pub_pal_voice_trial", {
        p_owner_id: userId,
        p_month: usageMonth,
        p_limit: MONTHLY_TRIAL_SESSIONS,
      });
      if (error) return publicApiError("Voice allowance could not be checked.", "UNAVAILABLE", 503, { retryable: true, compatibilityFields: { fallback: "text" } });
      if (data === false) return publicApiError("Your trial voice allowance is used for this month.", "VOICE_ALLOWANCE_USED", 429, { compatibilityFields: { fallback: "text", remaining: 0 } });
    } catch {
      return publicApiError("Voice allowance could not be checked.", "UNAVAILABLE", 503, { retryable: true, compatibilityFields: { fallback: "text" } });
    }
  } else {
    meter.count += 1;
    usage.set(userId, meter);
  }

  let providerAllocated = false;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  try {
    const url = new URL("https://api.elevenlabs.io/v1/convai/conversation/get-signed-url");
    url.searchParams.set("agent_id", agentId);
    url.searchParams.set("include_conversation_id", "true");
    const response = await fetch(url, { headers: { "xi-api-key": apiKey }, signal: controller.signal, cache: "no-store" });
    if (!response.ok) return publicApiError("Voice service is temporarily unavailable.", "PROVIDER_UNAVAILABLE", 502, { retryable: true, compatibilityFields: { fallback: "text" } });
    const body = await response.json() as { signed_url?: string };
    if (!body.signed_url) return publicApiError("Voice service returned no session.", "PROVIDER_UNAVAILABLE", 502, { retryable: true, compatibilityFields: { fallback: "text" } });
    providerAllocated = true;
    return jsonNoStore({ signedUrl: body.signed_url, connectionType: "websocket", remaining: supabaseConfigured ? null : MONTHLY_TRIAL_SESSIONS - meter.count, retention: "zero", mutationPolicy: "propose_then_confirm" });
  } catch {
    return publicApiError("Voice service did not respond in time.", "PROVIDER_TIMEOUT", 504, { retryable: true, compatibilityFields: { fallback: "text" } });
  } finally {
    clearTimeout(timeout);
    if (!providerAllocated) {
      if (admin) {
        try {
          const { data, error } = await admin.rpc("release_pub_pal_voice_trial", {
            p_owner_id: userId,
            p_month: usageMonth,
          });
          if (error) {
            logReleaseFailure({
              ownerId: userId,
              usageMonth,
              reason: "rpc_error",
              error,
            });
          } else if (data !== true) {
            logReleaseFailure({
              ownerId: userId,
              usageMonth,
              reason: "not_released",
              error: "Reservation row was not released.",
            });
          }
        } catch (error) {
          logReleaseFailure({
            ownerId: userId,
            usageMonth,
            reason: "rpc_exception",
            error,
          });
        }
      } else {
        meter.count = Math.max(0, meter.count - 1);
        usage.set(userId, meter);
      }
    }
  }
}
