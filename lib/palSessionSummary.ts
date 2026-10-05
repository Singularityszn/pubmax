import type { PubPalFenceTurn } from "@/lib/pubPalLlmFence";

/** How many of the person's newest lines a Pal session carries word for word. */
export const PAL_SESSION_RECENT_TURNS = 6;

/**
 * The whole summary turn, label included, is capped at this many UTF-8 bytes.
 * A byte-level BPE token always covers at least one byte, so the turn is at
 * most 300 tokens for any input: prices, postcodes, emoji or any script.
 */
export const PAL_SESSION_SUMMARY_BYTE_LIMIT = 300;

const encoder = new TextEncoder();

const SUMMARY_LABEL = "My earlier asks, not facts about any pub: ";

const SEPARATOR = "; ";

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
    ...summary.split(SEPARATOR),
    ...evicted.filter((turn) => turn.role === "user").map((turn) => turn.content),
  ]
    .map((ask) => ask.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  while (asks.length > 1 && byteLength(asks.join(SEPARATOR)) > SUMMARY_BYTE_BUDGET) asks.shift();
  return capToBudget(asks.join(SEPARATOR));
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
  const text = capToBudget(summary.trim());
  return text ? [`${SUMMARY_LABEL}${text}`] : [];
}
