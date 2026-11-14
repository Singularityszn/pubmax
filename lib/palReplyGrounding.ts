// A matching number does not prove its venue, meaning or source. Model prose
// that states a price, clock time, date or year is refused whole. The turn
// renders those facts from its structured tool records instead. This also
// applies when the number appears in a user budget or another pub's record.
// Text streams one checked sentence at a time.

export type PalReplyClaimKind = "price" | "time" | "date" | "year";

const MONTH = String.raw`(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const DAY = String.raw`\d{1,2}(?:st|nd|rd|th)?`;
const PRICE = /[£€$]\s?\d|\b\d+(?:\.\d{1,2})?\s?(?:pounds?|quid|gbp|euros?|dollars?|pence|penn(?:y|ies))\b|\b\d{1,3}p\b(?!\.?m)/i;
const WORD_PRICE = /\b(?:a|half|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\s+(?:pounds?|quid|euros?|dollars?|pence|penn(?:y|ies))\b/i;
// A stop separates hours from minutes only beside am or pm, so £4.50 stays a price.
const CLOCK = /(?<![\d.:£])(?:([01]?\d|2[0-4]):[0-5]\d(?![\d:])(?:\s?[ap]\.?m\b\.?)?|(1[0-2]|0?[1-9])\.[0-5]\d\s?[ap]\.?m\b\.?)/i;
const TIME = /(?<![\d.:])(?:1[0-2]|0?[1-9])\s?[ap]\.?m\b\.?|\b(?:midnight|noon|midday)\b|\b(?:half\s+(?:past\s+)?|quarter\s+(?:past|to)\s+)(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve)\b|\b(?:opens?|closes?|last orders|until)\s+(?:at\s+)?\d{1,2}\b/i;
const DATE = new RegExp(String.raw`(?<!\d)${DAY}\s+(?:of\s+)?${MONTH}\b|\b${MONTH}\s+${DAY}\b(?![:.]?\d)|\b\d{4}-\d{2}-\d{2}\b`, "i");
const YEAR = /(?<![\d£.,:])(1[2-9]\d{2}|20\d{2})(?![\d:])(?!\s?(?:m\b|metres?|meters?|km|ft|feet|steps|people|kcal|calories))/i;

/** These facts must come from the record renderer, not free-text numeric matching. */
export function unsupportedPalReplyClaims(reply: string): PalReplyClaimKind[] {
  const kinds: PalReplyClaimKind[] = [];
  if (PRICE.test(reply) || WORD_PRICE.test(reply)) kinds.push("price");
  if (CLOCK.test(reply) || TIME.test(reply)) kinds.push("time");
  if (DATE.test(reply)) kinds.push("date");
  if (YEAR.test(reply)) kinds.push("year");
  return kinds;
}

// A sentence ends at a stop followed by space, or at a line break. A stop
// inside a figure, as in £4.80 or 10.30, is never followed by space.
const SENTENCE_END = /[.!?](?=\s)|\n/g;

function lastSentenceEnd(text: string): number {
  let end = 0;
  for (const match of text.matchAll(SENTENCE_END)) end = match.index + match[0].length;
  return end;
}

type ReplyStreamState = { text: string; released: number } & (
  | { state: "holding" }
  | { state: "streaming" }
  | { state: "blocked" }
);

function advanceReply(state: ReplyStreamState, delta: string, finish = false): { next: ReplyStreamState; chunk: string } {
  if (state.state === "blocked") return { next: state, chunk: "" };
  const text = state.text + delta;
  const end = finish ? text.length : lastSentenceEnd(text);
  if (end <= state.released) return { next: { ...state, text }, chunk: "" };
  if (unsupportedPalReplyClaims(text.slice(0, end)).length > 0) {
    return { next: { state: "blocked", text, released: state.released }, chunk: "" };
  }
  return {
    next: { state: "streaming", text, released: end },
    chunk: text.slice(state.released, end),
  };
}

/** Holds a complete sentence and stops permanently when it needs record-rendered facts. */
export function palReplyStreamGate() {
  let state: ReplyStreamState = { state: "holding", text: "", released: 0 };
  const step = (delta: string, finish = false) => {
    const { next, chunk } = advanceReply(state, delta, finish);
    state = next;
    return chunk;
  };
  return {
    push: (delta: string) => step(delta),
    rest: () => step("", true),
    get shown(): boolean {
      return state.released > 0;
    },
  };
}
