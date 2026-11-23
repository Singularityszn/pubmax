/**
 * What a price's date records, and the word the screen puts before it
 * (docs/VOICE.md). A source read dates when a published source was read, and
 * never confirms tonight's price. A drinker's report keeps the day it was
 * logged, or the day the drinker saw the price.
 */
export type PriceDateKind = "read" | "logged" | "seen";

const WORDS: Record<PriceDateKind, string> = { read: "source read", logged: "logged", seen: "seen" };

export function priceDateWord(kind: PriceDateKind, opensSentence = false): string {
  const word = WORDS[kind];
  return opensSentence ? `${word[0]!.toUpperCase()}${word.slice(1)}` : word;
}
