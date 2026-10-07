// The face and the name of the other person on each direct inbox row.
//
// The inbox store reads conversations and unread counts and knows handles, so
// the surface drew a monogram and printed `@handle` for everybody, even people
// with a photo and a display name that every other list already shows. One
// batch read of the public cards joins them on, for the whole inbox at once:
// a per-row point read would fan out one request per conversation.
//
// It is the PUBLIC card (`getPublicCardsByHandles`): a display name and an
// approved, owned avatar, nothing a visitor could not already read. A handle
// that has withdrawn from public view gets no card, and a read that fails
// leaves the inbox exactly as the store returned it.

import "server-only";

import { withdrawnHandles } from "@/lib/accountPublicAccess.server";
import type { ConversationDTO } from "@/lib/messages";
import { normalizeHandle } from "@/lib/profiles";
import { profileStore } from "@/lib/profileStore";

export async function attachParticipantCards(
  conversations: readonly ConversationDTO[],
): Promise<ConversationDTO[]> {
  const direct = conversations.filter(
    (conversation) => (conversation.kind ?? "direct") !== "group" && conversation.otherHandle,
  );
  const handles = [
    ...new Set(direct.map((conversation) => normalizeHandle(conversation.otherHandle))),
  ].filter(Boolean);
  if (handles.length === 0) return [...conversations];

  let cards: Awaited<ReturnType<ReturnType<typeof profileStore>["getPublicCardsByHandles"]>>;
  let withdrawn: ReadonlySet<string>;
  try {
    [cards, withdrawn] = await Promise.all([
      profileStore().getPublicCardsByHandles(handles),
      withdrawnHandles(handles),
    ]);
  } catch {
    return [...conversations];
  }

  return conversations.map((conversation) => {
    const key = normalizeHandle(conversation.otherHandle);
    const card = (conversation.kind ?? "direct") === "group" || withdrawn.has(key)
      ? undefined
      : cards.get(key);
    if (!card) return conversation;
    return {
      ...conversation,
      ...(card.displayName ? { otherDisplayName: card.displayName } : {}),
      ...(card.avatarUrl ? { otherAvatarUrl: card.avatarUrl } : {}),
    };
  });
}
