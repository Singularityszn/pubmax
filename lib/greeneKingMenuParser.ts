import type { DrinkCategory } from "@/lib/drinks";

export type ParsedGreeneKingDrink = {
  drinkName: string;
  category: DrinkCategory;
  priceGbp: number;
  priceNote?: string;
};

const SECTION_HEADING = /^###\s+(.+)$/;
const ITEM_HEADING = /^####\s+(.+)$/;
const PRICE_LINE = /£\s*(\d+(?:\.\d{2})?)/;

/** Map a Greene King menu section heading to our drink taxonomy. */
export function mapSectionToCategory(section: string): DrinkCategory | null {
  const s = section.toLowerCase();
  if (
    s.includes("main menu") ||
    s.includes("dessert") ||
    s.includes("snack") ||
    s.includes("kids") ||
    s.includes("ciabatta") ||
    s.includes("sunday menu") ||
    s.includes("gluten")
  ) {
    return null;
  }
  if (s.includes("wine") || s.includes("champagne") || s.includes("spark")) return "wine";
  if (s.includes("cocktail") || s.includes("spritz") || s.includes("0%")) return "cocktail";
  if (
    s.includes("beer") ||
    s.includes("lager") ||
    s.includes("ale") ||
    s.includes("cider") ||
    s.includes("draught") ||
    s.includes("keg") ||
    s.includes("stout")
  ) {
    return "beer";
  }
  if (s.includes("whisk") || s.includes("whiskey")) return "whisky";
  if (s.includes("gin")) return "gin";
  if (s.includes("vodka")) return "vodka";
  if (s.includes("rum")) return "rum";
  if (s.includes("spirit") || s.includes("shot")) return "shot";
  if (s.includes("drink")) return "other";
  return "other";
}

function firstPriceFromLines(lines: string[]): { price: number; note?: string } | null {
  for (const line of lines) {
    const trimmed = line.trim().toLowerCase();
    if (trimmed === "glass" || trimmed === "bottle" || trimmed === "pint") {
      continue;
    }
    const match = line.match(PRICE_LINE);
    if (!match) continue;
    const prices = [...line.matchAll(/£\s*(\d+(?:\.\d{2})?)/g)].map((m) => parseFloat(m[1]));
    if (prices.length === 0) continue;
    const price = Math.min(...prices);
    const note =
      prices.length > 1 ? line.trim() : trimmed.startsWith("bottle") ? "bottle" : undefined;
    return { price, note };
  }
  return null;
}

/**
 * Parse Firecrawl markdown from a Greene King /menu page into priced drink rows.
 * Beer/lager tabs may be absent unless the page was interacted with — caller may
 * merge multiple scrapes.
 */
export function parseGreeneKingMenuMarkdown(markdown: string): ParsedGreeneKingDrink[] {
  const lines = markdown.split(/\r?\n/);
  const out: ParsedGreeneKingDrink[] = [];
  let section: string | null = null;
  let itemName: string | null = null;
  let itemLines: string[] = [];

  const flushItem = () => {
    if (!itemName || !section) {
      itemName = null;
      itemLines = [];
      return;
    }
    const category = mapSectionToCategory(section);
    if (!category) {
      itemName = null;
      itemLines = [];
      return;
    }
    const priced = firstPriceFromLines(itemLines);
    if (priced) {
      out.push({
        drinkName: itemName.trim(),
        category,
        priceGbp: priced.price,
        ...(priced.note ? { priceNote: priced.note } : {}),
      });
    }
    itemName = null;
    itemLines = [];
  };

  for (const line of lines) {
    const sectionMatch = line.match(SECTION_HEADING);
    if (sectionMatch) {
      flushItem();
      section = sectionMatch[1].trim();
      continue;
    }
    const itemMatch = line.match(ITEM_HEADING);
    if (itemMatch) {
      flushItem();
      itemName = itemMatch[1].trim();
      itemLines = [];
      continue;
    }
    if (itemName) {
      itemLines.push(line);
    }
  }
  flushItem();
  return out;
}

/** Extract pub slug from a Greene King menu URL. */
export function slugFromMenuUrl(url: string): string | null {
  try {
    const u = new URL(url);
    const parts = u.pathname.split("/").filter(Boolean);
    const menuIdx = parts.lastIndexOf("menu");
    if (menuIdx < 1) return null;
    return parts[menuIdx - 1] ?? null;
  } catch {
    return null;
  }
}

/** Humanise a GK slug for fuzzy venue matching. */
export function titleFromSlug(slug: string): string {
  return slug
    .split("-")
    .map((w) => (w.length <= 2 ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .replace(/\bSt\b/g, "St")
    .replace(/\bS\b/g, "s");
}
