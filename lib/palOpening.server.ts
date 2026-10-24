import "server-only";

import { assertPalChatDeadline } from "@/lib/palChatDeadline";
import { palTasteAllowed } from "@/lib/pubPal";
import { getPubPalResult } from "@/lib/pubPalStore";
import { readConfirmedPalMemories } from "@/lib/palConfirmedMemories.server";
import { readPalTaste } from "@/lib/palTaste.server";
import { palOpeningMessage } from "@/lib/palOpening";
import { newPalLocalThreadId } from "@/lib/pubPalConversationId";
import { registerPubPalToolTurn } from "@/lib/pubPalToolTurnStore";

async function readPalOpening(ownerId: string) {
  const result = await getPubPalResult(ownerId).catch(() => null);
  if (!result?.ok) return palOpeningMessage("", { memories: null, taste: null });
  const pal = result.value;
  if (!pal || pal.hidden || !palTasteAllowed(pal.proposalPreferences)) return palOpeningMessage(pal?.name ?? "");
  const [memories, taste] = await Promise.all([readConfirmedPalMemories(ownerId), readPalTaste(ownerId)]);
  return palOpeningMessage(pal.name, { memories, taste });
}

export async function openPalConversation(ownerId: string, deadline?: number) {
  const answer = await readPalOpening(ownerId);
  if (deadline !== undefined) assertPalChatDeadline(deadline);
  const conversationId = newPalLocalThreadId();
  await registerPubPalToolTurn(conversationId, {
    ownerId, cityId: "london", query: "", turns: [{ role: "assistant", content: answer }],
    cards: [], proposals: [], hints: [answer], toolsUsed: [],
  });
  return { answer, conversationId, cards: [], proposals: [], sources: [], toolsUsed: [], status: "ready" };
}
