import type { DrinkCategory } from "@/lib/drinks";

export type ParsedMbplcDrink = {
  drinkName: string;
  category: DrinkCategory;
  priceGbp: number;
};

const TOP_SECTION = /^##\s+(.+)$/;
const SUB_SECTION = /^###\s+(.+)$/;
const ITEM_HEADING = /^####\s+(.+)$/;
const POUND_PRICE = /£\s*(\d+(?:\.\d{2})?)/;
const BARE_PRICE = /^\s*(\d+\.\d{2})\s*$/;

/** Map Nicholson's / M&B menu section headings to drink taxonomy. */
export function mapMbplcSectionToCategory(section: string): DrinkCategory | null {
  const s = section.toLowerCase();
  if (
    s.includes("fever-tree") ||
    s.includes("mixer") ||
    s.includes("soft drink") ||
    s.includes("tonic") ||
    s.includes("soda") ||
    s.includes("main menu") ||
    s.includes("sandwich") ||
    s.includes("buffet") ||
    s.includes("breakfast") ||
    s.includes("food")
  ) {
    return null;
  }
  if (s.includes("wine") || s.includes("champagne") || s.includes("spark")) return "wine";
  if (s.includes("cocktail") || s.includes("spritz")) return "cocktail";
  if (
    s.includes("beer") ||
    s.includes("lager") ||
    s.includes("ale") ||
    s.includes("cider") ||
    s.includes("draught") ||
    s.includes("craft") ||
    s.includes("low and no")
  ) {
    return "beer";
  }
  if (s.includes("whisk") || s.includes("whiskey")) return "whisky";
  if (s.includes("gin")) return "gin";
  if (s.includes("vodka")) return "vodka";
  if (s.includes("rum")) return "rum";
  if (s.includes("tequila")) return "shot";
  if (s.includes("spirit") || s.includes("shot")) return "shot";
  return "other";
}

function priceFromLines(lines: string[]): number | null {
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (
      trimmed === "glass" ||
      trimmed === "bottle" ||
      trimmed === "pint" ||
      trimmed.endsWith(" kcal") ||
      trimmed.endsWith("% vol.") ||
      trimmed.includes(" vol.")
    ) {
      continue;
    }
    const pound = line.match(POUND_PRICE);
    if (pound) return parseFloat(pound[1]);
    const bare = line.match(BARE_PRICE);
    if (bare) {
      const value = parseFloat(bare[1]);
      if (value >= 1.5 && value <= 80) return value;
    }
  }
  return null;
}

/**
 * Parse Firecrawl markdown from Nicholson's /drinks pages.
 * Prices are often bare decimals (e.g. 7.50) on their own line after % Vol.
 */
export function parseMbplcMenuMarkdown(markdown: string): ParsedMbplcDrink[] {
  const lines = markdown.split(/\r?\n/);
  const out: ParsedMbplcDrink[] = [];
  let topSection: string | null = null;
  let subSection: string | null = null;
  let itemName: string | null = null;
  let itemLines: string[] = [];

  const activeSection = () => subSection ?? topSection;

  const resolveCategory = (): DrinkCategory | null => {
    const fromTop = topSection ? mapMbplcSectionToCategory(topSection) : null;
    const fromSub = subSection ? mapMbplcSectionToCategory(subSection) : null;
    if (fromSub && fromSub !== "other") return fromSub;
    return fromTop;
  };

  const flushItem = () => {
    if (!itemName) {
      itemLines = [];
      return;
    }
    const section = activeSection();
    if (!section) {
      itemName = null;
      itemLines = [];
      return;
    }
    const category = resolveCategory();
    if (!category) {
      itemName = null;
      itemLines = [];
      return;
    }
    const price = priceFromLines(itemLines);
    if (price !== null) {
      out.push({ drinkName: itemName.trim(), category, priceGbp: price });
    }
    itemName = null;
    itemLines = [];
  };

  for (const line of lines) {
    const topMatch = line.match(TOP_SECTION);
    if (topMatch) {
      flushItem();
      topSection = topMatch[1].trim();
      subSection = null;
      continue;
    }
    const subMatch = line.match(SUB_SECTION);
    if (subMatch) {
      flushItem();
      subSection = subMatch[1].trim();
      continue;
    }
    const itemMatch = line.match(ITEM_HEADING);
    if (itemMatch) {
      flushItem();
      itemName = itemMatch[1].trim();
      itemLines = [];
      continue;
    }
    if (itemName) itemLines.push(line);
  }
  flushItem();
  return out;
}

/** Extract venue display name from Nicholson's drinks page markdown. */
export function pubNameFromMbplcMarkdown(markdown: string): string | null {
  const match = markdown.match(/^##\s+(.+)$/m);
  return match?.[1]?.trim() ?? null;
}

/** Slug from Nicholson's drinks URL: .../london/{slug}/drinks */
export function slugFromMbplcDrinksUrl(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    const drinksIdx = parts.lastIndexOf("drinks");
    if (drinksIdx < 2) return null;
    return parts[drinksIdx - 1] ?? null;
  } catch {
    return null;
  }
}
