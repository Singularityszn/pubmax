import type { MessageSendAttempt } from "@/lib/messageSendAttempt";
import type { PreparedPhotoUpload } from "@/lib/preparePhotoUpload";

type Recovery = {
  photos: PreparedPhotoUpload[];
  body: string;
  attempt: MessageSendAttempt | null;
  failure: { message: string; operation: "prepare" | "send" } | null;
};
type Entry = { value: Recovery; signal: AbortSignal; abort: () => void };
const recoveries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let listening = false;

function beforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}
function syncWarning() {
  if (typeof window === "undefined") return;
  const needed = recoveries.size > 0;
  if (needed === listening) return;
  listening = needed;
  if (needed) window.addEventListener("beforeunload", beforeUnload);
  else window.removeEventListener("beforeunload", beforeUnload);
}

function publish() { syncWarning(); for (const listener of listeners) listener(); }
export function subscribeMessagePhotoRecovery(listener: () => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function nextMessagePhotoRecovery(prefix: string, excludedConversationId: string = ""): string {
  return [...recoveries.keys()].find(owner => owner.startsWith(prefix) && owner.slice(prefix.length) !== excludedConversationId)?.slice(prefix.length) ?? "";
}

export function discardMessagePhotoRecovery(owner: string): void {
  const entry = recoveries.get(owner);
  if (!entry) return;
  entry.signal.removeEventListener("abort", entry.abort);
  recoveries.delete(owner);
  publish();
}

export function rememberMessagePhotos(owner: string, value: Recovery, signal: AbortSignal): void {
  if (signal.aborted || value.photos.length === 0) { discardMessagePhotoRecovery(owner); return; }
  const existing = recoveries.get(owner);
  if (existing?.signal === signal) {
    existing.value = value;
    publish();
    return;
  }
  discardMessagePhotoRecovery(owner);
  const abort = () => discardMessagePhotoRecovery(owner);
  recoveries.set(owner, { value, signal, abort });
  signal.addEventListener("abort", abort, { once: true });
  publish();
}

export function readMessagePhotoRecovery(owner: string): Recovery | null {
  const entry = recoveries.get(owner);
  const value = entry && !entry.signal.aborted ? entry.value : null;
  return value;
}
