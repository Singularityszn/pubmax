// BROWSER-SAFE LEAF. THE BILL CHECK: what a read of a bill photo keeps, and the
// one judge that decides whether the bill shows the price a drinker typed.
//
// Captain 5 Nov 2026: "when a priced Pint Drop or community price arrives with
// a bill photo, read the bill and check it against the submitted price." Until
// then a price earned `receipt` evidence because a photo was attached, and
// nothing ever read it (lib/pintDropReceipt.ts). Now the photo goes to the
// vision lane in the background (lib/billCheck.server.ts), and this module owns
// what comes back.
//
// THE ANSWER IS A CLOSED SET, mirrored by a CHECK on `price_bill_checks`
// (migration 0220):
//
//   match       a named drink line holds the submitted price to the penny.
//               This is the ONLY result that earns `receipt` evidence.
//   mismatch    the bill is readable and no line holds the price. The price
//               stays `unchecked` and goes to the moderation queue. Nothing
//               is hidden or deleted by the check itself.
//   unreadable  no priced line identifies the drink. It stays `unchecked`,
//               exactly like a price sent without a bill.
//
// WHAT IS KEPT. The model is asked for the venue name, the priced lines and
// the date, because that is the shape a bill has. Only the priced lines leave
// this parser, and only the lines the verdict needs are stored: the matching
// line on a match, every priced line on a mismatch (the moderator's evidence),
// none on an unreadable bill. The venue name and the date are never kept. A
// line name loses every run of four or more digits, so a card number, a phone
// number or a table code read off the bill cannot be stored beside a price.

import type { DrinkMeasure } from "@/lib/drinkMeasure";
import { drinkCategoryFromText, drinkKeywordSpans } from "@/lib/drinkCategoryFromText";
import { brandsForCategory, normalizeDrinkHaystack } from "@/lib/drinkBrands";

/** The three answers a bill check can give. */
export const BILL_CHECK_RESULTS = ["match", "mismatch", "unreadable"] as const;
export type BillCheckResult = (typeof BILL_CHECK_RESULTS)[number];

const BILL_CHECK_RESULT_SET: ReadonlySet<string> = new Set(BILL_CHECK_RESULTS);

/** A stored or untrusted value narrowed to the closed set, or undefined. */
export function cleanBillCheckResult(value: unknown): BillCheckResult | undefined {
  return typeof value === "string" && BILL_CHECK_RESULT_SET.has(value)
    ? (value as BillCheckResult)
    : undefined;
}

/** One priced line read off a bill. */
export type BillLine = { name: string; priceGbp: number };

/** What a read of a bill keeps: its priced lines, and nothing about who paid. */
export type BillRead = { lines: BillLine[] };

/** What the judge answers, and the lines it needs to be checked again later. */
export type BillCheckVerdict = { result: BillCheckResult; lines: BillLine[] };

/** Most lines one read keeps. A bill longer than this is a party, not a pint. */
export const BILL_CHECK_MAX_LINES = 20;

/** Longest line name kept. */
const BILL_LINE_NAME_MAX = 60;

/** Dearest single line a bill check reads. Past it the line is a total or a misread. */
const BILL_LINE_MAX_GBP = 200;

function cleanLineName(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/[<>]/g, "")
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, BILL_LINE_NAME_MAX)
    .trim();
}

function pence(priceGbp: number): number {
  return Math.round(priceGbp * 100);
}

function cleanLinePrice(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value <= 0 || value > BILL_LINE_MAX_GBP) return null;
  return pence(value) / 100;
}

/**
 * THE ONE PARSER. Takes whatever the model answered (already JSON-decoded) and
 * returns the priced lines it can check. Anything it cannot read is dropped
 * rather than guessed at, so a malformed answer is a bill with no lines, which
 * the judge calls unreadable.
 */
export function parseBillReadAnswer(answer: unknown): BillRead {
  const raw =
    answer && typeof answer === "object" && Array.isArray((answer as { lines?: unknown }).lines)
      ? ((answer as { lines: unknown[] }).lines)
      : [];
  const lines: BillLine[] = [];
  for (const entry of raw) {
    if (lines.length >= BILL_CHECK_MAX_LINES) break;
    if (!entry || typeof entry !== "object") continue;
    const line = entry as Record<string, unknown>;
    const name = cleanLineName(line.name);
    const priceGbp = cleanLinePrice(line.price_gbp);
    if (!cleanLineName(name.replace(/\d{4,}/g, " ")) || priceGbp === null) continue;
    lines.push({ name, priceGbp });
  }
  return { lines };
}

function billItem(name: string): { name: string; measure?: string } {
  const text = name.trim().toLowerCase();
  const serving = /\b(half(?:\s+pint)?|1\/2(?:\s+pint)?|pint|125\s*ml|175\s*ml|250\s*ml|bottle|single|double)\b|½(?:\s+pint)?/gi;
  const found = [...text.matchAll(serving)].find((match) => {
    if (!/^(half|pint|bottle|single|double)$/.test(match[0])) return true;
    const following = text.slice(match.index + match[0].length).trim();
    if (!following || /^of\b/.test(following)) return true;
    const category = drinkCategoryFromText(following);
    const words = normalizeDrinkHaystack(following);
    const startsWithDrink = drinkKeywordSpans(following).some((span) => span.start === 0) ||
      (category !== null && brandsForCategory(category).some((brand) =>
        [brand.label, ...(brand.aliases ?? [])].some((label) => {
          const prefix = normalizeDrinkHaystack(label);
          return words === prefix || words.startsWith(`${prefix} `);
        })));
    if (!startsWithDrink) return false;
    return match[0] === "single" || match[0] === "double"
      ? category === "gin" || category === "vodka" || category === "rum" || category === "whisky" || category === "shot"
      : category !== null;
  });
  const raw = found?.[0].replace(/\s+/g, "");
  const measure = raw?.startsWith("half") || raw?.startsWith("1/2") || raw?.startsWith("½")
    ? "half"
    : raw;
  return {
    name: (found ? text.slice(0, found.index) + " " + text.slice(found.index + found[0].length) : text)
      .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim().replace(/^of /, ""),
    ...(measure ? { measure } : {}),
  };
}

function evidenceLines(lines: BillLine[]): BillLine[] {
  return lines.slice(0, BILL_CHECK_MAX_LINES)
    .map((line) => ({ name: cleanLineName(line.name.replace(/\d{4,}/g, " ")), priceGbp: line.priceGbp }))
    .filter((line) => line.name !== "");
}

export function judgeBill(
  read: BillRead,
  submittedPriceGbp: number,
  drink: string,
  measure?: DrinkMeasure,
): BillCheckVerdict {
  const submitted = billItem(drink);
  if (!submitted.name) return { result: "unreadable", lines: [] };
  const named = read.lines.filter((line) => billItem(line.name).name === submitted.name);
  if (named.length === 0) return { result: "unreadable", lines: [] };
  const target = pence(submittedPriceGbp);
  const expectedMeasure = measure ?? submitted.measure;
  const matching = named.filter((line) => {
    const statedMeasure = billItem(line.name).measure;
    return pence(line.priceGbp) === target &&
      (!expectedMeasure || !statedMeasure || statedMeasure === expectedMeasure);
  });
  if (matching.length === 0) {
    return { result: "mismatch", lines: evidenceLines(read.lines) };
  }
  const seen = new Set<string>();
  const kept = matching.filter((line) => {
    const key = `${line.name.toLowerCase()}|${pence(line.priceGbp)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { result: "match", lines: evidenceLines(kept) };
}

/**
 * The line the drinker reads after a price with a bill lands. The check runs
 * after the answer, so the receipt says what happens next rather than what has
 * happened. Copy may claim the mark and never the colour.
 */
export const BILL_READING_RECEIPT_LINE =
  "We're reading your bill. If it shows this price, the map marks it.";

/** What the moderation queue calls a bill that does not show its price. */
export const BILL_MISMATCH_QUEUE_TITLE = "Bills that do not show the price";

/**
 * One row of the moderation queue (GET /api/admin/bill-checks): a bill that
 * was read and does not show the price it came with, the lines it did show,
 * and the drop it names with its bill photo when there is one.
 */
export type ModeratorBillCheck = {
  id: string;
  venueId: string;
  venueName: string;
  priceGbp: number;
  result: BillCheckResult;
  lines: BillLine[];
  checkedAt: string;
  pintDropId?: string;
  communityPriceId?: string;
  drop?: {
    id: string;
    handle: string;
    drink: string;
    status: string;
    createdAt: string;
    receiptPhotoUrl: string | null;
  };
};
