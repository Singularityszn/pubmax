import "server-only";

import type { PubPalMemory, PubPalMemoryKind } from "@/lib/pubPal";
import { listPalMemoriesResult } from "@/lib/pubPalStore";
import { readPubPalToolTurnBinding } from "@/lib/pubPalToolTurnStore";

/**
 * What the Pal may remember in a conversation: only lines the person wrote or
 * confirmed themselves (ADR 0006). A `completed_plan` row was inferred from a
 * night, not confirmed, so it never reaches the model.
 */
const CONFIRMED_PROVENANCE = new Set<PubPalMemory["provenance"]>(["user_confirmed", "user_correction"]);

export const PAL_RECALL_MEMORY_LIMIT = 8;
const PAL_RECALL_VALUE_LIMIT = 200;

/** The Pal-only webhook tool that reads the bound owner's confirmed memories. It is not an ADR 0014 Ask tool. */
export const PAL_RECALL_MEMORIES_TOOL = "recall_memories";

const KIND_LABELS: Record<PubPalMemoryKind, string> = {
  venue_preference: "Pubs",
  atmosphere_preference: "Atmosphere",
  accessibility_preference: "Access",
  transport_preference: "Getting around",
  drink_preference: "Drinks",
  night_outcome: "A past night",
  correction: "Correction",
};

export type PalRecalledMemory = { kind: PubPalMemoryKind; label: string; value: string };

function recalled(memory: PubPalMemory): PalRecalledMemory | null {
  if (!CONFIRMED_PROVENANCE.has(memory.provenance)) return null;
  const label = KIND_LABELS[memory.kind];
  if (!label) return null;
  const value = memory.value.replace(/\s+/g, " ").trim().slice(0, PAL_RECALL_VALUE_LIMIT);
  return value ? { kind: memory.kind, label, value } : null;
}

/**
 * The newest confirmed memories of the account's own Pal, or null when the
 * store failed. A missing Pal has none. A typed turn still answers on null, but
 * it says recall was unavailable instead of claiming nothing is confirmed.
 */
export async function readConfirmedPalMemories(ownerId: string): Promise<PalRecalledMemory[] | null> {
  let result: Awaited<ReturnType<typeof listPalMemoriesResult>>;
  try {
    result = await listPalMemoriesResult(ownerId);
  } catch {
    return null;
  }
  if (!result.ok) return result.error === "not_found" ? [] : null;
  const newestFirst = [...result.value].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const out: PalRecalledMemory[] = [];
  for (const memory of newestFirst) {
    const line = recalled(memory);
    if (line) out.push(line);
    if (out.length >= PAL_RECALL_MEMORY_LIMIT) break;
  }
  return out;
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
    "Things I confirmed you should remember about me. Use them as preferences, never as facts about a pub:",
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
  let ownerId: string | null;
  try {
    ownerId = (await readPubPalToolTurnBinding(conversationId))?.ownerId ?? null;
  } catch {
    return refuse("Saved memories are unavailable right now.");
  }
  if (!ownerId) return refuse("No saved memories are available in this conversation.");
  const memories = await readConfirmedPalMemories(ownerId);
  if (!memories) return refuse("Saved memories are unavailable right now.");
  return {
    result: {
      ok: true,
      tool: PAL_RECALL_MEMORIES_TOOL,
      answerHint:
        memories.length === 0
          ? "The person has not confirmed anything to remember yet."
          : `The person confirmed these preferences: ${memories.map((memory) => `${memory.label}: ${memory.value}`).join("; ")}. Treat them as preferences, never as facts about a pub.`,
      memories: memories.map(({ kind, value }) => ({ kind, value })),
    },
  };
}
