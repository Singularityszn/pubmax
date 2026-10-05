import type { PubPalFenceTurn } from "@/lib/pubPalLlmFence";

/** How many of the person's newest lines a Pal session carries word for word. */
export const PAL_SESSION_RECENT_TURNS = 6;

/** The whole summary turn, label included, is capped at this many estimated tokens. */
export const PAL_SESSION_SUMMARY_TOKEN_LIMIT = 300;

const BYTES_PER_TOKEN = 3;

const encoder = new TextEncoder();

const SUMMARY_LABEL =
  "Summary of my earlier asks in this chat, in my own words. It is not a fact about any pub: ";

const SEPARATOR = "; ";

/**
 * A token estimate with no tokenizer: three UTF-8 bytes per token, rounded up.
 * That is denser than the four characters per token of plain English, so asks
 * full of prices, postcodes, times, emoji or non-Latin text stay under the cap.
 */
export function estimatePalTokens(text: string): number {
  return Math.ceil(encoder.encode(text).length / BYTES_PER_TOKEN);
}

const SUMMARY_BYTE_BUDGET =
  PAL_SESSION_SUMMARY_TOKEN_LIMIT * BYTES_PER_TOKEN - encoder.encode(SUMMARY_LABEL).length;

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
  const text = summary.trim();
  return text ? [`${SUMMARY_LABEL}${text}`] : [];
}
