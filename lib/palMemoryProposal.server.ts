import "server-only";

import { randomUUID } from "node:crypto";

import type { AskProposal } from "@/lib/ask/types";
import { isPubPalMemoryKind } from "@/lib/palMemoryKinds.mjs";
import { getPubPalResult } from "@/lib/pubPalStore";
import {
  appendPubPalToolTurn,
  readPubPalToolTurnBinding,
  type PubPalToolTurnBinding,
} from "@/lib/pubPalToolTurnStore";
import { cleanText } from "@/lib/textClean";

/** The Pal-only webhook tool that puts a memory card in front of the person. It never saves. */
export const PAL_PROPOSE_MEMORY_TOOL = "propose_memory";

const PAL_PROPOSAL_VALUE_LIMIT = 200;

export type PalProposeMemoryToolResult = {
  result: {
    ok: boolean;
    tool: typeof PAL_PROPOSE_MEMORY_TOOL;
    answerHint: string;
    proposals: AskProposal[];
  };
};

/**
 * Answer the propose webhook for one live conversation. The owner comes from the
 * server-side binding, never from the webhook body, and the proposal only lands
 * in a typed chat, where the card is visible, when that owner's Pal allows
 * memory proposals. The card it adds is the same
 * confirm card every proposal uses: the memory exists only once the person
 * confirms it through POST /api/pub-pal/memories.
 */
export async function proposePalMemoryForConversation(
  conversationId: string | null,
  args: Record<string, unknown>,
): Promise<PalProposeMemoryToolResult> {
  const refuse = (answerHint: string): PalProposeMemoryToolResult => ({
    result: { ok: false, tool: PAL_PROPOSE_MEMORY_TOOL, answerHint, proposals: [] },
  });
  const unavailable = "Memory proposals are unavailable right now. Nothing was saved.";
  if (!conversationId) return refuse("No one is signed in to this conversation. Nothing was saved.");
  let binding: PubPalToolTurnBinding | null;
  try {
    binding = await readPubPalToolTurnBinding(conversationId);
  } catch {
    return refuse(unavailable);
  }
  if (!binding) return refuse("No one is signed in to this conversation. Nothing was saved.");
  if (binding.surface !== "text") {
    return refuse(
      "Memory proposals are only offered in typed chat. Nothing was saved and no card was made, so do not mention one.",
    );
  }
  const { ownerId } = binding;

  let pal: Awaited<ReturnType<typeof getPubPalResult>>;
  try {
    pal = await getPubPalResult(ownerId);
  } catch {
    return refuse(unavailable);
  }
  if (!pal.ok) return refuse(unavailable);
  if (!pal.value?.proposalPreferences.memories) {
    return refuse("The person has memory proposals off. Do not offer to remember anything.");
  }

  const memoryKind = args.kind;
  const value = cleanText(args.value, PAL_PROPOSAL_VALUE_LIMIT);
  if (!isPubPalMemoryKind(memoryKind) || !value) {
    return refuse("Give one memory kind and a short value in the person's words. Nothing was saved.");
  }

  const proposal: AskProposal = {
    id: `remember:${randomUUID()}`,
    kind: "remember_memory",
    label: `Remember: ${value}`,
    memoryKind,
    value,
  };
  try {
    await appendPubPalToolTurn(conversationId, {
      proposals: [proposal],
      toolsUsed: [PAL_PROPOSE_MEMORY_TOOL],
    });
  } catch {
    return refuse(unavailable);
  }
  return {
    result: {
      ok: true,
      tool: PAL_PROPOSE_MEMORY_TOOL,
      answerHint:
        "A card is waiting in the app. Nothing is saved until the person confirms it there, so do not say it is saved.",
      proposals: [proposal],
    },
  };
}
