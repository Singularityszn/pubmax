// A poll inside a message: the question, the options, and what a result is
// allowed to say.
//
// PURE and browser-safe (it imports the text cleaner and nothing else), so the
// composer, the bubble, the route, the store and the migration all read one
// copy of the caps.
//
// THE FOUR RULES THIS FILE OWNS
//
// 1. COUNTS ARE DERIVED, NEVER STORED. A tally written into a row is a number
//    that can disagree with the votes behind it; `pollResults` folds the votes
//    on every read instead, exactly as the corroboration count is derived on
//    the price read path rather than kept in a column.
//
// 2. NOBODY IS NAMED. A result is counts plus the viewer's OWN answer, and that
//    is the whole of it - not for the author, not for the person who opened the
//    thread. "Who voted for the Wetherspoon" is a question a small private
//    group cannot ask without changing what people are willing to answer, and
//    the honest way to have it is to ask out loud in the thread.
//
// 3. ONE PERSON IS ONE VOTE, AND A VOTE CAN BE CHANGED. The store keys a vote
//    on (message, voter), so re-answering replaces rather than adds, and a
//    result can never carry more votes than the thread has people.
//
// 4. THE OPTIONS ARE THE BALLOT. An index is only ever read back against the
//    options the message actually stored, so a vote for option 7 of a
//    three-option poll is refused rather than counted as nothing.

import { cleanText } from "@/lib/textClean";

/** Mirrors the CHECKs in migration 0156. Keep the two in lockstep. */
export const POLL_QUESTION_MAX = 120;
export const POLL_OPTION_MAX = 60;
export const POLL_MIN_OPTIONS = 2;
export const POLL_MAX_OPTIONS = 6;

/** One option as a reader sees it: its own label, and how many chose it. */
export type MessagePollOption = Readonly<{
  index: number;
  label: string;
  votes: number;
}>;

/**
 * A poll on the wire.
 *
 * `viewerOptionIndex` is resolved PER READER at the store boundary, like
 * `mine` on a bubble, so one stored row reads correctly for everybody in the
 * thread. It is the only thing a result says about a named person, and it only
 * ever says it to that person.
 */
export type MessagePollView = Readonly<{
  question: string;
  options: readonly MessagePollOption[];
  totalVotes: number;
  viewerOptionIndex: number | null;
}>;

/** What a writer hands the store: the ballot, before anybody has answered. */
export type MessagePollWrite = Readonly<{
  question: string;
  options: readonly string[];
}>;

/**
 * Clean an untrusted question. Null when nothing survives - a poll with no
 * question is a row of buttons nobody can read.
 */
export function cleanPollQuestion(input: unknown): string | null {
  const cleaned = cleanText(input, POLL_QUESTION_MAX);
  return cleaned ? cleaned : null;
}

/**
 * Clean an untrusted option list into a ballot, or null when it is not one.
 *
 * Blank options are DROPPED rather than refused, because a composer that offers
 * six boxes and takes three answers should not fail on the three left empty.
 * Duplicates are dropped too: two identical buttons split one answer in half
 * and the result then understates what the group agreed on.
 */
export function cleanPollOptions(input: unknown): string[] | null {
  if (!Array.isArray(input)) return null;
  const seen = new Set<string>();
  const options: string[] = [];
  for (const candidate of input) {
    const cleaned = cleanText(candidate, POLL_OPTION_MAX);
    if (!cleaned) continue;
    const key = cleaned.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    options.push(cleaned);
    if (options.length > POLL_MAX_OPTIONS) return null;
  }
  return options.length >= POLL_MIN_OPTIONS ? options : null;
}

/**
 * Read an untrusted option index against a ballot of `optionCount` options.
 * Null for anything that is not a whole number inside the ballot, so a vote can
 * never name an option the message does not carry (rule 4).
 */
export function readPollOptionIndex(
  value: unknown,
  optionCount: number,
): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < 0 || value >= optionCount) return null;
  return value;
}

/**
 * Read a stored option array back. A row whose options no longer parse (a
 * hand-edited jsonb, a column that arrived as text) answers null, and the
 * caller renders the message as words rather than an unreadable ballot.
 */
export function readStoredPollOptions(value: unknown): string[] | null {
  const parsed = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? safeParseArray(value)
      : null;
  if (!parsed) return null;
  const options = parsed.filter(
    (entry): entry is string => typeof entry === "string" && entry.length > 0,
  );
  if (options.length < POLL_MIN_OPTIONS || options.length > POLL_MAX_OPTIONS) {
    return null;
  }
  return options;
}

function safeParseArray(value: string): unknown[] | null {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Fold votes into a result. `votes` maps a voter handle to the option they
 * chose; the handles are used to COUNT and are never carried into the answer
 * (rule 2). A vote naming an option outside the ballot is ignored rather than
 * counted somewhere, which is the same answer `readPollOptionIndex` gives on
 * the way in.
 */
export function pollResults(
  question: string,
  options: readonly string[],
  votes: ReadonlyMap<string, number>,
  viewer: string,
): MessagePollView {
  const counts = new Array<number>(options.length).fill(0);
  let totalVotes = 0;
  let viewerOptionIndex: number | null = null;
  for (const [handle, index] of votes) {
    if (!Number.isInteger(index) || index < 0 || index >= options.length) continue;
    counts[index] = (counts[index] ?? 0) + 1;
    totalVotes += 1;
    if (handle === viewer) viewerOptionIndex = index;
  }
  return {
    question,
    options: options.map((label, index) => ({ index, label, votes: counts[index] ?? 0 })),
    totalVotes,
    viewerOptionIndex,
  };
}

/** The share of the vote one option holds, 0 when nobody has answered yet. */
export function pollOptionShare(votes: number, totalVotes: number): number {
  if (totalVotes <= 0) return 0;
  return Math.round((votes / totalVotes) * 100);
}

// ── Copy ─────────────────────────────────────────────────────────────────────

export const POLL_COMPOSE_LABEL = "Start a poll";
export const POLL_QUESTION_LABEL = "Question";
export const POLL_QUESTION_PLACEHOLDER = "Where are we starting?";
export const POLL_OPTION_LABEL = "Option";
export const POLL_ADD_OPTION_LABEL = "Add an option";
export const POLL_ATTACH_LABEL = "Attach poll";

export const POLL_INVALID_LINE =
  "A poll needs a question and at least two different answers.";
export const POLL_VOTE_FAILED_LINE = "Couldn't record that answer. Try again.";
export const POLL_UNREADABLE_LINE = "This poll won't open just now.";

/** The tally line under a poll. Says nothing about WHO, by design (rule 2). */
export function pollTotalLine(totalVotes: number): string {
  if (totalVotes === 0) return "No answers yet";
  return totalVotes === 1 ? "1 answer" : `${totalVotes} answers`;
}

/** The accessible name of one option button: the label, its count, its share. */
export function pollOptionLabel(
  option: MessagePollOption,
  totalVotes: number,
): string {
  if (totalVotes === 0) return option.label;
  const share = pollOptionShare(option.votes, totalVotes);
  return `${option.label}. ${option.votes} of ${totalVotes}, ${share} per cent`;
}
