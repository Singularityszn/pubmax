import type { MessageDTO, ThreadIdentity } from "@/lib/messages";
import { normalizeHandle } from "@/lib/profiles";
import { readSurfaceSnapshot, writeSurfaceSnapshot } from "@/lib/surfaceDataCache";

export type ThreadSnapshot = {
  messages: MessageDTO[];
  identity: ThreadIdentity | null;
  otherHandle: string;
};

export function messageSnapshotKey(
  userId: string | undefined,
  accountRevision: number,
  handle: string | null | undefined,
  conversationId?: string,
): string | null {
  if (!userId || !handle) return null;
  return JSON.stringify(["messages", userId, accountRevision, normalizeHandle(handle), conversationId ?? null]);
}

export function rememberMessageSnapshot<T>(key: string | null, value: T, preserveAge = false): void {
  if (key) writeSurfaceSnapshot(key, value, Date.now(), { persist: false, preserveAge });
}

export function rememberSentMessage(key: string | null, message: MessageDTO): void {
  if (!key) return;
  const held = readSurfaceSnapshot<ThreadSnapshot>(key);
  if (!held) return;
  rememberMessageSnapshot(key, {
    ...held,
    messages: [...held.messages.filter(row => row.id !== message.id), message],
  }, true);
}
