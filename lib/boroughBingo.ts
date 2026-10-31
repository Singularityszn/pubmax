// Borough bingo (launch review D8): a 33-square card, one square for each
// London borough and one for the City, on the owner's own profile.
//
// BREADTH, NEVER VOLUME. A square is filled by the Pint Passport's own borough
// stamp (lib/passport.ts): one confirmed pint in that borough. A second pint in
// the same borough adds nothing, so the card can only ever say how much of
// London a person has drunk in, never how much they drank.
//
// NOTHING COMPETITIVE. The card prints "12 of 33 boroughs" and nothing else:
// no rank, no streak, no comparison, no reward. A mutual reads the count line
// only, a stranger reads nothing, and the share card exists at three marks
// (11, 22 and 33) the owner chooses to send. Pure and browser-safe.

import { LONDON_BOROUGHS, slugifyBorough } from "@/lib/boroughs";

export const BOROUGH_BINGO_TOTAL = LONDON_BOROUGHS.length;

/** The three marks a share card exists for: a third, two thirds, all of London. */
const BOROUGH_BINGO_MARKS = [11, 22, 33] as const;
export type BoroughBingoMark = (typeof BOROUGH_BINGO_MARKS)[number];

type BoroughBingoSquare = { name: string; slug: string; filled: boolean };

export type BoroughBingoCard = {
  /** All 33 squares in alphabetical order, so a square never moves. */
  squares: BoroughBingoSquare[];
  filled: number;
  total: number;
};

const SQUARES = [...LONDON_BOROUGHS]
  .map((name) => ({ name, slug: slugifyBorough(name) }))
  .sort((a, b) => a.name.localeCompare(b.name, "en-GB"));

/**
 * The card for a set of stamped boroughs. Anything that is not one of the 33
 * (a neighbourhood, a typo, a city elsewhere) fills nothing, and a name given
 * twice fills its square once.
 */
export function buildBoroughBingo(stamped: readonly string[] | null | undefined): BoroughBingoCard {
  const slugs = new Set((Array.isArray(stamped) ? stamped : []).map((name) => slugifyBorough(String(name ?? ""))));
  const squares = SQUARES.map((square) => ({ ...square, filled: slugs.has(square.slug) }));
  return {
    squares,
    filled: squares.filter((square) => square.filled).length,
    total: BOROUGH_BINGO_TOTAL,
  };
}

/** "12 of 33 boroughs". The one line a mutual reads, and the card's head. */
export function boroughBingoCountLine(filled: number): string {
  const count = Number.isInteger(filled) && filled > 0 ? Math.min(filled, BOROUGH_BINGO_TOTAL) : 0;
  return `${count} of ${BOROUGH_BINGO_TOTAL} boroughs`;
}

/** The highest mark the count has reached, or null below the first. */
export function boroughBingoMark(filled: number): BoroughBingoMark | null {
  let reached: BoroughBingoMark | null = null;
  for (const mark of BOROUGH_BINGO_MARKS) if (filled >= mark) reached = mark;
  return reached;
}

export function isBoroughBingoMark(value: unknown): value is BoroughBingoMark {
  return typeof value === "number" && (BOROUGH_BINGO_MARKS as readonly number[]).includes(value);
}

/** Who may read what: the owner the card, a mutual the count, anybody else nothing. */
export type BoroughBingoView = "card" | "count" | "none";

export function boroughBingoView(input: { isOwner: boolean; isMutual: boolean }): BoroughBingoView {
  if (input.isOwner) return "card";
  return input.isMutual ? "count" : "none";
}

/** The share card's headline for a mark. */
export function boroughBingoShareTitle(handle: string, mark: BoroughBingoMark): string {
  return `@${handle}: ${boroughBingoCountLine(mark)}`;
}
