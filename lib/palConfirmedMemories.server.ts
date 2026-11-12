import "server-only";

import type { PubPalMemory, PubPalMemoryKind } from "@/lib/pubPal";
import { palTastePreamble, type PalTaste } from "@/lib/palTaste";
import { readPalTaste } from "@/lib/palTaste.server";
import { listPalMemoriesResult } from "@/lib/pubPalStore";
import { PAL_RECALL_MEMORY_LIMIT, selectPalMemoriesForAsk } from "@/lib/palMemoryRelevance";
import { readPubPalToolTurn, readPubPalToolTurnBinding } from "@/lib/pubPalToolTurnStore";

/**
 * What the Pal may remember in a conversation: only lines the person wrote or
 * confirmed themselves (ADR 0006). A `completed_plan` row was inferred from a
 * night, not confirmed, so it never reaches the model.
 */
const CONFIRMED_PROVENANCE = new Set<PubPalMemory["provenance"]>(["user_confirmed", "user_correction"]);

export { PAL_RECALL_MEMORY_LIMIT };
const PAL_RECALL_VALUE_LIMIT = 200;

/** The Pal-only webhook tool that reads the bound owner's confirmed memories. It is not an ADR 0014 Ask tool. */
export const PAL_RECALL_MEMORIES_TOOL = "recall_memories";

const KIND_LABELS: Record<PubPalMemoryKind, string> = {
  venue_preference: "Pubs",
  atmosphere_preference: "Atmosphere",
  accessibility_preference: "Access",
  transport_preference: "Getting around",
  drink_preference: "Drinks",
  food_preference: "Food",
  night_outcome: "A past night",
  correction: "Correction",
};

export type PalRecalledMemory = { kind: PubPalMemoryKind; label: string; value: string };
export type PalMemorySelection = { memories: PalRecalledMemory[]; complete: boolean };

function recalled(memory: PubPalMemory): PalRecalledMemory | null {
  if (!CONFIRMED_PROVENANCE.has(memory.provenance)) return null;
  const label = KIND_LABELS[memory.kind];
  if (!label) return null;
  const value = memory.value.replace(/\s+/g, " ").trim().slice(0, PAL_RECALL_VALUE_LIMIT);
  return value ? { kind: memory.kind, label, value } : null;
}

/**
 * The account's own confirmed memories that this ask needs
 * (lib/palMemoryRelevance.ts), or null when the store failed. A missing Pal
 * has none. A typed turn still answers on null, but it says recall was
 * unavailable instead of claiming nothing is confirmed. Without an ask it is
 * the pinned kinds and the newest.
 */
export async function readConfirmedPalMemorySelection(ownerId: string, ask = ""): Promise<PalMemorySelection | null> {
  let result: Awaited<ReturnType<typeof listPalMemoriesResult>>;
  try {
    result = await listPalMemoriesResult(ownerId);
  } catch {
    return null;
  }
  if (!result.ok) return result.error === "not_found" ? { memories: [], complete: true } : null;
  const newestFirst = [...result.value]
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .map(recalled)
    .filter((line): line is PalRecalledMemory => line !== null);
  const memories = selectPalMemoriesForAsk(newestFirst, ask);
  return { memories, complete: memories.length === newestFirst.length };
}

export async function readConfirmedPalMemories(ownerId: string, ask = ""): Promise<PalRecalledMemory[] | null> {
  return (await readConfirmedPalMemorySelection(ownerId, ask))?.memories ?? null;
}

/**
 * The lines a typed turn carries ahead of the ask. It always says what is
 * confirmed, even when nothing is, so the agent never spends a recall call to
 * learn what the server already knows. A failed read says so, never "nothing".
 */
export function palMemoryPreamble(memories: PalRecalledMemory[] | null): string[] {
  if (memories === null) {
    return ["My saved memories could not be read just now. Do not assume I have none, and do not guess what they say."];
  }
  if (memories.length === 0) return ["I have not confirmed anything for you to remember about me."];
  return [
    "Things I confirmed you should remember about me. Preferences guide picks. Past nights are my personal reports, including explicitly reported spend. Preserve the stated pub and date. Never infer a bill from price observations or treat memories as current facts about a pub:",
    ...memories.map((memory) => `- ${memory.label}: ${memory.value}`),
  ];
}

export type PalRecallToolResult = {
  result: {
    ok: boolean;
    tool: typeof PAL_RECALL_MEMORIES_TOOL;
    answerHint: string;
    memories: Array<{ kind: PubPalMemoryKind; value: string }>;
  };
};

/**
 * Answer the recall webhook for one live conversation. The owner comes from the
 * server-side binding made when the signed-in account opened the session, never
 * from the webhook body, so one conversation can only read its own account's Pal.
 */
export async function recallPalMemoriesForConversation(
  conversationId: string | null,
): Promise<PalRecallToolResult> {
  const refuse = (answerHint: string): PalRecallToolResult => ({
    result: { ok: false, tool: PAL_RECALL_MEMORIES_TOOL, answerHint, memories: [] },
  });
  if (!conversationId) return refuse("No saved memories are available in this conversation.");
  // The latest line the person said in this call picks which memories matter.
  // It is the server's own stored turn, never the webhook body.
  const askRead = readPubPalToolTurn(conversationId).then(
    (turn) => turn?.query ?? "",
    () => "",
  );
  let ownerId: string | null;
  try {
    ownerId = (await readPubPalToolTurnBinding(conversationId))?.ownerId ?? null;
  } catch {
    return refuse("Saved memories are unavailable right now.");
  }
  if (!ownerId) return refuse("No saved memories are available in this conversation.");
  const ask = await askRead;
  const [memories, taste] = await Promise.all([readConfirmedPalMemories(ownerId, ask), readPalTaste(ownerId)]);
  if (!memories) return refuse("Saved memories are unavailable right now.");
  return {
    result: {
      ok: true,
      tool: PAL_RECALL_MEMORIES_TOOL,
      answerHint: palRecalledContext(memories, taste),
      memories: memories.map(({ kind, value }) => ({ kind, value })),
    },
  };
}

/** What a voice call learns about the person: their confirmed memories, then the taste read, in the third person. */
function palRecalledContext(memories: PalRecalledMemory[], taste: PalTaste | null): string {
  const tasteLines = palTastePreamble(taste, "third");
  return [
    memories.length === 0
      ? "The person has not confirmed anything to remember yet."
      : `The person confirmed these preferences and past-night reports: ${memories.map((memory) => `${memory.label}: ${memory.value}`).join("; ")}. Use preferences for picks. Past nights are personal history, including explicitly reported spend. Preserve the stated pub and date. Never infer or sum price observations into a bill, or treat memories as current facts about a pub.`,
    ...tasteLines,
  ].join(" ");
}

export function palVoiceConnectContext(selection: PalMemorySelection | null, taste: PalTaste | null): string | null {
  if (selection) {
    const recallInstruction = selection.complete
      ? "It supplies all their confirmed memories, so do not call recall_memories."
      : "It supplies a partial set of their confirmed memories. You must still call recall_memories for each ask to retrieve relevant memories omitted here.";
    return `App context at the start of this call, not something the person said. ${recallInstruction} ${palRecalledContext(selection.memories, taste)}`;
  }
  const tasteLines = palTastePreamble(taste, "third");
  return tasteLines.length > 0 ? `App context at the start of this call, not something the person said. ${tasteLines.join(" ")}` : null;
}
