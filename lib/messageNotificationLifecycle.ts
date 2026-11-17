import { decodeWebPushSubscription, encodeWebPushSubscription } from "@/lib/webPushSubscription";
import { safeLocalStorage } from "@/lib/safeStorage";

let operations = Promise.resolve();
let departureRevision = 0;
let knownToken: string | null = null;
const pendingReleases = new Set<string>();
const RELEASE_KEY = "pubmax:pending-message-detach";
export function messagePushDepartureRevision(): number { return departureRevision; }
export function queueMessagePushOperation(operation: () => Promise<void>): Promise<void> {
  const next = operations.catch(() => undefined).then(operation);
  operations = next.catch(() => undefined);
  return next;
}

function rememberReleases(): void {
  try { safeLocalStorage()?.setItem(RELEASE_KEY, JSON.stringify([...pendingReleases])); } catch { /* The in-memory queue remains available. */ }
}
function loadReleases(): void {
  try {
    const stored: unknown = JSON.parse(safeLocalStorage()?.getItem(RELEASE_KEY) ?? "[]");
    if (Array.isArray(stored)) for (const token of stored) if (typeof token === "string" && decodeWebPushSubscription(token)) pendingReleases.add(token);
  } catch { /* A private preview also requires a current client session. */ }
}
function queueRelease(token: string): void { loadReleases(); pendingReleases.add(token); rememberReleases(); }
export async function flushMessagePushReleases(signal?: AbortSignal): Promise<void> {
  loadReleases();
  for (const token of pendingReleases) {
    const response = await fetch("/api/message-notifications", {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }),
      keepalive: true, signal: signal ?? AbortSignal.timeout(3_000),
    });
    if (!response.ok) throw new Error("Message detach is pending.");
    await response.body?.cancel();
    pendingReleases.delete(token);
    rememberReleases();
  }
}

export const MESSAGE_PUSH_DEPARTURE = "pubmax:message-push-departure";

export async function currentMessagePushToken(): Promise<string | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  knownToken = subscription ? encodeWebPushSubscription(subscription.toJSON()) : null;
  return knownToken;
}

export async function messagePushFingerprint(token: string): Promise<string> {
  const endpoint = decodeWebPushSubscription(token)?.endpoint;
  if (!endpoint) throw new Error("Invalid message subscription.");
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function releaseMessagePush(): Promise<void> {
  departureRevision += 1;
  window.dispatchEvent(new Event(MESSAGE_PUSH_DEPARTURE));
  if (knownToken) queueRelease(knownToken);
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(); }, 3_000); });
  const work = queueMessagePushOperation(async () => {
    const token = await currentMessagePushToken();
    if (token) queueRelease(token);
    if (controller.signal.aborted) return;
    const registration = await navigator.serviceWorker?.getRegistration();
    const barrier = registration?.active && new URL(registration.active.scriptURL).searchParams.get("message-previews") === "1"
      ? new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        const finish = () => { channel.port1.close(); resolve(); };
        controller.signal.addEventListener("abort", finish, { once: true });
        channel.port1.onmessage = () => { controller.signal.removeEventListener("abort", finish); finish(); };
        registration.active!.postMessage({ type: "pubmax:message-push-departure" }, [channel.port2]);
      }) : Promise.resolve();
    await Promise.allSettled([flushMessagePushReleases(controller.signal), barrier]);
    for (const notification of await registration?.getNotifications() ?? []) if (notification.data?.recipientId) notification.close();
  });
  try { await Promise.race([work, deadline]); } catch { /* Auth departure must complete even while offline. */ }
  finally { clearTimeout(timer); }
}
