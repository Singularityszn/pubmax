// "What kind of night is it?": the Pal's question on /pal, asked once an
// evening. Cheeky pub language, never a drink nudge: each answer is the shape
// of a plan (how many pubs, how lively, cheapest first), handed to /plan as the
// words the planner already reads (lib/nightPlanning.ts), and no answer counts
// drinks. Asked from noon to midnight London time; the small hours belong to
// "get home" (lib/palSummonLine.ts), so it is never asked then.

import { LONDON_DAY_MS, londonHour, londonMsSinceMidnight } from "@/lib/londonHour";
import { londonEveningKey } from "@/lib/visitReports";

export const PAL_NIGHT_QUESTION = "Right. Quiet couple, or is it one of those nights?";

export type PalNightAnswer = "quiet" | "sesh" | "carnage";

export type PalNightChoice = {
  id: PalNightAnswer;
  label: string;
  /** The plan it makes, in a few words, under the label. */
  hint: string;
  /** What the Pal says once the person has picked it. */
  reply: string;
  /** The plan in the planner's own words: stops, mood and cheapest first. */
  plan: string;
};

export const PAL_NIGHT_CHOICES: readonly PalNightChoice[] = [
  {
    id: "quiet",
    label: "Quiet couple",
    hint: "Two pubs, nothing pricey",
    reply: "A quiet couple it is. Two pubs, nothing pricey.",
    plan: "2 pubs tonight, quiet and not pricey",
  },
  {
    id: "sesh",
    label: "Proper sesh",
    hint: "Four pubs, cheapest first",
    reply: "Proper sesh it is. Four pubs, cheapest first.",
    plan: "4 pubs tonight, lively and cheap",
  },
  {
    id: "carnage",
    label: "Absolute carnage",
    hint: "Six pubs, cheapest first",
    reply: "Absolute carnage it is. Six pubs, cheapest first, and mind the last train.",
    plan: "6 pubs tonight, lively and cheap",
  },
];

/** The first London hour the Pal asks, and it asks until midnight. */
const PAL_NIGHT_QUESTION_FROM_HOUR = 12;

/** Is it a time of day the Pal asks? Noon to midnight, London time. */
export function palNightQuestionOpen(now: Date): boolean {
  const hour = londonHour(now);
  return Number.isFinite(hour) && hour >= PAL_NIGHT_QUESTION_FROM_HOUR;
}

/**
 * How long until the question next opens (noon) or closes (midnight), London
 * time, so a page left open re-checks at the boundary rather than on a poll.
 */
export function msUntilPalNightBoundary(now: Date): number {
  const sinceMidnight = londonMsSinceMidnight(now);
  const noon = PAL_NIGHT_QUESTION_FROM_HOUR * 60 * 60 * 1000;
  return (sinceMidnight < noon ? noon : LONDON_DAY_MS) - sinceMidnight;
}

export function palNightChoice(id: unknown): PalNightChoice | null {
  return PAL_NIGHT_CHOICES.find((choice) => choice.id === id) ?? null;
}

export const PAL_NIGHT_ANSWER_STORAGE_KEY = "pubmax:pal-night-answer:v1";

type StoredAnswer = { evening: string; answer: PalNightAnswer };

/** This evening's answer on this device, or null. Yesterday's never counts. */
export function readPalNightAnswer(storage: Pick<Storage, "getItem"> | null, now: Date): PalNightChoice | null {
  try {
    const raw = storage?.getItem(PAL_NIGHT_ANSWER_STORAGE_KEY);
    if (!raw) return null;
    const value = JSON.parse(raw) as Partial<StoredAnswer> | null;
    if (!value || value.evening !== londonEveningKey(now)) return null;
    return palNightChoice(value.answer);
  } catch {
    return null;
  }
}

/** Keep this evening's answer, so the Pal does not ask twice. */
export function writePalNightAnswer(
  storage: Pick<Storage, "setItem" | "removeItem"> | null,
  answer: PalNightAnswer | null,
  now: Date,
): void {
  try {
    if (!answer) {
      storage?.removeItem(PAL_NIGHT_ANSWER_STORAGE_KEY);
      return;
    }
    const value: StoredAnswer = { evening: londonEveningKey(now), answer };
    storage?.setItem(PAL_NIGHT_ANSWER_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // A full or blocked store only means the Pal may ask again.
  }
}
