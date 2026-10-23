import { callerUserId } from "@/lib/authServer";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { resolveAskCityId } from "@/lib/ask/tools";
import { isPubPalConversationId } from "@/lib/pubPalConversationId";
import {
  appendOwnedPubPalUserTurn,
  touchPubPalToolTurn,
} from "@/lib/pubPalToolTurnStore";
import { isLimited } from "@/lib/pintDrops";
import { clientIp, hashIp } from "@/lib/supabase";

const RATE_LIMIT = 120;
const RATE_WINDOW_MS = 60_000;

export async function POST(request: Request): Promise<Response> {
  const ownerId = await callerUserId(request);
  if (!ownerId) {
    return publicApiError("Sign in to sync Pal voice.", "UNAUTHENTICATED", 401);
  }

  const limiterKey = `pub-pal-tool-turn:${hashIp(clientIp(request))}`;
  if (
    await isLimited(limiterKey, limiterKey, RATE_LIMIT, RATE_WINDOW_MS, {
      failClosed: true,
    })
  ) {
    return publicApiError("Too many requests, slow down.", "RATE_LIMITED", 429, {
      retryable: true,
    });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return publicApiError("Malformed JSON.", "MALFORMED_REQUEST", 400);
  }

  const record =
    body && typeof body === "object" && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  const conversationId =
    typeof record.conversationId === "string" ? record.conversationId.trim() : "";
  if (!isPubPalConversationId(conversationId)) {
    return publicApiError("Conversation id required.", "MALFORMED_REQUEST", 400);
  }

  const cityId = resolveAskCityId(record.cityId);
  const unavailable = () =>
    publicApiError("That conversation isn't available.", "NOT_FOUND", 404);

  const threadTurn = record.threadTurn;
  if (threadTurn && typeof threadTurn === "object" && !Array.isArray(threadTurn)) {
    const turnRecord = threadTurn as Record<string, unknown>;
    if (turnRecord.role !== "user") {
      return publicApiError("Only your own line can be stored.", "MALFORMED_REQUEST", 400);
    }
    const content =
      typeof turnRecord.content === "string" ? turnRecord.content.trim().slice(0, 800) : "";
    if (!content) {
      return publicApiError("Say something first.", "MALFORMED_REQUEST", 400);
    }
    const stored = await appendOwnedPubPalUserTurn(
      conversationId,
      ownerId,
      { role: "user", content },
      cityId,
    );
    if (!stored) return unavailable();
    return jsonNoStore({ ok: true });
  }

  const touched = await touchPubPalToolTurn(conversationId, ownerId);
  if (!touched) return unavailable();
  return jsonNoStore({ ok: true });
}
