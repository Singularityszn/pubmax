import type { PubPalFenceTurn } from "@/lib/pubPalLlmFence";

/** How many of the person's newest lines a Pal session carries word for word. */
export const PAL_SESSION_RECENT_TURNS = 6;

/** The whole summary turn, label included, never grows past this many tokens. */
export const PAL_SESSION_SUMMARY_TOKEN_LIMIT = 300;

const CHARS_PER_TOKEN = 4;

const SUMMARY_LABEL =
  "Summary of my earlier asks in this chat, in my own words. It is not a fact about any pub: ";

const SEPARATOR = "; ";

/** A conservative token count with no tokenizer: about four characters per token, rounded up. */
export function estimatePalTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

const SUMMARY_CHAR_BUDGET = PAL_SESSION_SUMMARY_TOKEN_LIMIT * CHARS_PER_TOKEN - SUMMARY_LABEL.length;

/**
 * Fold lines that fell out of the recent window into the rolling summary. Only
 * the person's own lines go in, so the summary never carries a tool answer or a
 * Pal reply. Once the cap is reached the oldest asks drop first.
 */
function rollSummary(summary: string, evicted: PubPalFenceTurn[]): string {
  const asks = [
    ...summary.split(SEPARATOR),
    ...evicted.filter((turn) => turn.role === "user").map((turn) => turn.content),
  ]
    .map((ask) => ask.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  while (asks.length > 1 && asks.join(SEPARATOR).length > SUMMARY_CHAR_BUDGET) asks.shift();
  return asks.join(SEPARATOR).slice(0, SUMMARY_CHAR_BUDGET);
}

/**
 * Keep the newest lines word for word and roll every older one into the
 * summary. The store and the typed turn both window through here, so a line is
 * never dropped without reaching the summary.
 */
export function windowPalSessionTurns(
  summary: string,
  turns: PubPalFenceTurn[],
): { summary: string; turns: PubPalFenceTurn[] } {
  const cut = Math.max(0, turns.length - PAL_SESSION_RECENT_TURNS);
  if (cut === 0) return { summary, turns };
  return { summary: rollSummary(summary, turns.slice(0, cut)), turns: turns.slice(cut) };
}

/** The one turn a typed ask carries for its older history. Empty when nothing has rolled off yet. */
export function palSessionSummaryTurn(summary: string): string[] {
  const text = summary.trim();
  return text ? [`${SUMMARY_LABEL}${text}`] : [];
}
