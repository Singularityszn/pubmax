import { decodeWebPushSubscription, encodeWebPushSubscription } from "@/lib/webPushSubscription";
import { waitForWebPushWork } from "@/lib/webPush";
import { safeLocalStorage, safeSessionStorage } from "@/lib/safeStorage";

import { INITIAL_MESSAGE_PUSH_BINDING_STATE, transitionMessagePushBinding, type MessagePushBinding as Binding, type MessagePushBindingEvent, type MessagePushRelease } from "@/lib/messagePushBindingState";
let operations = Promise.resolve();
let bindingState = INITIAL_MESSAGE_PUSH_BINDING_STATE;
let lastSequence = 0;
const RELEASE_KEY = "pubmax:pending-message-detach";
const BOUND_KEY = "pubmax:message-device-binding";
const SEQUENCE_KEY = "pubmax:message-push-sequence";
function isBinding(value: unknown): value is Binding {
  if (!value || typeof value !== "object") return false;
  const binding = value as Binding;
  return typeof binding.token === "string" && Boolean(decodeWebPushSubscription(binding.token)) && typeof binding.sessionId === "string" && /^[a-f0-9-]{36}$/i.test(binding.sessionId);
}
export function messagePushDepartureRevision(): number { return bindingState.revision; }
/** Orders this device's binding writes for the server. The order never falls, even when the clock is corrected. */
export function nextMessagePushSequence(): number {
  let stored = 0;
  try {
    const value = Number(safeLocalStorage()?.getItem(SEQUENCE_KEY));
    if (Number.isSafeInteger(value) && value > 0) stored = value;
  } catch { /* Keep the in-memory order. */ }
  lastSequence = Math.max(Date.now(), lastSequence + 1, stored + 1);
  try { safeLocalStorage()?.setItem(SEQUENCE_KEY, String(lastSequence)); } catch { /* Keep the in-memory order. */ }
  return lastSequence;
}
export function queueMessagePushOperation(operation: () => Promise<void>): Promise<void> {
  const next = operations.catch(() => undefined).then(operation);
  operations = next.catch(() => undefined);
  return next;
}
function applyBindingEvent(event: MessagePushBindingEvent): void {
  const transition = transitionMessagePushBinding(bindingState, event);
  bindingState = transition.state;
  for (const effect of transition.effects) {
    switch (effect) {
      case "announce-departure":
        window.dispatchEvent(new Event(MESSAGE_PUSH_DEPARTURE));
        break;
      case "persist-binding": {
        let saved = false;
        try {
          const storage = safeSessionStorage();
          if (storage) {
            if (bindingState.phase === "bound") storage.setItem(BOUND_KEY, JSON.stringify(bindingState.binding));
            else storage.removeItem(BOUND_KEY);
            saved = true;
          }
        } catch { saved = false; }
        applyBindingEvent({ type: "storage-result", target: "binding", saved });
        break;
      }
      case "persist-releases": {
        let saved = false;
        try {
          const storage = safeLocalStorage();
          if (storage) { storage.setItem(RELEASE_KEY, JSON.stringify(bindingState.pending)); saved = true; }
        } catch { saved = false; }
        applyBindingEvent({ type: "storage-result", target: "releases", saved });
        break;
      }
      default: {
        const unreachable: never = effect;
        return unreachable;
      }
    }
  }
}
function readReleases(): MessagePushRelease[] | undefined {
  try {
    const storage = safeLocalStorage();
    if (!storage) return;
    const stored: unknown = JSON.parse(storage.getItem(RELEASE_KEY) ?? "[]");
    // A release stored before ordering existed may only remove a binding written before ordering existed.
    if (Array.isArray(stored)) return stored.filter(isBinding).map(({ token, sessionId, sequence }: Binding & { sequence?: unknown }) => ({
      token, sessionId, sequence: typeof sequence === "number" && Number.isSafeInteger(sequence) && sequence > 0 ? sequence : 1,
    }));
  } catch { /* A private preview also requires a current client session. */ }
}
function loadReleases(): void {
  const bindings = readReleases();
  if (bindings) applyBindingEvent({ type: "releases-loaded", bindings });
}
function readBoundBinding(): Binding | null | undefined {
  try {
    const storage = safeSessionStorage();
    if (!storage) return;
    const stored: unknown = JSON.parse(storage.getItem(BOUND_KEY) ?? "null");
    return isBinding(stored) ? stored : null;
  } catch { /* Retain the last in-memory binding. */ }
}
export function recordMessagePushBinding(token: string, sessionId: string | null, revision = bindingState.revision, sequence = nextMessagePushSequence()): boolean {
  applyBindingEvent({ type: "binding-recorded", token, sessionId, revision, sequence, storedReleases: readReleases() });
  return bindingState.phase === "bound" && bindingState.revision === revision && bindingState.binding.token === token && bindingState.binding.sessionId === sessionId;
}
export async function flushMessagePushReleases(signal?: AbortSignal, currentToken?: string): Promise<void> {
  loadReleases();
  while (true) {
    const binding = bindingState.pending.find(item => currentToken === undefined || item.token === currentToken);
    if (!binding) return;
    const response = await fetch("/api/message-notifications", {
      method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify(binding),
      keepalive: true, signal: signal ?? AbortSignal.timeout(3_000),
    });
    const permanent = response.status >= 400 && response.status < 500 && response.status !== 429 && response.status !== 408;
    if (!response.ok && !permanent) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("Message detach is pending.");
    }
    if (response.ok) {
      const result = await response.json() as { ok?: boolean };
      if (result?.ok !== true) throw new Error("Message detach is pending.");
    } else await response.body?.cancel().catch(() => undefined);
    loadReleases();
    applyBindingEvent({ type: "release-confirmed", binding });
  }
}

export const MESSAGE_PUSH_DEPARTURE = "pubmax:message-push-departure";
export async function currentMessagePushToken(signal: AbortSignal = AbortSignal.timeout(3_000)): Promise<string | null> {
  if (!("serviceWorker" in navigator)) return null;
  const registration = await waitForWebPushWork(navigator.serviceWorker.getRegistration(), signal);
  if (!registration?.pushManager) return null;
  const subscription = await waitForWebPushWork(registration.pushManager.getSubscription(), signal);
  return subscription ? encodeWebPushSubscription(subscription.toJSON()) : null;
}
export async function messagePushFingerprint(token: string, signal?: AbortSignal): Promise<string> {
  const endpoint = decodeWebPushSubscription(token)?.endpoint;
  if (!endpoint) throw new Error("Invalid message subscription.");
  const bytes = await waitForWebPushWork(crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint)), signal);
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function releaseMessagePush(): Promise<void> {
  applyBindingEvent({ type: "departure-started", storedBinding: readBoundBinding(), sequence: nextMessagePushSequence(), storedReleases: readReleases() });
  const revision = bindingState.revision;
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<void>((resolve) => { timer = setTimeout(() => { controller.abort(); resolve(); }, 3_000); });
  const work = queueMessagePushOperation(async () => {
    if (controller.signal.aborted) return;
    const registration = await waitForWebPushWork(navigator.serviceWorker?.getRegistration() ?? Promise.resolve(undefined), controller.signal);
    if (controller.signal.aborted) return;
    const barrier = registration?.active && new URL(registration.active.scriptURL).searchParams.get("message-previews") === "1"
      ? new Promise<void>((resolve) => {
        const channel = new MessageChannel();
        const finish = () => { channel.port1.close(); resolve(); };
        controller.signal.addEventListener("abort", finish, { once: true });
        channel.port1.onmessage = () => { controller.signal.removeEventListener("abort", finish); finish(); };
        registration.active!.postMessage({ type: "pubmax:message-push-departure" }, [channel.port2]);
      }) : Promise.resolve();
    const closeTray = async () => {
      await barrier;
      for (const notification of await waitForWebPushWork(registration?.getNotifications() ?? Promise.resolve([]), controller.signal)) if (notification.data?.recipientId) notification.close();
    };
    await Promise.allSettled([flushMessagePushReleases(controller.signal), closeTray()]);
  });
  try { await Promise.race([work, deadline]); } catch { /* Auth departure must complete even while offline. */ }
  finally { clearTimeout(timer); applyBindingEvent({ type: "departure-settled", revision }); }
}
