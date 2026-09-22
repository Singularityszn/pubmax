import { verifyElevenLabsWebhookSignature } from "@/lib/elevenLabsWebhook";
import { jsonNoStore } from "@/lib/apiResponses";
import { isSupabaseConfigured, requireSupabaseAdmin } from "@/lib/supabase";

const MAX_WEBHOOK_BYTES = 1_048_576;
const SIGNATURE_MAX_AGE_SECONDS = 60 * 60;

async function readBoundedBody(request: Request): Promise<string | null> {
  const declaredSize = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredSize) && declaredSize > MAX_WEBHOOK_BYTES) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_WEBHOOK_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    return null;
  }
}

function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

export async function POST(request: Request): Promise<Response> {
  const secret = process.env.ELEVENLABS_PUB_PAL_WEBHOOK_SECRET?.trim();
  if (!secret) return jsonNoStore({ error: "Voice reconciliation is not configured." }, { status: 503 });

  const rawBody = await readBoundedBody(request);
  if (rawBody === null) return jsonNoStore({ error: "Callback body is invalid or too large." }, { status: 413 });
  if (!verifyElevenLabsWebhookSignature(
    rawBody,
    request.headers.get("elevenlabs-signature"),
    secret,
    Date.now(),
    SIGNATURE_MAX_AGE_SECONDS,
  )) {
    return jsonNoStore({ error: "Callback authentication failed." }, { status: 401 });
  }

  let event: unknown;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return jsonNoStore({ error: "Callback payload is invalid." }, { status: 400 });
  }
  const envelope = object(event);
  if (!envelope) return jsonNoStore({ error: "Callback payload is invalid." }, { status: 400 });
  if (envelope.type !== "post_call_transcription") {
    return jsonNoStore({ received: true, ignored: true });
  }

  const data = object(envelope.data);
  const metadata = object(data?.metadata);
  const conversationId = data?.conversation_id;
  const agentId = process.env.ELEVENLABS_PUB_PAL_AGENT_ID?.trim();
  const eventTimestamp = Number(envelope.event_timestamp);
  const status = data?.status;
  const duration = metadata?.call_duration_secs;
  if (
    !data || !agentId || data.agent_id !== agentId ||
    typeof conversationId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(conversationId) ||
    !Number.isSafeInteger(eventTimestamp) || eventTimestamp <= 0 ||
    (status !== "done" && status !== "failed") ||
    typeof duration !== "number" || !Number.isFinite(duration) || duration < 0 || duration > 86_400
  ) {
    return jsonNoStore({ error: "Callback fields do not match the configured conversation contract." }, { status: 500 });
  }
  if (!isSupabaseConfigured()) return jsonNoStore({ error: "Voice reconciliation storage is unavailable." }, { status: 503 });

  try {
    const { data: reconciled, error } = await requireSupabaseAdmin().rpc("reconcile_pub_pal_voice_conversation", {
      p_conversation_id: conversationId,
      p_event_timestamp: eventTimestamp,
      p_status: status,
      p_duration_seconds: Math.ceil(duration),
    });
    if (error) return jsonNoStore({ error: "Voice reconciliation failed." }, { status: 503 });
    if (reconciled !== true) return jsonNoStore({ error: "Conversation grant was not found." }, { status: 409 });
    return jsonNoStore({ received: true });
  } catch {
    return jsonNoStore({ error: "Voice reconciliation failed." }, { status: 503 });
  }
}
