// A Pal reply may state a price, a clock time, a calendar date or a year only
// when the turn's evidence holds the same figure. Evidence is what the model
// was given: the person's own message and the tool results. A reply that
// states any other figure is refused whole, and the turn answers from its
// records instead. Text streams one checked sentence at a time.

export type PalReplyClaimKind = "price" | "time" | "date" | "year";

export type PalReplyEvidence = {
  prices: ReadonlySet<number>;
  times: ReadonlySet<number>;
  dates: ReadonlySet<string>;
  years: ReadonlySet<number>;
};

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const MONTH = String.raw`(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)`;
const DAY = String.raw`(\d{1,2})(?:st|nd|rd|th)?`;

const POUNDS = /£\s?(\d+(?:\.\d{1,2})?)|(?<![\d.])(\d+(?:\.\d{1,2})?)\s?(?:pounds?|quid|gbp)\b/gi;
const PENCE = /(?<![\d.£])(\d{1,3})p\b(?!\.?m)/gi;
// A stop separates hours from minutes only beside am or pm, so £4.50 stays a price.
const CLOCK = /(?<![\d.:£])(?:([01]?\d|2[0-4]):([0-5]\d)(?![\d:])(?:\s?([ap])\.?m\b\.?)?|(1[0-2]|0?[1-9])\.([0-5]\d)\s?([ap])\.?m\b\.?)/gi;
const MERIDIEM = /(?<![\d.:])(1[0-2]|0?[1-9])\s?([ap])\.?m\b\.?/gi;
const NAMED_TIME = /\b(midnight|noon|midday)\b/gi;
const DAY_MONTH = new RegExp(String.raw`(?<!\d)${DAY}\s+(?:of\s+)?${MONTH}\b`, "gi");
const MONTH_DAY = new RegExp(String.raw`\b${MONTH}\s+${DAY}\b(?![:.]?\d)`, "gi");
const CLAIMED_YEAR = /(?<![\d£.,:])(1[2-9]\d{2}|20\d{2})(?![\d:])(?!\s?(?:m\b|metres?|meters?|km|ft|feet|steps|people|kcal|calories))/gi;
const ISO_DATE = /(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?/g;
const EVIDENCE_YEAR = /(?<!\d)(1[2-9]\d{2}|20\d{2})(?!\d)/g;
const PRICE_FIELD = /"(\w*)"\s*:\s*(\d+(?:\.\d+)?)/g;
const BARE_NUMBER = /(?<![\d.])(\d+(?:\.\d{1,2})?)(?![\d.])/g;

const LONDON_STAMP = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/London",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const pence = (pounds: string) => Math.round(Number(pounds) * 100);
const dayKey = (month: number, day: number) => `${month}-${day}`;
const monthNumber = (name: string) => MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;

function clockMinutes(hour: number, minute: number, meridiem?: string): number | null {
  if (meridiem) {
    if (hour < 1 || hour > 12) return null;
    hour = (hour % 12) + (meridiem.toLowerCase() === "p" ? 12 : 0);
  }
  if (hour > 24 || (hour === 24 && minute > 0)) return null;
  return (hour * 60 + minute) % 1440;
}

type Figures = { prices: number[]; times: number[]; dates: string[]; years: number[] };

function figures(text: string, years: RegExp): Figures {
  const prices = [
    ...[...text.matchAll(POUNDS)].map((match) => pence(match[1] ?? match[2]!)),
    ...[...text.matchAll(PENCE)].map((match) => Number(match[1])),
  ];
  const times = [
    ...[...text.matchAll(CLOCK)].map((match) => match[1] !== undefined
      ? clockMinutes(Number(match[1]), Number(match[2]), match[3])
      : clockMinutes(Number(match[4]), Number(match[5]), match[6])),
    ...[...text.matchAll(MERIDIEM)].map((match) => clockMinutes(Number(match[1]), 0, match[2])),
    ...[...text.matchAll(NAMED_TIME)].map((match) => (match[1]!.toLowerCase() === "midnight" ? 0 : 720)),
  ].filter((minutes): minutes is number => minutes !== null);
  const dates = [
    ...[...text.matchAll(DAY_MONTH)].map((match) => dayKey(monthNumber(match[2]!), Number(match[1]))),
    ...[...text.matchAll(MONTH_DAY)].map((match) => dayKey(monthNumber(match[1]!), Number(match[2]))),
  ];
  return { prices, times, dates, years: [...text.matchAll(years)].map((match) => Number(match[1])) };
}

/** The figures a turn may state: those in the person's own words and in the records its tools returned. */
export function palReplyEvidence(said: string, records: readonly string[]): PalReplyEvidence {
  const evidence = { prices: new Set<number>(), times: new Set<number>(), dates: new Set<string>(), years: new Set<number>() };
  const addFigures = (found: Figures) => {
    found.prices.forEach((value) => evidence.prices.add(value));
    found.times.forEach((value) => evidence.times.add(value));
    found.dates.forEach((value) => evidence.dates.add(value));
    found.years.forEach((value) => evidence.years.add(value));
  };
  // A figure the person said may come back to them, with or without a unit.
  addFigures(figures(said, EVIDENCE_YEAR));
  for (const match of said.matchAll(BARE_NUMBER)) {
    const value = Number(match[1]);
    evidence.prices.add(pence(match[1]!));
    if (Number.isInteger(value) && value >= 1 && value <= 12) {
      evidence.times.add(value * 60);
      evidence.times.add((value + 12) * 60 % 1440);
    }
  }
  for (const record of records) {
    addFigures(figures(record, EVIDENCE_YEAR));
    for (const match of record.matchAll(PRICE_FIELD)) {
      const key = match[1]!;
      if (/pence/i.test(key)) evidence.prices.add(Math.round(Number(match[2])));
      else if (/price|gbp|cost|amount|budget/i.test(key)) evidence.prices.add(pence(match[2]!));
    }
    for (const match of record.matchAll(ISO_DATE)) {
      evidence.dates.add(dayKey(Number(match[2]), Number(match[3])));
      if (match[4] === undefined) continue;
      evidence.times.add(Number(match[4]) * 60 + Number(match[5]));
      const instant = match[6] ? Date.parse(match[0]) : Number.NaN;
      if (Number.isNaN(instant)) continue;
      // A zoned instant is stated in London time.
      const parts = Object.fromEntries(LONDON_STAMP.formatToParts(instant).map((part) => [part.type, part.value]));
      evidence.dates.add(dayKey(Number(parts.month), Number(parts.day)));
      evidence.times.add(Number(parts.hour) * 60 + Number(parts.minute));
    }
  }
  return evidence;
}

/** The kinds of figure in `reply` that the evidence does not hold. Empty means the reply may stand. */
export function unsupportedPalReplyClaims(reply: string, evidence: PalReplyEvidence): PalReplyClaimKind[] {
  const found = figures(reply, CLAIMED_YEAR);
  const kinds: PalReplyClaimKind[] = [];
  if (found.prices.some((value) => !evidence.prices.has(value))) kinds.push("price");
  if (found.times.some((value) => !evidence.times.has(value))) kinds.push("time");
  if (found.dates.some((value) => !evidence.dates.has(value))) kinds.push("date");
  if (found.years.some((value) => !evidence.years.has(value))) kinds.push("year");
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

/**
 * Holds streamed text until a whole sentence is written, and releases it only
 * when every figure written so far is supported. After one unsupported figure
 * it releases nothing more.
 */
export function palReplyStreamGate(evidence: PalReplyEvidence) {
  let text = "";
  let released = 0;
  let blocked = false;
  return {
    /** Adds a provider delta. Returns the checked text that may be shown now. */
    push(delta: string): string {
      text += delta;
      if (blocked) return "";
      const end = lastSentenceEnd(text);
      if (end <= released) return "";
      if (unsupportedPalReplyClaims(text.slice(0, end), evidence).length > 0) {
        blocked = true;
        return "";
      }
      const chunk = text.slice(released, end);
      released = end;
      return chunk;
    },
    /** The text not yet shown. Call only after the whole reply passed `unsupportedPalReplyClaims`. */
    rest(): string {
      const chunk = text.slice(released);
      released = text.length;
      return chunk;
    },
    /** Whether any text has been shown. */
    get shown(): boolean {
      return released > 0;
    },
  };
}
