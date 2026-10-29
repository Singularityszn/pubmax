import type { PalChatEntry } from "@/lib/palChatThread";
import { PUB_PAL_CONVERSATION_IDLE_MS } from "@/lib/pubPalConversationId";
import { readSurfaceSnapshot, writeSurfaceSnapshot } from "@/lib/surfaceDataCache";

export const palChatThreadKey = (owner: string) => `/pal/chat#current-thread-v2/${encodeURIComponent(owner)}`;

/** A fresh page needs no conversation parser unless this tab holds a thread. */
export function hasPalChatThread(owner: string): boolean {
  return Boolean(readSurfaceSnapshot(palChatThreadKey(owner), PUB_PAL_CONVERSATION_IDLE_MS));
}

export function clearPalChatThread(owner: string): void {
  writeSurfaceSnapshot(palChatThreadKey(owner), null);
}

/** Search results own the map until another search replaces them, including an empty result. */
export function palChatMapAnswer(entries: readonly PalChatEntry[]): Extract<PalChatEntry, { kind: "answer" }> | undefined {
  return entries.findLast((entry): entry is Extract<PalChatEntry, { kind: "answer" }> => entry.kind === "answer"
    && Boolean(entry.answer.toolsUsed?.some((tool) => tool === "search_venues" || tool === "cheapest_pint_near")));
}
