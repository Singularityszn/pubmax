import { refineVenueBudgetFollowUp } from "@/lib/ask/router";
import type { PubPalFenceTurn } from "@/lib/pubPalLlmFence";
import { PAL_SESSION_RECENT_TURNS } from "@/lib/palSessionTurns";

/** How many recent user and assistant lines a Pal session carries. */
export { PAL_SESSION_RECENT_TURNS };

/**
 * The whole summary turn, label included, is capped at this many UTF-8 bytes.
 * A byte-level BPE token always covers at least one byte, so the turn is at
 * most 300 tokens for any input: prices, postcodes, emoji or any script.
 */
export const PAL_SESSION_SUMMARY_BYTE_LIMIT = 300;

const encoder = new TextEncoder();

const SUMMARY_LABEL = "My earlier asks, not facts about any pub: ";

/** Asks are stored one per line: whitespace is collapsed, so no ask holds a newline. */
const STORED_SEPARATOR = "\n";

const RENDERED_SEPARATOR = "; ";

const SUMMARY_BYTE_BUDGET = PAL_SESSION_SUMMARY_BYTE_LIMIT - encoder.encode(SUMMARY_LABEL).length;

function byteLength(text: string): number {
  return encoder.encode(text).length;
}

/** The longest leading run of whole code points that fits the byte budget. */
function capToBudget(text: string): string {
  let used = 0;
  let out = "";
  for (const char of text) {
    used += byteLength(char);
    if (used > SUMMARY_BYTE_BUDGET) break;
    out += char;
  }
  return out;
}

/**
 * Fold lines that fell out of the recent window into the rolling summary. Only
 * the person's own lines go in, so the summary never carries a tool answer or a
 * Pal reply. Once the cap is reached the oldest asks drop first.
 */
function rollSummary(summary: string, evicted: PubPalFenceTurn[]): string {
  const asks = [
    ...summary.split(STORED_SEPARATOR),
    ...evicted.filter((turn) => turn.role === "user").map((turn) => turn.content),
  ]
    .map((ask) => ask.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  while (asks.length > 1 && byteLength(asks.join(RENDERED_SEPARATOR)) > SUMMARY_BYTE_BUDGET) asks.shift();
  if (asks.length === 1) return capToBudget(asks[0] as string);
  return asks.join(STORED_SEPARATOR);
}

/**
 * Keep the newest lines and summarize older user asks. Older assistant lines
 * do not enter the summary. The store and typed turns use the same window.
 */
export function windowPalSessionTurns(
  summary: string,
  turns: PubPalFenceTurn[],
): { summary: string; turns: PubPalFenceTurn[] } {
  const priorUsers: string[] = [];
  const resolved = turns.map((turn) => {
    if (turn.role !== "user") return turn;
    const content = refineVenueBudgetFollowUp(turn.content, priorUsers) ?? turn.content;
    priorUsers.push(content);
    return { ...turn, content };
  });
  const cut = Math.max(0, resolved.length - PAL_SESSION_RECENT_TURNS);
  return { summary: cut ? rollSummary(summary, turns.slice(0, cut)) : summary, turns: resolved.slice(cut) };
}

/** The one turn a typed ask carries for its older history. Empty when nothing has rolled off yet. */
export function palSessionSummaryTurn(summary: string): string[] {
  const text = capToBudget(
    summary
      .split(STORED_SEPARATOR)
      .map((ask) => ask.trim())
      .filter(Boolean)
      .join(RENDERED_SEPARATOR),
  );
  return text ? [`${SUMMARY_LABEL}${text}`] : [];
}
