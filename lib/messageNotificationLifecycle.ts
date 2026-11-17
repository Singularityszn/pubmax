import { decodeWebPushSubscription, encodeWebPushSubscription } from "@/lib/webPushSubscription";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";

type Binding = { token: string; sessionId: string };
let operations = Promise.resolve();
let departureRevision = 0;
let bound: Binding | null = null;
const pendingReleases = new Map<string, Binding>();
const RELEASE_KEY = "pubmax:pending-message-detach";
const BOUND_KEY = "pubmax:message-device-binding";
const bindingKey = (binding: Binding) => `${binding.sessionId}:${binding.token}`;
function isBinding(value: unknown): value is Binding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Binding;
  return typeof binding.token === "string" && Boolean(decodeWebPushSubscription(binding.token)) && typeof binding.sessionId === "string" && /^[a-f0-9-]{36}$/i.test(binding.sessionId);
}
export function messagePushDepartureRevision(): number { return departureRevision; }
export function queueMessagePushOperation(operation: () => Promise<void>): Promise<void> {
  const next = operations.catch(() => undefined).then(operation);
  operations = next.catch(() => undefined);
  return next;
}
function rememberReleases(): void {
  try { safeLocalStorage()?.setItem(RELEASE_KEY, JSON.stringify([...pendingReleases.values()])); } catch { /* The in-memory queue remains available. */ }
}
function loadReleases(): void {
  try {
    const storage = safeLocalStorage();
    if (!storage) return;
    const stored: unknown = JSON.parse(storage.getItem(RELEASE_KEY) ?? "[]");
    if (!Array.isArray(stored)) return;
    pendingReleases.clear();
    for (const binding of stored) if (isBinding(binding)) pendingReleases.set(bindingKey(binding), binding);
  } catch { /* A private preview also requires a current client session. */ }
}
export function recordMessagePushBinding(token: string, sessionId: string | null, revision = departureRevision): void {
  if (revision !== departureRevision) {
    if (sessionId) {
      const binding = { token, sessionId };
      loadReleases(); pendingReleases.set(bindingKey(binding), binding); rememberReleases();
    }
    return;
  }
  bound = sessionId ? { token, sessionId } : null;
  try {
    if (bound) safeSessionStorage()?.setItem(BOUND_KEY, JSON.stringify(bound));
    else safeSessionStorage()?.removeItem(BOUND_KEY);
  } catch { /* The marker only avoids redundant release attempts. */ }
  loadReleases();
  for (const [key, binding] of pendingReleases) if (binding.token === token) pendingReleases.delete(key);
  rememberReleases();
}
export async function flushMessagePushReleases(signal?: AbortSignal, currentToken?: string): Promise<void> {
  loadReleases();
  for (const [key, binding] of pendingReleases) {
    if (currentToken !== undefined && binding.token !== currentToken) continue;
    const response = await fetch("/api/message-notifications", {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(binding),
      keepalive: true, signal: signal ?? AbortSignal.timeout(3_000),
    });
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429;
    if (!response.ok && !permanent) throw new Error("Message detach is pending.");
    await response.body?.cancel().catch(() => undefined);
    loadReleases();
    pendingReleases.delete(key);
    rememberReleases();
  }
}

export const MESSAGE_PUSH_DEPARTURE = "pubmax:message-push-departure";
export async function currentMessagePushToken(): Promise<string | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  const subscription = await registration?.pushManager.getSubscription();
  return subscription ? encodeWebPushSubscription(subscription.toJSON()) : null;
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
  try {
    const storage = safeSessionStorage();
    if (storage) { const stored: unknown = JSON.parse(storage.getItem(BOUND_KEY) ?? "null"); bound = isBinding(stored) ? stored : null; }
  } catch { /* Retain the last in-memory binding. */ }
  if (bound) { loadReleases(); pendingReleases.set(bindingKey(bound), bound); rememberReleases(); }
  bound = null;
  try { safeSessionStorage()?.removeItem(BOUND_KEY); } catch { /* Cleanup remains best effort. */ }
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(); }, 3_000); });
  const work = queueMessagePushOperation(async () => {
    if (controller.signal.aborted) return;
    const registration = await navigator.serviceWorker?.getRegistration();
    if (controller.signal.aborted) return;
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
