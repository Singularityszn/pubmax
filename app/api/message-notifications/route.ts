import { createHash } from "node:crypto";
import { publicApiError } from "@/lib/apiError";
import { jsonNoStore } from "@/lib/apiResponses";
import { callerUserId } from "@/lib/authServer";
import { messageNotificationStore } from "@/lib/messageNotificationStore";
import { messagesStore } from "@/lib/messagesStore";
import { messageNotificationSenderAllowed, messageNotificationSessionId, resolveMessageNotificationPreview } from "@/lib/messageNotifications.server";
import { isLimited } from "@/lib/pintDrops";
import { profileStore, type ProfileRecord } from "@/lib/profileStore";
import { clientIp, hashIp } from "@/lib/supabase";
import { decodeWebPushSubscription } from "@/lib/webPushSubscription";

function validDeviceToken(value: unknown): value is string {
  return typeof value === "string" && value.length <= 2048 && Boolean(decodeWebPushSubscription(value));
}
type NotificationAction = "preferences" | "mute" | "subscribe" | "restore" | "presence";
type NotificationChange = {
  request: Request;
  userId: string;
  body: Record<string, unknown>;
  store: ReturnType<typeof messageNotificationStore>;
};
type NotificationHandler = (change: NotificationChange) => Promise<Response>;

function notificationAction(value: unknown): value is NotificationAction {
  return value === "preferences" || value === "mute" || value === "subscribe" || value === "restore" || value === "presence";
}

const conversationIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
async function conversationAccess(userId: string, id: string): Promise<ProfileRecord | null> {
  if (!conversationIdPattern.test(id)) return null;
  const [profile, membership] = await Promise.all([profileStore().getByUserId(userId), messagesStore().membership(id)]);
  return profile?.userId === userId && membership?.handles.includes(profile.handle) ? profile : null;
}

export async function GET(request: Request): Promise<Response> {
  const userId = await callerUserId(request);
  if (!userId) return publicApiError("Sign in to manage message alerts.", "UNAUTHENTICATED", 401);
  const params = new URL(request.url).searchParams;
  const conversationId = params.get("conversationId");
  const settingsOnly = params.get("settingsOnly") === "1";
  try {
    if (conversationId && !conversationIdPattern.test(conversationId)) return publicApiError("Conversation not found.", "NOT_FOUND", 404);
    const store = messageNotificationStore();
    const [recipient, preferences, muted] = await Promise.all([
      conversationId ? conversationAccess(userId, conversationId) : null,
      store.preferences(userId), conversationId ? store.muted(userId, conversationId) : false,
    ]);
    if (conversationId && !recipient) return publicApiError("Conversation not found.", "NOT_FOUND", 404);
    const handle = recipient?.handle;
    let quiet = !preferences.enabled || muted;
    if (conversationId && handle && !quiet && !settingsOnly) {
      const messages = await messagesStore().listMessages(conversationId, handle, { latestOnly: true });
      const latest = messages?.[0];
      const sender = latest ? await profileStore().getByHandle(latest.senderHandle) : null;
      quiet = !sender || !recipient || recipient.userId !== userId || !await messageNotificationSenderAllowed(sender, recipient);
    }
    const fingerprint = request.headers.get("x-message-push-fingerprint");
    const registered = Boolean(fingerprint && /^[a-f0-9]{64}$/.test(fingerprint) && await store.registered(userId, fingerprint));
    return jsonNoStore({ ...preferences, muted, registered, ...(!settingsOnly ? { quiet } : {}) });
  } catch {
    return publicApiError("Message alerts are unavailable. Try again.", "UNAVAILABLE", 503, { retryable: true });
  }
}

async function saveNotificationPreferences({ userId, body, store }: NotificationChange): Promise<Response> {
  if (typeof body.enabled !== "boolean" || typeof body.preview !== "boolean") return publicApiError("Invalid request.", "INVALID_REQUEST", 400);
  await store.savePreferences(userId, { enabled: body.enabled, preview: body.preview });
  return jsonNoStore({ ok: true });
}

async function muteNotificationConversation({ userId, body, store }: NotificationChange): Promise<Response> {
  if (typeof body.conversationId !== "string" || typeof body.muted !== "boolean") return publicApiError("Invalid request.", "INVALID_REQUEST", 400);
  if (!await conversationAccess(userId, body.conversationId)) return publicApiError("Conversation not found.", "NOT_FOUND", 404);
  await store.setMuted(userId, body.conversationId, body.muted);
  return jsonNoStore({ ok: true });
}

async function bindNotification({ request, userId, body, store }: NotificationChange): Promise<Response> {
  if (!validDeviceToken(body.token)) return publicApiError("Invalid request.", "INVALID_REQUEST", 400);
  const sessionId = messageNotificationSessionId(request, userId);
  if (!sessionId || !await store.sessionActive(userId, sessionId)) return publicApiError("Sign in again to enable message alerts.", "UNAUTHENTICATED", 401);
  const enabled = body.action === "subscribe" || (await store.preferences(userId)).enabled;
  if (enabled) await store.saveToken(userId, body.token, sessionId);
  else await store.release(body.token);
  return jsonNoStore({ ok: true, bound: enabled, sessionId: enabled ? sessionId : null });
}

async function updateNotificationPresence({ request, userId, body, store }: NotificationChange): Promise<Response> {
  if (!validDeviceToken(body.token) || (body.conversationId !== null && typeof body.conversationId !== "string")
    || typeof body.activityId !== "number" || !Number.isSafeInteger(body.activityId) || body.activityId <= 0
    || typeof body.revision !== "number" || !Number.isSafeInteger(body.revision) || body.revision <= 0) {
    return publicApiError("Invalid request.", "INVALID_REQUEST", 400);
  }
  const sessionId = messageNotificationSessionId(request, userId);
  if (!sessionId || !await store.sessionActive(userId, sessionId)) return publicApiError("Sign in again to enable message alerts.", "UNAUTHENTICATED", 401);
  if (body.conversationId && !await conversationAccess(userId, body.conversationId)) return publicApiError("Conversation not found.", "NOT_FOUND", 404);
  await store.presence(userId, body.token, body.conversationId, sessionId, body.activityId, body.revision);
  return jsonNoStore({ ok: true });
}

const notificationHandlers: Record<NotificationAction, NotificationHandler> = {
  preferences: saveNotificationPreferences,
  mute: muteNotificationConversation,
  subscribe: bindNotification,
  restore: bindNotification,
  presence: updateNotificationPresence,
};

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
    if (!notificationAction(body.action)) return publicApiError("Invalid request.", "INVALID_REQUEST", 400);
    return await notificationHandlers[body.action]({ request, userId, body, store });
  } catch {
    return publicApiError("Could not save message alerts. Try again.", "UNAVAILABLE", 503, { retryable: true });
  }
}

export async function DELETE(request: Request): Promise<Response> {
  const ipKey = `message-notification-release-ip:${hashIp(clientIp(request))}`;
  if (await isLimited(ipKey, ipKey, 7200, 60 * 60 * 1000)) return publicApiError("Too many requests.", "RATE_LIMITED", 429);
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
    const userId = await callerUserId(request);
    if (!userId || userId !== recipientId) return jsonNoStore({ preview: null });
    const key = `message-notification-preview:${userId}`;
    if (await isLimited(key, key, 1200, 60 * 60 * 1000)) return publicApiError("Too many requests.", "RATE_LIMITED", 429);
    const sessionId = userId ? messageNotificationSessionId(request, userId) : null;
    const preview = userId && userId === recipientId && sessionId ? await resolveMessageNotificationPreview(token, userId, conversationId as string, messageId as string, sessionId) : null;
    return jsonNoStore({ preview });
  } catch {
    return jsonNoStore({ preview: null });
  }
}
