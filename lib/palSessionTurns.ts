import type { AskTurn } from "@/lib/ask/types";

export const PAL_SESSION_RECENT_TURNS = 6;

export async function recentPalSessionTurns(turns: readonly AskTurn[]): Promise<AskTurn[]> {
  if (turns.every((turn) => turn.role === "assistant")) return turns.slice(-PAL_SESSION_RECENT_TURNS);
  const { windowPalSessionTurns } = await import("@/lib/palSessionSummary");
  return windowPalSessionTurns("", [...turns]).turns;
}
