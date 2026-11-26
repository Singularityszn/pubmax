import { providerOwnsSession, readProviderAccountSignal } from "@/lib/authProviderRevision";
import { waitForWebPushWork } from "@/lib/webPush";
import { authedActionFetch, compositeActionSignal } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import { currentMessagePushToken, queueMessagePushOperation, messagePushDepartureRevision, flushMessagePushReleases, nextMessagePushSequence, recordMessagePushBinding } from "@/lib/messageNotificationLifecycle";
export { currentMessagePushToken, messagePushFingerprint } from "@/lib/messageNotificationLifecycle";

export const MESSAGE_PUSH_RESTORED = "pubmax:message-push-restored";
export type MessagePushRestored = { userId: string; token: string; sessionId: string; departureRevision: number };

export const MESSAGE_NOTIFICATION_SETTINGS_CHANGED = "pubmax:message-notification-settings";

export function saveMessageNotificationSetting(body: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
  const revision = messagePushDepartureRevision();
  if (body.action === "subscribe" || body.action === "restore") return queueMessagePushOperation(async () => {
    if (signal?.aborted || revision !== messagePushDepartureRevision()) throw new Error("Account changed.");
    if (await currentMessagePushToken(signal) !== body.token) throw new Error("This device needs a new subscription. Try again.");
    if (signal?.aborted || revision !== messagePushDepartureRevision()) throw new Error("Account changed.");
    await writeSetting(body, AbortSignal.timeout(3_000));
  });
  const deadline = AbortSignal.timeout(3_000);
  return writeSetting(body, signal ? compositeActionSignal([signal, deadline]) : deadline).catch((error: unknown) => {
    if (deadline.aborted && !signal?.aborted) throw deadline.reason;
    throw error;
  });
}

async function writeSetting(body: Record<string, unknown>, signal?: AbortSignal, restoration?: { userId: string; signal: AbortSignal }): Promise<void> {
  const revision = messagePushDepartureRevision();
  const binds = body.action === "subscribe" || body.action === "restore";
  const sequence = nextMessagePushSequence();
  const response = await authedActionFetch("/api/message-notifications", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(binds ? { ...body, sequence } : body), signal,
  }, { requiresIdentity: true });
  if (!response.ok) { discardBody(response); throw new Error("Could not save message alerts. Try again."); }
  if (binds) {
    const binding = await waitForWebPushWork(response.json(), signal) as { bound?: boolean; sessionId?: string };
    if ((body.action === "subscribe" && binding.bound !== true) || typeof binding.bound !== "boolean" || (binding.bound && typeof binding.sessionId !== "string")) throw new Error("Could not confirm this device. Try again.");
    const accepted = recordMessagePushBinding(String(body.token), binding.bound ? binding.sessionId! : null, revision, sequence);
    if (accepted && binding.bound && restoration && !restoration.signal.aborted && providerOwnsSession("supabase", restoration.userId)) {
      window.dispatchEvent(new CustomEvent<MessagePushRestored>(MESSAGE_PUSH_RESTORED, { detail: { userId: restoration.userId, token: String(body.token), sessionId: binding.sessionId!, departureRevision: revision } }));
    }
    void flushMessagePushReleases(AbortSignal.timeout(1_000)).catch(() => undefined);
  } else discardBody(response);
  if (body.action !== "presence") window.dispatchEvent(new Event(MESSAGE_NOTIFICATION_SETTINGS_CHANGED));
}

export function restoreMessagePushAccount(signal: AbortSignal, userId: string): Promise<void> {
  signal = compositeActionSignal([signal, readProviderAccountSignal()]);
  const ownsSession = () => !signal.aborted && providerOwnsSession("supabase", userId);
  const revision = messagePushDepartureRevision();
  return queueMessagePushOperation(async () => {
    if (!ownsSession() || revision !== messagePushDepartureRevision()) return;
    const scope = compositeActionSignal([signal, AbortSignal.timeout(3_000)]);
    try {
      const registration = await waitForWebPushWork(navigator.serviceWorker.getRegistration(), scope);
      for (const notification of await waitForWebPushWork(registration?.getNotifications() ?? Promise.resolve([]), scope)) {
        if (!ownsSession() || revision !== messagePushDepartureRevision()) return;
        if (notification.data?.recipientId && notification.data.recipientId !== userId) notification.close();
      }
    } catch { /* Tray access must not prevent device reconciliation. */ }
    const token = await currentMessagePushToken(compositeActionSignal([signal, AbortSignal.timeout(3_000)]));
    if (token && ownsSession() && revision === messagePushDepartureRevision()) await writeSetting({ action: "restore", token }, AbortSignal.timeout(3_000), { userId, signal });
  });
}
