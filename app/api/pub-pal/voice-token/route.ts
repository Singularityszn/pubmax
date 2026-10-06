import { randomUUID } from "node:crypto";
import { callerUserId } from "@/lib/authServer";
import { isLimited } from "@/lib/pintDrops";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { log } from "@/lib/log";
import { paidSpendBudgetRefusal } from "@/lib/paidSpendBudget.server";
import {
  canPrepayVoiceGrant,
  PAL_VOICE_GRANT_MINUTES,
  PAL_VOICE_MAX_SESSION_SECONDS,
  PAL_VOICE_MONTHLY_MINUTES,
  remainingVoiceMinutes,
  type PalVoiceMeterState,
} from "@/lib/palVoiceMetering";
import { DEFAULT_CITY_ID } from "@/lib/cities";
import { buildPalVoiceOverrides } from "@/lib/palVoiceOverrides";
import { fetchPalSignedConversation } from "@/lib/palElevenLabsSignedUrl.server";
import { isPubPalConversationId } from "@/lib/pubPalConversationId";
import { bindPubPalToolTurn } from "@/lib/pubPalToolTurnStore";
import { palVoiceConfigured } from "@/lib/pubPalVoiceConfig.server";
import {
  providerCallSeconds,
  providerCallSecondsOnceEnded,
} from "@/lib/pubPalVoiceProviderDuration.server";
import { getPubPalResult } from "@/lib/pubPalStore";
import { clientIp, hashIp, isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

const usage = new Map<string, PalVoiceMeterState>();
const RELEASE_ERROR_MAX_LENGTH = 160;

type VoiceTokenBody = {
  action?: string;
  conversationId?: unknown;
};

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
  grantId: string;
  reason: "rpc_error" | "rpc_exception" | "not_released";
  error: unknown;
}): void {
  log("error", "pub_pal.voice_quota_release_failed", {
    ownerId: input.ownerId,
    usageMonth: input.usageMonth,
    grantId: input.grantId,
    reason: input.reason,
    error: releaseErrorMessage(input.error),
  });
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function usageMonthDate(month: string): string {
  return `${month}-01`;
}

function meterFor(userId: string, month: string): PalVoiceMeterState {
  const current = usage.get(userId);
  if (current?.month === month) return current;
  const meter = { month, usedMinutes: 0 };
  usage.set(userId, meter);
  return meter;
}

/**
 * Gives back one prepaid grant after the SERVER failed before it handed a signed
 * URL to the browser. Callers refund only on a path that returns no URL. The
 * database refunds a 'reserved' grant, and an 'issued' one for the case where the
 * link committed but its reply was lost. A settled grant is never refunded.
 */
async function refundVoiceGrant(
  admin: ReturnType<typeof requireSupabaseAdmin> | null,
  userId: string,
  usageMonth: string,
  meter: PalVoiceMeterState,
  grantId: string,
): Promise<void> {
  if (!admin) {
    meter.usedMinutes = Math.max(0, meter.usedMinutes - PAL_VOICE_GRANT_MINUTES);
    usage.set(userId, meter);
    return;
  }
  try {
    const { data, error } = await admin.rpc("refund_pub_pal_voice_grant", {
      p_owner_id: userId,
      p_grant_id: grantId,
    });
    if (error) {
      logReleaseFailure({ ownerId: userId, usageMonth, grantId, reason: "rpc_error", error });
    } else if (data !== true) {
      logReleaseFailure({
        ownerId: userId,
        usageMonth,
        grantId,
        reason: "not_released",
        error: "Grant was not refunded.",
      });
    }
  } catch (error) {
    logReleaseFailure({ ownerId: userId, usageMonth, grantId, reason: "rpc_exception", error });
  }
}

/**
 * Settles one issued grant from the duration ElevenLabs recorded for its
 * conversation, under the caller's own grant. False leaves it charged in full.
 */
async function settleConversation(
  admin: ReturnType<typeof requireSupabaseAdmin>,
  userId: string,
  conversationId: string,
  seconds: number,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("settle_pub_pal_voice_conversation", {
      p_owner_id: userId,
      p_conversation_id: conversationId,
      p_seconds: seconds,
    });
    if (error) {
      log("error", "pub_pal.voice_settle_failed", {
        ownerId: userId,
        error: releaseErrorMessage(error),
      });
      return false;
    }
    return data === true;
  } catch (error) {
    log("error", "pub_pal.voice_settle_failed", {
      ownerId: userId,
      error: releaseErrorMessage(error),
    });
    return false;
  }
}

/** True only when the owner holds an issued, unsettled grant for the conversation. */
async function ownsIssuedConversation(
  admin: ReturnType<typeof requireSupabaseAdmin>,
  userId: string,
  conversationId: string,
): Promise<boolean> {
  try {
    const { data, error } = await admin.rpc("owns_issued_pub_pal_voice_conversation", {
      p_owner_id: userId,
      p_conversation_id: conversationId,
    });
    return !error && data === true;
  } catch {
    return false;
  }
}

/**
 * Settles every grant of the owner's month that a release left issued, from
 * the provider's own durations, so the allowance check sees what the calls
 * really cost. A conversation ElevenLabs still cannot report stays charged.
 */
async function settleIssuedGrants(
  admin: ReturnType<typeof requireSupabaseAdmin>,
  userId: string,
  usageMonth: string,
  apiKey: string,
): Promise<void> {
  let conversationIds: string[];
  try {
    const { data, error } = await admin.rpc("issued_pub_pal_voice_conversations", {
      p_owner_id: userId,
      p_month: usageMonth,
    });
    if (error || !Array.isArray(data)) return;
    conversationIds = data.filter(isPubPalConversationId);
  } catch {
    return;
  }
  await Promise.all(conversationIds.map(async (conversationId) => {
    const seconds = await providerCallSeconds(conversationId, apiKey);
    if (seconds !== null) await settleConversation(admin, userId, conversationId, seconds);
  }));
}

/**
 * A session ended. The browser's say-so changes nothing: it names a
 * conversation, and the allowance is settled only from the duration ElevenLabs
 * recorded for that conversation, under the caller's own grant. The browser
 * releases as it hangs up, so the provider is asked for a few seconds until it
 * reports the call ended. If it never does, or cannot be read, the grant stays
 * issued and charged in full, and the owner's next voice-token request settles
 * it before the allowance check.
 */
async function handleRelease(
  request: Request,
  userId: string,
  body: VoiceTokenBody,
): Promise<Response> {
  const limiterKey = `pub-pal-voice-release:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const meter = meterFor(userId, currentMonth());
  const remainingMinutes = isSupabaseConfigured() ? null : remainingVoiceMinutes(meter);
  const unsettled = jsonNoStore({ released: true, settled: false, remainingMinutes });

  const conversationId = typeof body.conversationId === "string" ? body.conversationId : "";
  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  if (!isSupabaseConfigured() || !apiKey || !isPubPalConversationId(conversationId)) return unsettled;

  // Ask the provider only about a session this caller was issued, so a made-up
  // conversation id costs a database read and never a provider request.
  const admin = requireSupabaseAdmin();
  if (!await ownsIssuedConversation(admin, userId, conversationId)) return unsettled;

  const seconds = await providerCallSecondsOnceEnded(conversationId, apiKey);
  if (seconds === null) return unsettled;
  const settled = await settleConversation(admin, userId, conversationId, seconds);
  return jsonNoStore({ released: true, settled, remainingMinutes });
}

async function handleIssueToken(userId: string): Promise<Response> {
  const palResult = await getPubPalResult(userId);
  if (!palResult.ok) {
    return publicApiError("Pub Pal is temporarily unavailable.", "PUB_PAL_STORE_UNAVAILABLE", 503, {
      retryable: true,
      compatibilityFields: { fallback: "text" },
    });
  }
  const pal = palResult.value;
  if (!pal) {
    return publicApiError("Create your Pub Pal before starting voice.", "PUB_PAL_REQUIRED", 409, {
      compatibilityFields: { fallback: "text" },
    });
  }
  if (pal.muted) {
    return publicApiError("Voice is muted. Turn it back on to start a voice chat.", "VOICE_MUTED", 409, {
      compatibilityFields: { fallback: "text" },
    });
  }

  const apiKey = process.env.ELEVENLABS_API_KEY?.trim();
  const agentId = process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim();
  if (!apiKey || !agentId) {
    return publicApiError("Voice is not configured yet.", "UNAVAILABLE", 503, {
      retryable: true,
      compatibilityFields: { fallback: "text" },
    });
  }

  const month = currentMonth();
  const usageMonth = usageMonthDate(month);
  const supabaseConfigured = isSupabaseConfigured();
  const meter = meterFor(userId, month);
  if (!supabaseConfigured && !canPrepayVoiceGrant(meter)) {
    return publicApiError("Your trial voice allowance is used for this month.", "VOICE_ALLOWANCE_USED", 429, {
      compatibilityFields: { fallback: "text", remaining: 0, remainingMinutes: 0 },
    });
  }

  // The server pays for the whole session cap up front, before it asks the
  // provider for a session. Nothing the browser later reports moves this meter.
  const grantId = randomUUID();
  const admin = supabaseConfigured ? requireSupabaseAdmin() : null;
  if (admin) {
    await settleIssuedGrants(admin, userId, usageMonth, apiKey);
    try {
      const { data, error } = await admin.rpc("prepay_pub_pal_voice_grant", {
        p_owner_id: userId,
        p_month: usageMonth,
        p_grant_id: grantId,
        p_minutes: PAL_VOICE_GRANT_MINUTES,
        p_limit: PAL_VOICE_MONTHLY_MINUTES,
      });
      if (error || (data !== true && data !== false)) {
        // The database may have committed before the reply was lost, so the
        // grant is refunded on every ambiguous outcome and never on a plain
        // false, which confirms nothing was charged.
        await refundVoiceGrant(admin, userId, usageMonth, meter, grantId);
        return publicApiError("Voice allowance could not be checked.", "UNAVAILABLE", 503, {
          retryable: true,
          compatibilityFields: { fallback: "text" },
        });
      }
      if (data === false) {
        return publicApiError("Your trial voice allowance is used for this month.", "VOICE_ALLOWANCE_USED", 429, {
          compatibilityFields: { fallback: "text", remaining: 0, remainingMinutes: 0 },
        });
      }
    } catch {
      await refundVoiceGrant(admin, userId, usageMonth, meter, grantId);
      return publicApiError("Voice allowance could not be checked.", "UNAVAILABLE", 503, {
        retryable: true,
        compatibilityFields: { fallback: "text" },
      });
    }
  } else {
    meter.usedMinutes += PAL_VOICE_GRANT_MINUTES;
    usage.set(userId, meter);
  }

  // The deployment-wide ceiling comes AFTER the account's own allowance, so an
  // account with no minutes left cannot spend the ceiling every account shares.
  // A refusal hands the reservation back. Per-account minutes bound one person;
  // this bounds the sum across every account.
  const budgetRefusal = await paidSpendBudgetRefusal("pub-pal-voice");
  if (budgetRefusal) {
    await refundVoiceGrant(admin, userId, usageMonth, meter, grantId);
    return budgetRefusal;
  }

  const overrides = buildPalVoiceOverrides(pal);

  let providerAllocated = false;
  try {
    const session = await fetchPalSignedConversation({ apiKey, agentId });
    if (!session.ok) {
      if (session.reason === "unreachable") {
        return publicApiError("Voice service did not respond in time.", "PROVIDER_TIMEOUT", 504, {
          retryable: true,
          compatibilityFields: { fallback: "text" },
        });
      }
      return publicApiError(
        session.reason === "http"
          ? "Voice service is temporarily unavailable."
          : "Voice service returned no session.",
        "PROVIDER_UNAVAILABLE",
        502,
        { retryable: true, compatibilityFields: { fallback: "text" } },
      );
    }
    const { signedUrl, conversationId } = session;
    try {
      await bindPubPalToolTurn(conversationId, userId, DEFAULT_CITY_ID);
    } catch {
      return publicApiError("Voice service is temporarily unavailable.", "UNAVAILABLE", 503, {
        retryable: true,
        compatibilityFields: { fallback: "text" },
      });
    }
    if (admin) {
      let linked = false;
      try {
        const { data, error } = await admin.rpc("link_pub_pal_voice_conversation", {
          p_owner_id: userId,
          p_grant_id: grantId,
          p_conversation_id: conversationId,
        });
        linked = !error && data === true;
      } catch {
        linked = false;
      }
      // An ambiguous link (committed, reply lost) lands here too: no URL is handed
      // out, and the refund in `finally` covers a grant already marked issued.
      if (!linked) {
        return publicApiError("Voice service is temporarily unavailable.", "UNAVAILABLE", 503, {
          retryable: true,
          compatibilityFields: { fallback: "text" },
        });
      }
    }
    providerAllocated = true;
    const remainingMinutes = supabaseConfigured ? null : remainingVoiceMinutes(meter);
    return jsonNoStore({
      signedUrl,
      conversationId,
      connectionType: "websocket",
      overrides,
      maxSessionSeconds: PAL_VOICE_MAX_SESSION_SECONDS,
      remaining: remainingMinutes,
      remainingMinutes,
      retention: "provider_default",
      mutationPolicy: "propose_then_confirm",
    });
  } catch {
    return publicApiError("Voice service did not respond in time.", "PROVIDER_TIMEOUT", 504, {
      retryable: true,
      compatibilityFields: { fallback: "text" },
    });
  } finally {
    if (!providerAllocated) {
      await refundVoiceGrant(admin, userId, usageMonth, meter, grantId);
    }
  }
}

/**
 * Voice availability, so the browser can explain itself before the tap.
 *
 * Reads no account and allocates nothing, so it needs no session: it answers
 * one boolean about this deployment's own configuration.
 */
export async function GET(): Promise<Response> {
  return jsonNoStore({
    available: palVoiceConfigured(),
    maxSessionSeconds: PAL_VOICE_MAX_SESSION_SECONDS,
    retention: "provider_default",
    mutationPolicy: "propose_then_confirm",
  });
}

export async function POST(request: Request): Promise<Response> {
  const limiterKey = `pub-pal-voice-token:${hashIp(clientIp(request))}`;
  if (await isLimited(limiterKey, limiterKey)) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, { retryable: true });
  }

  const userId = await callerUserId(request);
  if (!userId) return publicApiError("Sign in to talk with your Pub Pal.", "UNAUTHENTICATED", 401);

  let body: VoiceTokenBody = {};
  try {
    const raw = await request.text();
    if (raw.trim()) body = JSON.parse(raw) as VoiceTokenBody;
  } catch {
    return publicApiError("Malformed request body.", "INVALID_JSON", 400);
  }

  if (body.action === "release") return handleRelease(request, userId, body);
  return handleIssueToken(userId);
}
