import { createHash } from "node:crypto";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { messageNotificationStore } from "@/lib/messageNotificationStore";
import { messagesStore } from "@/lib/messagesStore";
import { messageNotificationSenderAllowed, messageNotificationSessionId, resolveMessageNotificationPreview } from "@/lib/messageNotifications.server";
import { isLimited } from "@/lib/pintDrops";
import { profileStore } from "@/lib/profileStore";
import { decodeWebPushSubscription } from "@/lib/webPushSubscription";

function validDeviceToken(value: unknown): value is string {
  return typeof value === "string" && value.length <= 2048 && Boolean(decodeWebPushSubscription(value));
}
function bindingAction(value: unknown): boolean { return value === "subscribe" || value === "restore"; }

async function conversationAccess(userId: string, id: string): Promise<boolean> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return false;
  const handle = await profileStore().getHandleByUserId(userId);
  return Boolean(handle && (await messagesStore().membership(id))?.handles.includes(handle));
}

export async function GET(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) return publicApiError("Sign in to manage message alerts.", "UNAUTHENTICATED", 401);
  const conversationId = new URL(request.url).searchParams.get("conversationId");
  try {
    if (conversationId && !await conversationAccess(userId, conversationId)) {
      return publicApiError("Conversation not found.", "NOT_FOUND", 404);
    }
    const store = messageNotificationStore();
    const [preferences, muted] = await Promise.all([
      store.preferences(userId), conversationId ? store.muted(userId, conversationId) : false,
    ]);
    let quiet = !preferences.enabled || muted;
    if (conversationId && !quiet) {
      const handle = await profileStore().getHandleByUserId(userId);
      const recipient = handle ? await profileStore().getByHandle(handle) : null;
      const latest = handle ? (await messagesStore().listMessages(conversationId, handle, { latestOnly: true }))?.[0] : null;
      const sender = latest ? await profileStore().getByHandle(latest.senderHandle) : null;
      quiet = !sender || !recipient || !await messageNotificationSenderAllowed(sender, recipient);
    }
    const fingerprint = request.headers.get("x-message-push-fingerprint");
    const registered = Boolean(fingerprint && /^[a-f0-9]{64}$/.test(fingerprint) && await store.registered(userId, fingerprint));
    return jsonNoStore({ ...preferences, muted, quiet, registered });
  } catch {
    return publicApiError("Message alerts are unavailable. Try again.", "UNAVAILABLE", 503, { retryable: true });
  }
}

export async function POST(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) return publicApiError("Sign in to manage message alerts.", "UNAUTHENTICATED", 401);
  const key = `message-notifications:${userId}`;
  if (await isLimited(`${key}:requests`, `${key}:requests`, 7200, 60 * 60 * 1000)) {
    return publicApiError("Too many changes. Try again later.", "RATE_LIMITED", 429, { retryable: true });
  }
  let body: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
    body = parsed as Record<string, unknown>;
  } catch {
    return publicApiError("Invalid request.", "INVALID_REQUEST", 400);
  }
  if (body.action !== "presence" && body.action !== "restore" && await isLimited(key, key, 60, 60 * 60 * 1000)) {
    return publicApiError("Too many changes. Try again later.", "RATE_LIMITED", 429, { retryable: true });
  }
  try {
    const store = messageNotificationStore();
    if (body.action === "preferences" && typeof body.enabled === "boolean" && typeof body.preview === "boolean") {
      await store.savePreferences(userId, { enabled: body.enabled, preview: body.preview });
    } else if (body.action === "mute" && typeof body.conversationId === "string" && typeof body.muted === "boolean") {
      if (!await conversationAccess(userId, body.conversationId)) return publicApiError("Conversation not found.", "NOT_FOUND", 404);
      await store.setMuted(userId, body.conversationId, body.muted);
    } else if (bindingAction(body.action) && validDeviceToken(body.token)) {
      const sessionId = messageNotificationSessionId(request, userId);
      if (!sessionId || !await store.sessionActive(userId, sessionId)) return publicApiError("Sign in again to enable message alerts.", "UNAUTHENTICATED", 401);
      const enabled = body.action === "subscribe" || (await store.preferences(userId)).enabled;
      if (enabled) await store.saveToken(userId, body.token, sessionId);
      else await store.release(body.token);
      return jsonNoStore({ ok: true, bound: enabled, sessionId: enabled ? sessionId : null });
    } else if (body.action === "presence" && validDeviceToken(body.token) && (body.conversationId === null || typeof body.conversationId === "string")) {
      if (body.conversationId && !await conversationAccess(userId, body.conversationId)) return publicApiError("Conversation not found.", "NOT_FOUND", 404);
      await store.presence(userId, body.token, body.conversationId);
    } else {
      return publicApiError("Invalid request.", "INVALID_REQUEST", 400);
    }
    return jsonNoStore({ ok: true });
  } catch {
    return publicApiError("Could not save message alerts. Try again.", "UNAVAILABLE", 503, { retryable: true });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  try {
    const body = await request.json() as { token?: unknown; sessionId?: unknown };
    if (typeof body?.token !== "string" || body.token.length > 2048 || !decodeWebPushSubscription(body.token) || typeof body.sessionId !== "string" || !/^[a-f0-9-]{36}$/i.test(body.sessionId)) return publicApiError("Invalid subscription.", "INVALID_REQUEST", 400);
    const key = `message-notification-release:${createHash("sha256").update(body.token).digest("hex")}`;
    if (await isLimited(key, key, 120, 60 * 60 * 1000)) return publicApiError("Too many changes. Try again later.", "RATE_LIMITED", 429);
    await messageNotificationStore().release(body.token, body.sessionId);
    return jsonNoStore({ ok: true });
  } catch (error) {
    if (error instanceof SyntaxError) return publicApiError("Invalid request.", "INVALID_REQUEST", 400);
    return publicApiError("Could not release message alerts.", "UNAVAILABLE", 503, { retryable: true });
  }
}

export async function PUT(request: Request): Promise<Response> {
  try {
    const body = await request.json() as Record<string, unknown>;
    const { token, recipientId, conversationId, messageId } = body;
    if (typeof token !== "string" || token.length > 2048 || !decodeWebPushSubscription(token) || ![recipientId, conversationId, messageId].every((id) => typeof id === "string" && /^[a-f0-9-]{36}$/i.test(id))) return publicApiError("Invalid request.", "INVALID_REQUEST", 400);
    const key = `message-notification-preview:${createHash("sha256").update(token).digest("hex")}`;
    if (await isLimited(key, key, 1200, 60 * 60 * 1000)) return publicApiError("Too many requests.", "RATE_LIMITED", 429);
    const userId = await callerUserId(request);
    const sessionId = userId ? messageNotificationSessionId(request, userId) : null;
    const preview = userId && userId === recipientId && sessionId ? await resolveMessageNotificationPreview(token, userId, conversationId as string, messageId as string, sessionId) : null;
    return jsonNoStore({ preview });
  } catch {
    return jsonNoStore({ preview: null });
  }
}
