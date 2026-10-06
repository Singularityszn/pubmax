// The Diary (Phase 1): a drinker's own dated log of pub visits.
//
// A diary entry is an OPINION about one visit, written for the person who
// made it: where, which London calendar day, an optional half-star rating and
// an optional short review. It is not a Visit Report (structured room facts
// with no stars, `lib/visitReports.ts`) and it is not a community vote
// (`lib/ratings.ts` aggregates those). Phase 1 entries are PRIVATE: only the
// owner reads them, and nothing here feeds a venue score, a feed or a count a
// stranger can see.
//
// One entry per venue per London day per owner. A second log of the same pub
// on the same day is refused, so a diary reads as nights and never as taps.
//
// Duty of care: nothing here counts consumption. An entry records a visit and
// an opinion, never how much anybody drank.
//
// Pure leaf: no I/O, no Date.now(). Every time-sensitive function takes `now`.

import { londonDayKey } from "@/lib/pintContributions";
import { parseRating, type RatingValue } from "@/lib/ratings";
import { cleanText } from "@/lib/textClean";

export const MAX_DIARY_REVIEW = 280;
const MAX_DIARY_VENUE_ID = 64;
const MAX_DIARY_VENUE_NAME = 120;

/**
 * The oldest day a diary may hold. A diary is a life log, so it reaches much
 * further back than a Visit Report's 90 days. The floor only catches a typed
 * year that cannot be a real night out.
 */
export const DIARY_EARLIEST_VISITED_ON = "2000-01-01";

/** Phase 1 has one visibility. Friends and public arrive with their policies. */
type DiaryVisibility = "private";

/** Validated fields the store persists (id and timestamps come from the store). */
export type DiaryEntryFields = {
  /** Stable profile actor (`profile:{uuid}`). Never a free-text handle. */
  ownerActor: string;
  venueId: string;
  venueName: string;
  /** The London calendar day of the visit (YYYY-MM-DD). */
  visitedOn: string;
  /** Half stars from 1 to 5, or null for a visit logged without a rating. */
  rating: RatingValue | null;
  review: string;
  visibility: DiaryVisibility;
};

export type DiaryEntry = DiaryEntryFields & {
  id: string;
  createdAt: string;
};

export type DiaryEntryDTO = DiaryEntry;

export type DiaryValidation =
  | { ok: true; value: DiaryEntryFields }
  | { ok: false; error: string };

const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

/** Today's London calendar day: the latest day a visit can be logged for. */
export function latestDiaryVisitedOn(now: Date = new Date()): string {
  return londonDayKey(now);
}

/**
 * Resolve an untrusted `visitedOn` to a London calendar day, or null when it is
 * unusable. Only a bare YYYY-MM-DD that names a real calendar day is accepted,
 * because the composer sends exactly that. Omitted means today in London. A
 * future day and a day before DIARY_EARLIEST_VISITED_ON are refused. This is
 * the server's window, so a hand-written POST meets the same bound as the date
 * input. Pure.
 */
export function resolveDiaryVisitedOn(value: unknown, now: Date = new Date()): string | null {
  const today = latestDiaryVisitedOn(now);
  if (value === undefined || value === null || value === "") return today;
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!DATE_ONLY.test(trimmed)) return null;
  // Date.parse normalises impossible days such as 30 February, so the parsed
  // value must round-trip to the same text.
  const parsed = Date.parse(`${trimmed}T00:00:00Z`);
  if (!Number.isFinite(parsed)) return null;
  if (new Date(parsed).toISOString().slice(0, 10) !== trimmed) return null;
  if (trimmed > today) return null;
  if (trimmed < DIARY_EARLIEST_VISITED_ON) return null;
  return trimmed;
}

/**
 * A review's length in characters, counted as code points: the one rule the
 * composer, the server and the database CHECK (`length(review)`) share, so an
 * emoji is one character everywhere and never two.
 */
export function diaryReviewLength(review: string): number {
  return [...review].length;
}

/** The first MAX_DIARY_REVIEW characters of what a person typed, cut on a code point. */
export function clampDiaryReviewInput(typed: string): string {
  const points = [...typed];
  return points.length > MAX_DIARY_REVIEW ? points.slice(0, MAX_DIARY_REVIEW).join("") : typed;
}

/** Control characters a review drops. Tab and newline are spacing the owner typed. */
const DIARY_REVIEW_CONTROL = /[\u0000-\u0008\u000B-\u001F\u007F]/g;

/**
 * Clean a review. It is the owner's own private words, so it is kept as typed:
 * control characters are stripped and the ends are trimmed, nothing else. No
 * copy filter runs on it, and angle brackets, newlines and inner spacing stay.
 * The length cap is a refusal in validateDiaryEntryCreate, never a cut.
 */
function cleanDiaryReview(value: unknown): string {
  if (typeof value !== "string") return "";
  return value.replace(DIARY_REVIEW_CONTROL, "").trim();
}

export function validateDiaryEntryCreate(
  input: {
    ownerActor: string;
    venueId?: unknown;
    venueName?: unknown;
    visitedOn?: unknown;
    rating?: unknown;
    review?: unknown;
    visibility?: unknown;
  },
  now: Date = new Date(),
): DiaryValidation {
  const ownerActor =
    typeof input.ownerActor === "string" && input.ownerActor.startsWith("profile:")
      ? input.ownerActor
      : "";
  if (!ownerActor) {
    return { ok: false, error: "Sign in to log a visit." };
  }

  const venueId = cleanText(input.venueId, MAX_DIARY_VENUE_ID);
  const venueName = cleanText(input.venueName, MAX_DIARY_VENUE_NAME);
  if (!venueId || !venueName) {
    return { ok: false, error: "Pick a pub from the map." };
  }

  const visitedOn = resolveDiaryVisitedOn(input.visitedOn, now);
  if (!visitedOn) {
    return { ok: false, error: "Pick the day you were there. It cannot be in the future." };
  }

  let rating: RatingValue | null = null;
  if (input.rating !== undefined && input.rating !== null && input.rating !== "") {
    rating = parseRating(input.rating);
    if (rating === null) {
      return { ok: false, error: "Pick a rating from 1 to 5 stars, in half stars." };
    }
  }

  const review = cleanDiaryReview(input.review);
  if (diaryReviewLength(review) > MAX_DIARY_REVIEW) {
    return { ok: false, error: `Keep the review to ${MAX_DIARY_REVIEW} characters.` };
  }

  if (
    input.visibility !== undefined
    && input.visibility !== null
    && input.visibility !== "private"
  ) {
    return { ok: false, error: "Diary entries are private for now." };
  }

  return {
    ok: true,
    value: {
      ownerActor,
      venueId,
      venueName,
      visitedOn,
      rating,
      review,
      visibility: "private",
    },
  };
}

/** Reverse chronological by visit day, newest log first within one day. */
export function compareDiaryEntries(a: DiaryEntry, b: DiaryEntry): number {
  if (a.visitedOn !== b.visitedOn) return a.visitedOn < b.visitedOn ? 1 : -1;
  if (a.createdAt !== b.createdAt) return a.createdAt < b.createdAt ? 1 : -1;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/** "Sun, 4 Oct 2026" for a London day key, read as the calendar day it names. */
export function diaryVisitedOnLabel(visitedOn: string): string {
  const parsed = Date.parse(`${visitedOn}T12:00:00Z`);
  if (!Number.isFinite(parsed)) return visitedOn;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(parsed));
}
