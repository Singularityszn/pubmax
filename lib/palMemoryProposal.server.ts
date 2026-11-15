import "server-only";

import { randomUUID } from "node:crypto";

import { drinkCategoriesInText } from "@/lib/drinkCategoryFromText";
import type { AskProposal } from "@/lib/ask/types";
import { isPubPalMemoryKind, type PubPalMemoryKind } from "@/lib/palMemoryKinds.mjs";
import { classifyPalMemoryRelation } from "@/lib/palMemoryRelation.server";
import type { PubPalMemory } from "@/lib/pubPal";
import { getPubPalResult, listPalMemoriesResult } from "@/lib/pubPalStore";
import {
  appendPubPalToolTurn,
  pubPalTurnSaid,
  readPubPalToolTurn,
  readPubPalToolTurnBinding,
  type PubPalToolTurnBinding,
} from "@/lib/pubPalToolTurnStore";
import { cleanText } from "@/lib/textClean";

/** The Pal-only webhook tool that puts a memory card in front of the person. It never saves. */
export const PAL_PROPOSE_MEMORY_TOOL = "propose_memory";

const PAL_PROPOSAL_VALUE_LIMIT = 200;

const TOPIC: Record<Exclude<PubPalMemoryKind, "drink_preference" | "correction">, RegExp> = {
  venue_preference: /\b(?:pubs?|bars?|venues?|places?|rooms?|garden|snug|spoons|local|quiet|food|eat\w*|meat|vegetarian|vegan)\b/i,
  atmosphere_preference: /\b(?:quiet|loud|lively|music|sports?|football|quiz|crowd|vibe|rooms?)\b/i,
  accessibility_preference: /\b(?:step[- ]free|wheelchair|access\w*|stairs|guide dog|toilets?|lift)\b/i,
  transport_preference: /\b(?:home|train|tube|bus|taxi|cab|bike|cycl\w*|walk\w*|driv\w*|travel)\b/i,
  food_preference: /\b(?:food|eat\w*|dinner|lunch|meal|menu|vegetarian|vegan|meat|gluten|coeliac|dairy|allerg\w*|nuts?|pie|chips|pizza|curry)\b/i,
  night_outcome: /\b(?:night|visit|visited|birthday|anniversary|spent|went|was)\b/i,
};

function supportsMemory(kind: PubPalMemoryKind, value: string, lines: string[]): boolean {
  if (kind === "drink_preference" ? drinkCategoriesInText(value).size === 0 && !/\b(?:pints?|drinks?|budget)\b/i.test(value) : kind !== "correction" && !TOPIC[kind].test(value)) return false;
  if (kind === "correction" && !/\b(?:not|never|no longer|don['’]t|instead|rather|actually|correction|wrong)\b/i.test(value)) return false;
  const normalise = (text: string) => text.trim().replace(/[.!]+$/, "").toLocaleLowerCase("en-GB");
  const wanted = normalise(value);
  return lines.some((line) => line.split(/(?<=[.!?;])/).some((sentence) => {
    if (sentence.includes("?")) return false;
    const text = normalise(sentence);
    const requested = text.match(/^remember\s+(.+?)\s+for me$/);
    if (requested?.[1] === wanted) return true;
    if (/^forget\b/.test(text) && text === wanted) return true;
    // Only a complete first-person statement or its entire simple preference object is evidence.
    const match = text.match(/(?:^|,\s*)(i\s+(?:like|love|prefer|enjoy|drink|want|need|do not like|don['’]t like|don['’]t drink|only drink|have|use|take|went|visited|spent|was|am|had|no longer need|can['’]t stand)\s+.+|i['’]ve\s+gone off\s+.+|my\s+local\s+is\s+.+|remember\s+.+\s+for me)$/);
    if (!match || /\b(?:my friend|my mate|my partner|he|she|they)\b/.test(text)) return false;
    const statement = match[1];
    if (wanted === statement) return true;
    const simple = statement.match(/^(?:i\s+(?:like|love|prefer|enjoy|drink)\s+|remember\s+)(.+?)(?:\s+for me)?$/);
    return kind !== "correction" && kind !== "night_outcome" && simple?.[1] === wanted;
  }));
}


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
 * in a conversation with visible confirm cards, when that owner's Pal allows
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
  if (binding.surface !== "text" && binding.surface !== "voice") {
    return refuse(
      "No memory card is available in this conversation. Nothing was saved, so do not mention a card.",
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
  if (memoryKind === "drink_preference" && drinkCategoriesInText(value).size === 0) {
    return refuse("Give a drink preference in the person's words. Nothing was saved.");
  }
  const turn = await readPubPalToolTurn(conversationId).catch(() => null);
  if (!pubPalTurnSaid(turn, value)) {
    return refuse("Use only words the person said in this chat for the memory. Nothing was saved.");
  }

  const lines = [turn?.query ?? "", ...(turn?.turns.filter((line) => line.role === "user").map((line) => line.content) ?? [])];
  if (!supportsMemory(memoryKind, value, lines)) return refuse("Include the person's full preference and its qualifiers. Nothing was saved.");

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
      ? {
          id,
          kind: "remember_memory",
          label: `Update: ${value}`,
          // A "correction" names no subject of its own, so the replaced memory keeps its kind.
          memoryKind: memoryKind === "correction" ? old.kind : memoryKind,
          value,
          relation: "update",
          supersedesMemoryId: old.id,
          supersedesValue: old.value,
        }
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
