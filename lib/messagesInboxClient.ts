import { authedActionFetch } from "@/lib/authedFetch";
import { abortReason } from "@/lib/abortableDelay";
import { readProviderAccountRevision, readProviderAccountSignal } from "@/lib/authProviderRevision";
import type { ConversationDTO } from "@/lib/messages";
import { discardBody } from "@/lib/responseBody";

export type MessagesInboxRead = { status: number; conversations: ConversationDTO[]; degraded: boolean };
type Entry = {
  key: string; handle: string; promise: Promise<MessagesInboxRead>; controller: AbortController;
  waiting: number; settled: boolean; dispose: () => void;
};
let current: Entry | null = null;

export function invalidateMessagesInbox(handle?: string, supersede = true): void {
  if (!current || (handle && current.handle !== handle)) return;
  if (!supersede && !current.settled) return;
  const previous = current;
  current = null;
  previous.dispose();
}

function join(entry: Entry, signal?: AbortSignal): Promise<MessagesInboxRead> {
  entry.waiting++;
  return new Promise((resolve, reject) => {
    let finished = false;
    const finish = (result?: MessagesInboxRead, error?: unknown) => {
      if (finished) return;
      finished = true;
      signal?.removeEventListener("abort", abort);
      entry.waiting--;
      if (entry.waiting === 0 && !entry.settled) {
        if (current === entry) current = null;
        entry.dispose();
      }
      if (error !== undefined) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(undefined, abortReason(signal!));
    signal?.addEventListener("abort", abort, { once: true });
    entry.promise.then((result) => finish(result), (error) => finish(undefined, error));
    if (signal?.aborted) abort();
  });
}

/** Shares a request and its immediate render cohort, never an offline snapshot. */
export function readMessagesInbox(userId: string, handle: string, signal?: AbortSignal): Promise<MessagesInboxRead> {
  if (signal?.aborted) return Promise.reject(abortReason(signal));
  const provider = readProviderAccountSignal();
  if (provider.aborted) return Promise.reject(abortReason(provider));
  const revision = readProviderAccountRevision();
  const key = `${userId}:${handle}:${revision}`;
  if (current?.key === key) return join(current, signal);
  invalidateMessagesInbox();
  const controller = new AbortController();
  const entry: Entry = {
    key, handle, controller, waiting: 0, settled: false, dispose: () => {},
    promise: Promise.resolve({ status: 0, conversations: [], degraded: false }),
  };
  let expiry: ReturnType<typeof setTimeout> | undefined;
  const onDeparture = () => { if (current === entry) current = null; entry.dispose(); };
  entry.dispose = () => {
    clearTimeout(expiry);
    provider.removeEventListener("abort", onDeparture);
    if (!entry.settled) controller.abort();
  };
  provider.addEventListener("abort", onDeparture, { once: true });
  current = entry;
  entry.promise = authedActionFetch(`/api/messages?handle=${encodeURIComponent(handle)}`, {
    signal: controller.signal,
  }, { requiresIdentity: true }).then(async (response) => {
    if (provider.aborted || controller.signal.aborted || revision !== readProviderAccountRevision()) {
      discardBody(response);
      throw new DOMException("The inbox account changed.", "AbortError");
    }
    let result: MessagesInboxRead;
    if (!response.ok) {
      discardBody(response);
      result = { status: response.status, conversations: [], degraded: false };
    } else {
      const body = await response.json() as { conversations?: ConversationDTO[]; status?: string };
      result = { status: response.status, conversations: Array.isArray(body.conversations) ? body.conversations : [], degraded: body.status === "degraded" };
    }
    if (provider.aborted || controller.signal.aborted || revision !== readProviderAccountRevision()) {
      throw new DOMException("The inbox account changed.", "AbortError");
    }
    entry.settled = true;
    if (!response.ok) onDeparture();
    else expiry = setTimeout(onDeparture, 250);
    return result;
  }).catch((error: unknown) => {
    onDeparture();
    throw error;
  });
  return join(entry, signal);
}
