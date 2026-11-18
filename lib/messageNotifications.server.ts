import "server-only";

import { bearerToken } from "@/lib/authServer";
import type { MessageDTO } from "@/lib/messages";
import { messagesStore } from "@/lib/messagesStore";
import { messageNotificationSessionFromToken } from "@/lib/messageNotificationSession";
import { messageNotificationStore } from "@/lib/messageNotificationStore";
import { messageBlockRefusal } from "@/lib/messageSafety.server";
import { isProfileTombstoned, profileStore, type ProfileRecord } from "@/lib/profileStore";
import { selectPushProvider } from "@/lib/pushProvider";
import { socialInteractionStore } from "@/lib/socialInteractionStore";

export async function messageNotificationSenderAllowed(sender: ProfileRecord, recipient: ProfileRecord): Promise<boolean> {
  if (!sender.userId || !recipient.userId || sender.userId === recipient.userId || isProfileTombstoned(sender) || isProfileTombstoned(recipient)) return false;
  const [refusal, relationship] = await Promise.all([
    messageBlockRefusal([sender.handle, recipient.handle]),
    socialInteractionStore().relationship({ accountId: recipient.userId, profileId: recipient.id, handle: recipient.handle }, sender.id),
  ]);
  return !refusal && !relationship.blocked && !relationship.muted;
}

export async function notifyMessageRecipients(message: MessageDTO): Promise<void> {
  if (message.unsent || message.flagged) return;
  const membership = await messagesStore().membership(message.conversationId);
  if (!membership?.handles.includes(message.senderHandle)) return;
  const sender = await profileStore().getByHandle(message.senderHandle);
  if (!sender?.userId || isProfileTombstoned(sender)) return;
  const store = messageNotificationStore();
  await Promise.allSettled(membership.handles.filter((handle) => handle !== sender.handle).map(async (handle) => {
    const recipient = await profileStore().getByHandle(handle);
    if (!recipient?.userId || recipient.userId === sender.userId || isProfileTombstoned(recipient)) return;
    const prefs = await store.preferences(recipient.userId);
    if (!prefs.enabled || await store.muted(recipient.userId, message.conversationId)) return;
    if (!await messageNotificationSenderAllowed(sender, recipient)) return;
    const current = (await messagesStore().listMessages(message.conversationId, handle, { messageId: message.id }))?.[0];
    if (!current || current.unsent || current.flagged || (membership.kind === "direct" && current.read)) return;
    if (!await store.claim(recipient.userId, message.id)) return;
    const tokens = await store.targets(recipient.userId, message.conversationId);
    if (tokens.length === 0) return;
    const results = await selectPushProvider("web").send(tokens, {
      title: "New message",
      body: "Open PubMaxxing to read it.",
      threadId: `message:${message.conversationId}`,
      data: { kind: "message", recipientId: recipient.userId, messageId: message.id, preview: prefs.preview ? "1" : "0", url: `/messages/${encodeURIComponent(message.conversationId)}` },
    });
    await Promise.allSettled(results.filter((result) => result.status === "invalid").map((result) => store.removeToken(recipient.userId!, result.token)));
  }));
}

export async function resolveMessageNotificationPreview(token: string, recipientId: string, conversationId: string, messageId: string, sessionId: string): Promise<{ title: string; body: string } | null> {
  const store = messageNotificationStore();
  if (!await store.sessionActive(recipientId, sessionId) || !await store.previewAllowed(token, recipientId, messageId, sessionId)) return null;
  const prefs = await store.preferences(recipientId);
  if (!prefs.enabled || !prefs.preview || await store.muted(recipientId, conversationId)) return null;
  const handle = await profileStore().getHandleByUserId(recipientId);
  const recipient = handle ? await profileStore().getByHandle(handle) : null;
  const message = handle ? (await messagesStore().listMessages(conversationId, handle, { messageId }))?.[0] : null;
  if (!recipient || !message || message.unsent || message.flagged) return null;
  const sender = await profileStore().getByHandle(message.senderHandle);
  if (!sender || !await messageNotificationSenderAllowed(sender, recipient)) return null;
  return { title: `@${sender.handle}`, body: Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(message.body.trim()), ({ segment }) => segment).slice(0, 80).join("") || "Sent an attachment." };
}

// The caller must first verify this request’s bearer with callerUserId.
export function messageNotificationSessionId(request: Request, verifiedUserId: string): string | null {
  return messageNotificationSessionFromToken(bearerToken(request), verifiedUserId);
}
