import type { MessageSendAttempt } from "@/lib/messageSendAttempt";
import type { PreparedPhotoUpload } from "@/lib/preparePhotoUpload";

type Recovery = { photos: PreparedPhotoUpload[]; body: string; attempt: MessageSendAttempt | null };
type Entry = { value: Recovery; signal: AbortSignal; abort: () => void };
const recoveries = new Map<string, Entry>();
const listeners = new Set<() => void>();
let activeSends = 0;
let listening = false;

function beforeUnload(event: BeforeUnloadEvent) {
  event.preventDefault();
  event.returnValue = "";
}
function syncWarning() {
  if (typeof window === "undefined") return;
  const needed = recoveries.size > 0 || activeSends > 0;
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
export function nextMessagePhotoRecovery(prefix: string): string {
  return [...recoveries.keys()].find(owner => owner.startsWith(prefix))?.slice(prefix.length) ?? "";
}

export function warnDuringMessagePhotoSend(): () => void {
  activeSends += 1;
  syncWarning();
  let active = true;
  return () => { if (active) { active = false; activeSends -= 1; syncWarning(); } };
}

export function discardMessagePhotoRecovery(owner: string): void {
  const entry = recoveries.get(owner);
  if (!entry) return;
  entry?.signal.removeEventListener("abort", entry.abort);
  recoveries.delete(owner);
  publish();
}

export function rememberMessagePhotos(owner: string, value: Recovery, signal: AbortSignal): void {
  discardMessagePhotoRecovery(owner);
  if (signal.aborted || value.photos.length === 0) return;
  const abort = () => discardMessagePhotoRecovery(owner);
  recoveries.set(owner, { value, signal, abort });
  signal.addEventListener("abort", abort, { once: true });
  publish();
}

export function takeMessagePhotoRecovery(owner: string): Recovery | null {
  const entry = recoveries.get(owner);
  const value = entry && !entry.signal.aborted ? entry.value : null;
  discardMessagePhotoRecovery(owner);
  return value;
}
