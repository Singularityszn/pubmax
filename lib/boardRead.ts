// BROWSER-SAFE LEAF. The board reader's vocabulary: what a read of a price
// board PROPOSES, and the one parser that turns a model's answer into
// proposals (review item A4, round 5 slice 25).
//
// PROPOSE THEN CONFIRM (docs/adr/0006). A board read writes nothing. The model
// reads a photo the drinker took and answers line items; this module keeps the
// ones a price write could hold and drops the rest. The drinker then edits,
// unticks and confirms, and each confirmed row goes through the EXISTING
// community price write (`/api/price-submit`) with the board photo as its
// bill. No row reaches a store from the model's answer alone.
//
// WHAT IS DROPPED, and why each rule is here rather than in the prompt:
//   - a row with no price, or a price outside the community envelope, because
//     the write would refuse it and a card that can only fail is clutter;
//   - a drink row whose measure is not on the closed set (pint, half, other),
//     because `lib/drinkMeasure.ts` is the only vocabulary a serving may use;
//   - a drink row whose category is not on the closed drink set.
// A FOOD row is not dropped silently. The price write takes drink categories
// only, so a food row is kept OUT and shown as "not a drink price".

import {
  COMMUNITY_PRICE_MAX_GBP,
  COMMUNITY_PRICE_MIN_GBP,
} from "@/lib/communityPrice";
import { isDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import {
  cleanDrinkMeasureLabel,
  statedDrinkMeasure,
  type DrinkMeasure,
} from "@/lib/drinkMeasure";

/** The one line a keyless deployment answers, on the page and from the route. */
export const BOARD_READ_KEYLESS_LINE = "The Pal needs its key to read a board.";

/** The code the route answers keyless, so the page can tell it from a failure. */
export const BOARD_READ_KEYLESS_CODE = "BOARD_READER_KEYLESS";

/** What a food row says instead of a confirm box. */
export const BOARD_READ_FOOD_LINE = "Not a drink price, kept out.";

/** The door on the venue sheet and the page's own heading. */
export const BOARD_READ_ACTION = "Photo of the board";

/** Most rows one read proposes. A board longer than this is two photos. */
export const BOARD_READ_MAX_ROWS = 20;

/** Longest drink name a card prints. */
const BOARD_READ_NAME_MAX = 80;

/** How sure the reader was of one line, in the words a card prints. */
const BOARD_READ_CONFIDENCE = ["clear", "likely", "unsure"] as const;
export type BoardReadConfidence = (typeof BOARD_READ_CONFIDENCE)[number];

export const BOARD_READ_CONFIDENCE_LABEL: Record<BoardReadConfidence, string> = {
  clear: "Clear on the board",
  likely: "Probably right",
  unsure: "Hard to read, check it",
};

/** One proposed drink line. Nothing about it is stored until a person confirms it. */
export type BoardReadProposal = {
  id: string;
  name: string;
  category: DrinkCategory;
  measure: DrinkMeasure;
  /** The free label an `other` measure carries (a 175ml glass). Empty otherwise. */
  measureLabel: string;
  pricePence: number;
  confidence: BoardReadConfidence;
};

/** A line the board had that the price write cannot hold. Shown, never sent. */
export type BoardReadKeptOut = {
  id: string;
  name: string;
  pricePence: number;
};

export type BoardRead = {
  proposals: BoardReadProposal[];
  keptOut: BoardReadKeptOut[];
};

const MIN_PENCE = Math.round(COMMUNITY_PRICE_MIN_GBP * 100);
const MAX_PENCE = Math.round(COMMUNITY_PRICE_MAX_GBP * 100);

function cleanName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BOARD_READ_NAME_MAX);
}

/** A whole number of pence inside the community envelope, or null. */
function boardPricePence(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isInteger(value)) return null;
  if (value < MIN_PENCE || value > MAX_PENCE) return null;
  return value;
}

function cleanConfidence(value: unknown): BoardReadConfidence {
  return typeof value === "string" && (BOARD_READ_CONFIDENCE as readonly string[]).includes(value)
    ? (value as BoardReadConfidence)
    : "unsure";
}

/**
 * THE ONE PARSER. Takes whatever the model answered (already JSON-decoded) and
 * returns the proposals a card may offer and the food lines kept out. Anything
 * it cannot read is dropped rather than guessed at, so a malformed answer is an
 * empty read, never an invented price.
 */
export function parseBoardReadAnswer(answer: unknown): BoardRead {
  const rows =
    answer && typeof answer === "object" && Array.isArray((answer as { rows?: unknown }).rows)
      ? ((answer as { rows: unknown[] }).rows)
      : [];
  const proposals: BoardReadProposal[] = [];
  const keptOut: BoardReadKeptOut[] = [];
  for (const raw of rows) {
    if (proposals.length + keptOut.length >= BOARD_READ_MAX_ROWS) break;
    if (!raw || typeof raw !== "object") continue;
    const row = raw as Record<string, unknown>;
    const name = cleanName(row.name);
    const pricePence = boardPricePence(row.pricePence);
    if (!name || pricePence === null) continue;
    const id = `row-${proposals.length + keptOut.length + 1}`;
    if (row.kind === "food") {
      keptOut.push({ id, name, pricePence });
      continue;
    }
    if (row.kind !== "drink") continue;
    const measure = statedDrinkMeasure(row.measure);
    if (!measure) continue;
    const category = typeof row.category === "string" ? row.category.trim().toLowerCase() : "";
    if (!isDrinkCategory(category)) continue;
    proposals.push({
      id,
      name,
      category,
      measure,
      measureLabel: measure === "other" ? cleanDrinkMeasureLabel(row.measureLabel) : "",
      pricePence,
      confidence: cleanConfidence(row.confidence),
    });
  }
  return { proposals, keptOut };
}

/** Pence as the pounds string the price write takes ("4.80"). */
export function boardPriceGbp(pricePence: number): string {
  return (pricePence / 100).toFixed(2);
}
