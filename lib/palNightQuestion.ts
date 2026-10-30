// "What kind of night is it?": the Pal's question on /pal, asked once an
// evening. Cheeky pub language, never a drink nudge: each answer is the shape
// of a plan (how many pubs, how lively, on a budget), handed to /plan as the
// words the planner already reads (lib/nightPlanning.ts), and no answer counts
// drinks. Asked from noon to midnight London time; the small hours belong to
// "get home" (lib/palSummonLine.ts), so it is never asked then.

import { LONDON_DAY_MS, londonHour, londonMsSinceMidnight } from "@/lib/londonHour";
import { londonEveningKey } from "@/lib/visitReports";

export const PAL_NIGHT_QUESTION = "Right. Quiet pint, or a big one tonight?";

// The three answers use the approved CAP set (docs/CAP_COPY_AUDIT_2026-07-21.md).
// No answer plans more than four pubs: a one-tap six-pub night read as a
// quantity nudge, and "carnage" and session words are banned.
export type PalNightAnswer = "quiet" | "big" | "loud";

export type PalNightChoice = {
  id: PalNightAnswer;
  label: string;
  /** The plan it makes, in a few words, under the label. */
  hint: string;
  /** What the Pal says once the person has picked it. */
  reply: string;
  /** The plan in the planner's own words: stops, mood and a value budget. */
  plan: string;
};

export const PAL_NIGHT_CHOICES: readonly PalNightChoice[] = [
  {
    id: "quiet",
    label: "Quiet pint",
    hint: "Two quiet pubs, on a budget",
    reply: "A quiet pint it is. Two quiet pubs, on a budget.",
    plan: "2 pubs tonight, quiet and not pricey",
  },
  {
    id: "big",
    label: "Big one tonight",
    hint: "Four lively pubs, on a budget",
    reply: "A big one it is. Four lively pubs, on a budget, and mind the last train.",
    plan: "4 pubs tonight, lively and cheap",
  },
  {
    id: "loud",
    label: "Live and loud",
    hint: "Four pubs with music or a lively crowd, on a budget",
    reply: "Live and loud it is. Four pubs with music or a lively crowd, on a budget, and mind the last train.",
    plan: "4 pubs tonight, lively with live music, and cheap",
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
 * A clock change before the boundary makes that day 23 or 25 hours long, so
 * the wall-clock gap is corrected by where London's clock really lands.
 */
export function msUntilPalNightBoundary(now: Date): number {
  const sinceMidnight = londonMsSinceMidnight(now);
  const noon = PAL_NIGHT_QUESTION_FROM_HOUR * 60 * 60 * 1000;
  const goal = sinceMidnight < noon ? noon : 0;
  const gap = (sinceMidnight < noon ? noon : LONDON_DAY_MS) - sinceMidnight;
  let drift = londonMsSinceMidnight(new Date(now.getTime() + gap)) - goal;
  if (drift > LONDON_DAY_MS / 2) drift -= LONDON_DAY_MS;
  if (drift < -LONDON_DAY_MS / 2) drift += LONDON_DAY_MS;
  return gap - drift;
}

/**
 * The words that ride with tonight's crew link. They name the Pal and tonight,
 * never the pubs, a price or a count, and ask the way the plan page already
 * does ("Open the link and tap I'm in."). They never name the evening's answer:
 * the saved plan may not be the one the answer made, so the words could
 * describe a different night.
 */
export function palNightInviteText(palName: string): string {
  const name = palName.trim() || "My Pal";
  return `${name}'s got a plan for tonight. Open the link and tap I'm in.`;
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
