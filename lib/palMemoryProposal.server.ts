import "server-only";

import { randomUUID } from "node:crypto";

import type { AskProposal } from "@/lib/ask/types";
import { isPubPalMemoryKind } from "@/lib/palMemoryKinds.mjs";
import { classifyPalMemoryRelation } from "@/lib/palMemoryRelation.server";
import type { PubPalMemory } from "@/lib/pubPal";
import { getPubPalResult, listPalMemoriesResult } from "@/lib/pubPalStore";
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
 *
 * Before the card is made, the fact is sorted against the person's confirmed
 * memories (`lib/palMemoryRelation.server.ts`). A fact they already have makes
 * no card. One that replaces or withdraws a memory makes an update or forget
 * card for that memory, which changes it only when they confirm, through the
 * same owner-checked PATCH or DELETE their Pal page uses.
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

  let confirmed: PubPalMemory[] = [];
  try {
    const listed = await listPalMemoriesResult(ownerId);
    if (listed.ok) confirmed = listed.value;
  } catch {
    confirmed = [];
  }
  const related = await classifyPalMemoryRelation({ kind: memoryKind, value }, confirmed);
  const old = related.relation === "add" ? undefined : related.memory;
  if (related.relation === "noop" && old) {
    return {
      result: {
        ok: true,
        tool: PAL_PROPOSE_MEMORY_TOOL,
        answerHint: `The person already has this memory: "${old.value}". Nothing new to save and no card was made, so do not offer one.`,
        proposals: [],
      },
    };
  }

  const id = `remember:${randomUUID()}`;
  const proposal: AskProposal =
    related.relation === "update" && old
      ? { id, kind: "remember_memory", label: `Update: ${value}`, memoryKind, value, relation: "update", supersedesMemoryId: old.id, supersedesValue: old.value }
      : related.relation === "delete" && old
        ? { id, kind: "remember_memory", label: `Forget: ${old.value}`, memoryKind: old.kind, value: old.value, relation: "delete", supersedesMemoryId: old.id, supersedesValue: old.value }
        : { id, kind: "remember_memory", label: `Remember: ${value}`, memoryKind, value };
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
        proposal.kind === "remember_memory" && proposal.relation === "update"
          ? `A card is waiting in the app to replace the memory "${proposal.supersedesValue}". Nothing changes until the person confirms it there, so do not say it is saved.`
          : proposal.kind === "remember_memory" && proposal.relation === "delete"
            ? `A card is waiting in the app to forget the memory "${proposal.supersedesValue}". Nothing is forgotten until the person confirms it there, so do not say it is gone.`
            : "A card is waiting in the app. Nothing is saved until the person confirms it there, so do not say it is saved.",
      proposals: [proposal],
    },
  };
}
