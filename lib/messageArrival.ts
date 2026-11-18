import { authedActionFetch, compositeActionSignal } from "@/lib/authedFetch";
import { readProviderAccountSignal } from "@/lib/authProviderRevision";
import type { ConversationDTO } from "@/lib/messages";
import { discardBody } from "@/lib/responseBody";
import { waitForWebPushWork } from "@/lib/webPush";

export async function selectMessageArrival(
  candidates: ConversationDTO[],
  signal: AbortSignal,
  isOpen: (conversation: ConversationDTO) => boolean,
): Promise<ConversationDTO | null> {
  const ownership = compositeActionSignal([signal, readProviderAccountSignal()]);
  for (const conversation of candidates) {
    if (ownership.aborted) return null;
    if (isOpen(conversation)) continue;
    const scope = compositeActionSignal([ownership, AbortSignal.timeout(3_000)]);
    try {
      const response = await waitForWebPushWork(authedActionFetch(`/api/message-notifications?conversationId=${encodeURIComponent(conversation.id)}`, { signal: scope }, { requiresIdentity: true }), scope);
      if (!response.ok) { discardBody(response); continue; }
      const settings = await waitForWebPushWork(response.json(), scope) as { quiet?: boolean };
      if (!scope.aborted && !isOpen(conversation) && settings.quiet === false) return conversation;
    } catch {
      if (ownership.aborted) return null;
    }
  }
  return null;
}
