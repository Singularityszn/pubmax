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
//   mismatch    the drink is identified, but no line matches its price and
//               serving constraints. The check enters the moderation queue
//               and grants no receipt evidence. It hides or deletes nothing.
//   unreadable  no priced line identifies the drink. It stays `unchecked`,
//               exactly like a price sent without a bill.
//
// WHAT IS KEPT. The model is asked for the venue name, the priced lines and
// the date, because that is the shape a bill has. Only the priced lines leave
// this parser, and only the lines the verdict needs are stored: the matching
// lines on a match, every priced line on a mismatch (the moderator's evidence),
// none on an unreadable bill. The venue name and the date are never kept. A
// line name loses every run of four or more digits. A fully redacted name uses
// the privacy-safe marker `Item` and keeps its price.

import { DRINK_MEASURES, MEASURE_OTHER_SUGGESTIONS, NON_PINT_MEASURE_PATTERNS, type DrinkMeasure } from "@/lib/drinkMeasure";
import { drinkCategoryFromText, drinkKeywordSpans } from "@/lib/drinkCategoryFromText";
import { brandsForCategory, normalizeDrinkHaystack } from "@/lib/drinkBrands";
import { submitCategoryLabel } from "@/lib/communityPrice";
import { DRINK_CATEGORIES, type DrinkCategory } from "@/lib/drinks";
import { BEERS } from "@/lib/beers";
import { drinkBrandCategoryAtStart } from "@/lib/drinkSubtypes";
import { isComparablePintServing } from "@/lib/comparablePint.mjs";
import { PLAN_FOOD_ITEM } from "@/lib/planPriceLimits";

const BILL_FOOD_CONTEXT = new RegExp(String.raw`\b(?:${PLAN_FOOD_ITEM}|pies?|fish|batter(?:ed)?|crisps|fries|desserts?|cakes?|puddings?)\b`, "i");
const BILL_SERVING_LABELS = [
  ...DRINK_MEASURES.filter((measure) => measure !== "other"),
  ...NON_PINT_MEASURE_PATTERNS.map(({ word }) => word),
  ...MEASURE_OTHER_SUGGESTIONS,
].map((label) => label.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
const BILL_SERVING_PATTERN = new RegExp(String.raw`\b((?:(?:a|one|two|three)[\s-]+)?(?:half|thirds?|quarters?)(?:[\s-]+(?:of[\s-]+)?(?:a[\s-]+)?pint)?|\d+\/\d+(?:[\s-]+pint)?|\d+(?:\.\d+)?\s*(?:ml|cl|litres?|l)|bottles?|bottled|cans?|canned|${BILL_SERVING_LABELS.join("|")})\b|[¼½¾⅐⅑⅒⅓⅔⅕⅖⅗⅘⅙⅚⅛⅜⅝⅞](?:[\s-]+pint)?`, "gi");

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
    if (!name || priceGbp === null) continue;
    lines.push({ name, priceGbp });
  }
  return { lines };
}

function billProductName(name: string): string {
  return name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/^of /, "");
}

function billBrandCategory(name: string): DrinkCategory | null {
  const words = normalizeDrinkHaystack(name);
  return drinkBrandCategoryAtStart(name) ?? DRINK_CATEGORIES.find((category) =>
    [...brandsForCategory(category), ...(category === "beer" ? BEERS : [])].some((brand) =>
      [brand.label, ...(brand.aliases ?? [])].some((label) => {
        const prefix = normalizeDrinkHaystack(label);
        return words === prefix || words.startsWith(`${prefix} `);
      }))) ?? null;
}

function billServingText(text: string): string {
  return text.toLowerCase()
    .replace(/[^\p{L}\p{N}\s./]/gu, " ")
    .replace(/(?<!\d)[./]|[./](?!\d)/g, " ")
    .replace(/\bon\s+tap\b|\b(?:cask|keg|guest)\b/g, " ")
    .replace(/\s+/g, " ").trim();
}

function billItem(name: string): { name: string; categoryText: string; measure?: string } {
  const text = billServingText(name);
  const products = [...text.matchAll(/\b(?:single malt|single hop pale ale|double ipa|double chocolate stout|half moon|half baked pale ale|bottle rocket|bottle conditioned ale|pint sized pale ale|small beer|third wheel|other half green diamond)\b/g)];
  const found = [...text.matchAll(BILL_SERVING_PATTERN)].find((match) =>
    !products.some((product) => match.index >= product.index && match.index < product.index + product[0].length));
  const alias = NON_PINT_MEASURE_PATTERNS.find(({ word, measure }) => word === found?.[0] && measure !== "other");
  const raw = (alias?.measure ?? found?.[0])?.normalize("NFKC").replace("⁄", "/")
    .replace(/^(?:a|one)[\s-]+/, "")
    .replace(/^(?:(two|three)[\s-]+)?(half|thirds?|quarters?)/, (_, count: string, unit: string) =>
      `${count === "two" ? 2 : count === "three" ? 3 : 1}/${unit === "half" ? 2 : unit.startsWith("third") ? 3 : 4}`)
    .replace(/[\s-]+(?:of[\s-]+)?(?:a[\s-]+)?pint$/, "")
    .replace(/\s+/g, "");
  const volume = raw?.match(/^(\d+(?:\.\d+)?)(ml|cl|litres?|l)$/);
  const fraction = raw?.match(/^(\d+)\/(\d+)/);
  const millilitres = volume
    ? Number(volume[1]) * (volume[2] === "ml" ? 1 : volume[2] === "cl" ? 10 : 1000)
    : fraction ? 568 * Number(fraction[1]) / Number(fraction[2])
    : raw === "pint" ? 568 : undefined;
  const measure = millilitres !== undefined
    ? `${Math.round(millilitres)}ml`
    : raw?.startsWith("bottl") ? "bottle"
    : raw?.startsWith("can") ? "can"
    : raw;
  const product = found ? text.slice(0, found.index) + " " + text.slice(found.index + found[0].length) : text;
  return {
    name: billProductName(product),
    categoryText: product.trim().replace(/^of\s+/, "").replace(/\s+/g, " "),
    ...(measure ? { measure } : {}),
  };
}

function evidenceLines(lines: BillLine[]): BillLine[] {
  return lines.slice(0, BILL_CHECK_MAX_LINES)
    .map((line) => ({ name: cleanLineName(line.name.replace(/\d{4,}/g, " ")) || "Item", priceGbp: line.priceGbp }));
}

/**
 * The category a submitted drink names when it is ONLY a category label, such
 * as "Beer" from the one-tap price door, or null for a named drink. A bare
 * category cannot equal one bill line's product name, so its lines are tied to
 * it through the category their product belongs to instead.
 */
function bareCategoryOf(submittedName: string): DrinkCategory | null {
  return DRINK_CATEGORIES.find((category) =>
    billProductName(submitCategoryLabel(category).toLowerCase()) === submittedName) ?? null;
}

/**
 * Whether a bill line names the submitted drink. A named drink needs the same
 * product name. A bare category needs a product that resolves to that same
 * category, through the drink keywords and the brand tables, so an item of any
 * other category (chips, a glass of wine for a Beer price) never names it.
 */
function lineNamesDrink(
  item: { name: string; categoryText: string },
  candidate: { name: string },
  bareCategory: DrinkCategory | null,
): boolean {
  const text = item.categoryText;
  const drinkWords = drinkKeywordSpans(text);
  if (BILL_FOOD_CONTEXT.test(text) && !drinkWords.some((span) => span.end === text.length)) return false;
  if (!bareCategory) return item.name === candidate.name;
  if (!item.name) return false;
  const identifiesDrink = billBrandCategory(text) !== null ||
    drinkWords.some((span) => span.start === 0 || span.end === text.length);
  return identifiesDrink && drinkCategoryFromText(text) === bareCategory;
}

function billNamesPint(item: { name: string; categoryText: string; measure?: string }): boolean {
  const servingText = item.measure !== "bottle" && item.name.startsWith("bottle ")
    ? item.categoryText.replace(/\bbottle\b/i, "")
    : item.categoryText;
  return isComparablePintServing({ cheapestPint: billServingText(servingText) });
}

export function judgeBill(
  read: BillRead,
  submittedPriceGbp: number,
  drink: string,
  measure?: DrinkMeasure,
  measureLabel?: string,
): BillCheckVerdict {
  const measureText = measure === "other" && measureLabel ? measureLabel : measure;
  const submittedMeasure = measureText ? billItem(measureText).measure ?? measureText : undefined;
  const submitted = billItem(drink);
  if (!submitted.name) return { result: "unreadable", lines: [] };
  const bareCategory = bareCategoryOf(submitted.name);
  const named = read.lines.map((line) => {
    const item = billItem(line.name);
    return { line, item };
  }).filter(({ item }) => lineNamesDrink(item, submitted, bareCategory));
  if (named.length === 0) return { result: "unreadable", lines: [] };
  const target = pence(submittedPriceGbp);
  const matching = named.filter(({ line, item }) => {
    if (submittedMeasure && submitted.measure && submittedMeasure !== submitted.measure) return false;
    const expectedMeasure = submittedMeasure ?? submitted.measure;
    if (expectedMeasure === "568ml" &&
      (!billNamesPint(item) || !billNamesPint(submitted))) return false;
    const statedMeasure = item.measure;
    return pence(line.priceGbp) === target &&
      (!expectedMeasure || !statedMeasure || statedMeasure === expectedMeasure);
  });
  if (matching.length === 0) {
    return { result: "mismatch", lines: evidenceLines(read.lines) };
  }
  const seen = new Set<string>();
  const kept = matching.map(({ line }) => line).filter((line) => {
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
  receiptPhotoUrl: string | null;
  submittedDrink?: string;
  communityOnly?: boolean;
  drop?: {
    id: string;
    handle: string;
    drink: string;
    /** The serving the drop was sent with, as a surface names it. Absent when it stated none. */
    serving?: string;
    status: string;
    createdAt: string;
  };
};
