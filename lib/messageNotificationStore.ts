import "server-only";

import { createHash } from "node:crypto";

import { admin, selectStore } from "@/lib/storeBackend";
import { decodeWebPushSubscription } from "@/lib/webPushSubscription";

type MessageNotificationPreferences = { enabled: boolean; preview: boolean };
const DEFAULTS: MessageNotificationPreferences = { enabled: false, preview: false };

type Store = {
  preferences(userId: string): Promise<MessageNotificationPreferences>;
  savePreferences(userId: string, prefs: MessageNotificationPreferences): Promise<void>;
  muted(userId: string, conversationId: string): Promise<boolean>;
  setMuted(userId: string, conversationId: string, muted: boolean): Promise<void>;
  saveToken(userId: string, token: string, sessionId: string): Promise<void>;
  removeToken(userId: string, token: string): Promise<void>;
  tokens(userId: string): Promise<string[]>;
  registered(userId: string, fingerprint: string): Promise<boolean>;
  targets(userId: string, conversationId: string): Promise<string[]>;
  presence(userId: string, token: string, conversationId: string | null): Promise<void>;
  release(token: string, sessionId?: string): Promise<void>;
  previewAllowed(token: string, userId: string, messageId: string, sessionId: string): Promise<boolean>;
  sessionActive(userId: string, sessionId: string): Promise<boolean>;
  claim(userId: string, messageId: string): Promise<boolean>;
};

function endpointHash(token: string): string {
  const subscription = decodeWebPushSubscription(token);
  if (!subscription) throw new Error("Invalid message push subscription");
  return createHash("sha256").update(subscription.endpoint).digest("hex");
}

const prefsTable = "message_notification_preferences";
const tokensTable = "message_push_subscriptions";
const mutesTable = "message_notification_mutes";
const claimsTable = "message_notification_claims";

const durableMessageNotificationStore: Store = {
  async preferences(userId) {
    const { data, error } = await admin().from(prefsTable).select("enabled, preview").eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return data ? { enabled: data.enabled === true, preview: data.preview === true } : { ...DEFAULTS };
  },
  async savePreferences(userId, prefs) {
    const { error } = await admin().from(prefsTable).upsert({ user_id: userId, ...prefs });
    if (error) throw error;
  },
  async muted(userId, conversationId) {
    const { data, error } = await admin().from(mutesTable).select("conversation_id").eq("user_id", userId).eq("conversation_id", conversationId).maybeSingle();
    if (error) throw error;
    return Boolean(data);
  },
  async setMuted(userId, conversationId, muted) {
    const query = muted
      ? admin().from(mutesTable).upsert({ user_id: userId, conversation_id: conversationId })
      : admin().from(mutesTable).delete().eq("user_id", userId).eq("conversation_id", conversationId);
    const { error } = await query;
    if (error) throw error;
  },
  async saveToken(userId, token, sessionId) {
    const hash = endpointHash(token);
    const { error: insertError } = await admin().from(tokensTable).upsert({ endpoint_hash: hash, user_id: userId, session_id: sessionId, token }, { onConflict: "endpoint_hash", ignoreDuplicates: true });
    if (insertError) throw insertError;
    const { data, error } = await admin().from(tokensTable).update({ user_id: userId, session_id: sessionId, updated_at: new Date().toISOString(), active_conversation_id: null, last_seen: null }).eq("endpoint_hash", hash).eq("token", token).select("endpoint_hash");
    if (error) throw error;
    if (data?.length !== 1) throw new Error("Subscription secret does not match.");
  },
  async removeToken(userId, token) {
    const { error } = await admin().from(tokensTable).delete().eq("endpoint_hash", endpointHash(token)).eq("user_id", userId);
    if (error) throw error;
  },
  async tokens(userId) {
    const { data, error } = await admin().from(tokensTable).select("token").eq("user_id", userId).order("updated_at", { ascending: false }).limit(20);
    if (error) throw error;
    return (data ?? []).map((row) => String(row.token));
  },
  async targets(userId, conversationId) {
    const { data, error } = await admin().from(tokensTable).select("token, active_conversation_id, last_seen").eq("user_id", userId).order("updated_at", { ascending: false }).limit(20);
    if (error) throw error;
    return (data ?? []).filter((row) => row.active_conversation_id !== conversationId || Date.parse(String(row.last_seen)) < Date.now() - 30_000 || !row.last_seen).map((row) => String(row.token));
  },
  async registered(userId, fingerprint) {
    const { data, error } = await admin().from(tokensTable).select("endpoint_hash").eq("endpoint_hash", fingerprint).eq("user_id", userId).maybeSingle();
    if (error) throw error;
    return Boolean(data);
  },
  async presence(userId, token, conversationId) {
    const { error } = await admin().from(tokensTable).update({ active_conversation_id: conversationId, last_seen: new Date().toISOString() }).eq("endpoint_hash", endpointHash(token)).eq("user_id", userId).eq("token", token);
    if (error) throw error;
  },
  async release(token, sessionId) {
    let query = admin().from(tokensTable).delete().eq("endpoint_hash", endpointHash(token)).eq("token", token);
    if (sessionId) query = query.eq("session_id", sessionId);
    const { error } = await query;
    if (error) throw error;
  },
  async previewAllowed(token, userId, messageId, sessionId) {
    const { data, error } = await admin().from(tokensTable).select("user_id").eq("endpoint_hash", endpointHash(token)).eq("token", token).eq("user_id", userId).eq("session_id", sessionId).maybeSingle();
    if (error) throw error;
    if (!data) return false;
    const { data: claim, error: claimError } = await admin().from(claimsTable).select("message_id").eq("user_id", userId).eq("message_id", messageId).maybeSingle();
    if (claimError) throw claimError;
    return Boolean(claim);
  },
  async sessionActive(userId, sessionId) {
    const { data, error } = await admin().rpc("message_notification_session_active", { p_user_id: userId, p_session_id: sessionId });
    if (error) throw error;
    return data === true;
  },
  async claim(userId, messageId) {
    const { data, error } = await admin().from(claimsTable).upsert(
      { user_id: userId, message_id: messageId },
      { onConflict: "user_id,message_id", ignoreDuplicates: true },
    ).select("message_id");
    if (error) throw error;
    return (data ?? []).length === 1;
  },
};

const preferences = new Map<string, MessageNotificationPreferences>();
const tokens = new Map<string, { userId: string; token: string; sessionId: string; conversationId?: string | null; lastSeen?: number }>();
const mutes = new Set<string>();
const claims = new Set<string>();
export const memoryMessageNotificationStore: Store = {
  async preferences(userId) { return { ...(preferences.get(userId) ?? DEFAULTS) }; },
  async savePreferences(userId, prefs) { preferences.set(userId, { ...prefs }); },
  async muted(userId, conversationId) { return mutes.has(`${userId}:${conversationId}`); },
  async setMuted(userId, conversationId, muted) {
    const key = `${userId}:${conversationId}`;
    if (muted) mutes.add(key);
    else mutes.delete(key);
  },
  async saveToken(userId, token, sessionId) {
    const key = endpointHash(token);
    if (tokens.has(key) && tokens.get(key)?.token !== token) throw new Error("Subscription secret does not match.");
    tokens.set(key, { userId, token, sessionId });
  },
  async removeToken(userId, token) {
    const key = endpointHash(token);
    if (tokens.get(key)?.userId === userId) tokens.delete(key);
  },
  async tokens(userId) { return [...tokens.values()].filter((row) => row.userId === userId).map((row) => row.token).slice(-20); },
  async targets(userId, conversationId) { return [...tokens.values()].filter((row) => row.userId === userId && (row.conversationId !== conversationId || (row.lastSeen ?? 0) < Date.now() - 30_000)).map((row) => row.token).slice(-20); },
  async registered(userId, fingerprint) { return tokens.get(fingerprint)?.userId === userId; },
  async presence(userId, token, conversationId) {
    const row = tokens.get(endpointHash(token));
    if (row?.userId === userId && row.token === token) { row.conversationId = conversationId; row.lastSeen = Date.now(); }
  },
  async release(token, sessionId) {
    const key = endpointHash(token);
    if (tokens.get(key)?.token === token && (!sessionId || tokens.get(key)?.sessionId === sessionId)) tokens.delete(key);
  },
  async previewAllowed(token, userId, messageId, sessionId) {
    const row = tokens.get(endpointHash(token));
    return row?.token === token && row.userId === userId && row.sessionId === sessionId && claims.has(`${userId}:${messageId}`);
  },
  async sessionActive(userId, sessionId) { return [...tokens.values()].some((row) => row.userId === userId && row.sessionId === sessionId); },
  async claim(userId, messageId) {
    const key = `${userId}:${messageId}`;
    if (claims.has(key)) return false;
    claims.add(key);
    return true;
  },
};

export function messageNotificationStore(): Store {
  return selectStore(memoryMessageNotificationStore, durableMessageNotificationStore);
}
