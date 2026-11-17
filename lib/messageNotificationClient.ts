import { authedActionFetch, compositeActionSignal } from "@/lib/authedFetch";
import { discardBody } from "@/lib/responseBody";
import { currentMessagePushToken, queueMessagePushOperation, messagePushDepartureRevision, flushMessagePushReleases, recordMessagePushBinding } from "@/lib/messageNotificationLifecycle";
export { currentMessagePushToken, messagePushFingerprint } from "@/lib/messageNotificationLifecycle";

export const MESSAGE_NOTIFICATION_SETTINGS_CHANGED = "pubmax:message-notification-settings";

export function saveMessageNotificationSetting(body: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
  const revision = messagePushDepartureRevision();
  if (body.action === "subscribe" || body.action === "restore") return queueMessagePushOperation(async () => {
    if (signal?.aborted || revision !== messagePushDepartureRevision()) throw new Error("Account changed.");
    if (await currentMessagePushToken(signal) !== body.token) throw new Error("This device needs a new subscription. Try again.");
    await writeSetting(body, AbortSignal.timeout(3_000));
  });
  const deadline = AbortSignal.timeout(3_000);
  return writeSetting(body, signal ? compositeActionSignal([signal, deadline]) : deadline).catch((error: unknown) => {
    if (deadline.aborted && !signal?.aborted) throw deadline.reason;
    throw error;
  });
}

async function writeSetting(body: Record<string, unknown>, signal?: AbortSignal): Promise<void> {
  const revision = messagePushDepartureRevision();
  const response = await authedActionFetch("/api/message-notifications", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal,
  }, { requiresIdentity: true });
  if (!response.ok) { discardBody(response); throw new Error("Could not save message alerts. Try again."); }
  if (body.action === "subscribe" || body.action === "restore") {
    const binding = await response.json() as { bound?: boolean; sessionId?: string };
    if ((body.action === "subscribe" && binding.bound !== true) || typeof binding.bound !== "boolean" || (binding.bound && typeof binding.sessionId !== "string")) throw new Error("Could not confirm this device. Try again.");
    recordMessagePushBinding(String(body.token), binding.bound ? binding.sessionId! : null, revision);
    void flushMessagePushReleases(AbortSignal.timeout(1_000)).catch(() => undefined);
  } else discardBody(response);
  if (body.action !== "presence") window.dispatchEvent(new Event(MESSAGE_NOTIFICATION_SETTINGS_CHANGED));
}

export function restoreMessagePushAccount(signal: AbortSignal, userId: string): Promise<void> {
  const revision = messagePushDepartureRevision();
  return queueMessagePushOperation(async () => {
    if (signal.aborted || revision !== messagePushDepartureRevision()) return;
    try {
      const registration = await navigator.serviceWorker.getRegistration();
      for (const notification of await registration?.getNotifications() ?? []) {
        if (notification.data?.recipientId && notification.data.recipientId !== userId) notification.close();
      }
    } catch { /* Tray access must not prevent device reconciliation. */ }
    const token = await currentMessagePushToken(signal);
    if (token && !signal.aborted) await writeSetting({ action: "restore", token }, AbortSignal.timeout(3_000));
  });
}
