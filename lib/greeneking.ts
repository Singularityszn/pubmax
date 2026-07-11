// Greene King (official site) drink + food menu parser — PURE + TESTED: no
// network here. scripts/merge_greene_king_menus.mjs reads local CSV / dropped
// scrape JSON under data/greene_king/ and hands markdown (or interact text) to
// these functions.
//
// Menu pages on greeneking.co.uk render as markdown-ish sections:
//   ### White Wine (10)
//   #### Organic Pinot Grigio, Riff, Italy
//   …description… 11.5%
//   glass
//   £7.20 / £8.50 / £10.80
//   bottle
//   £30.00
// and cocktail sections with a single £price per #### item.
//
// Food is often captured via browser-interact summaries in the shape:
//   ### **Starters**
//   * **Soup of the Day**: £6.45

import { isDrinkCategory, type DrinkCategory } from "@/lib/drinks";
import {
  isFoodCategory,
  type FoodCategory,
  type FoodDietary,
} from "@/lib/food";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GreeneKingPubIdentity = {
  name: string;
  /** URL path slug, e.g. "prospect-of-whitby". */
  slug: string;
  /** County/area segment from the site path, e.g. "greater-london". */
  locality: string;
  pageUrl: string;
};

export type GreeneKingDrinkItem = {
  name: string;
  section: string;
  priceGbp: number;
  description?: string;
  abv?: number;
  servingSize?: string;
};

export type GreeneKingFoodItem = {
  name: string;
  section: string;
  priceGbp: number;
  description?: string;
  dietary?: FoodDietary[];
};

export type GreeneKingCandidateDrink = {
  drinkName: string;
  category: DrinkCategory;
  priceGbp: number;
  description?: string;
  abv?: number;
  servingSize?: string;
  identity: GreeneKingPubIdentity;
};

export type GreeneKingCandidateFood = {
  itemName: string;
  category: FoodCategory;
  priceGbp: number;
  description?: string;
  dietary?: FoodDietary[];
  identity: GreeneKingPubIdentity;
};

export type DatasetVenue = {
  venueKey: string;
  name: string;
  address: string;
  /** Optional first-party website URL for slug matching. */
  website?: string;
};

export type VenueMatch = {
  venueKey: string;
  score: number;
  matchedName: string;
};

// ---------------------------------------------------------------------------
// URL / identity
// ---------------------------------------------------------------------------

const PUB_PATH_RE = /\/pubs\/([^/]+)\/([^/]+)(?:\/menu)?\/?$/i;

export function slugFromGreeneKingUrl(url: string): {
  locality: string;
  slug: string;
} | null {
  try {
    const u = new URL(url);
    const m = u.pathname.match(PUB_PATH_RE);
    if (!m) return null;
    return { locality: m[1].toLowerCase(), slug: m[2].toLowerCase() };
  } catch {
    const m = url.match(PUB_PATH_RE);
    if (!m) return null;
    return { locality: m[1].toLowerCase(), slug: m[2].toLowerCase() };
  }
}

function titleCaseSlug(slug: string): string {
  return slug
    .split("-")
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export function identityFromMenuUrl(
  url: string,
  displayName?: string,
): GreeneKingPubIdentity | null {
  const parts = slugFromGreeneKingUrl(url);
  if (!parts) return null;
  return {
    name: (displayName ?? titleCaseSlug(parts.slug)).trim(),
    slug: parts.slug,
    locality: parts.locality,
    pageUrl: url.split("?")[0].replace(/\/$/, ""),
  };
}

// ---------------------------------------------------------------------------
// Category mapping
// ---------------------------------------------------------------------------

const DRINK_SECTION_RULES: Array<{ test: RegExp; category: DrinkCategory }> = [
  { test: /0\s*%|alcohol[- ]?free|non[- ]?alcoholic|soft drink|no\s*&\s*low/i, category: "other" },
  { test: /cocktail|spritz|mocktail/i, category: "cocktail" },
  { test: /\bshots?\b|shooter/i, category: "shot" },
  { test: /whisk(e)?y|bourbon|scotch/i, category: "whisky" },
  { test: /\bgin\b/i, category: "gin" },
  { test: /vodka/i, category: "vodka" },
  { test: /\brum\b/i, category: "rum" },
  { test: /wine|prosecco|champagne|sparkling|ros[eé]/i, category: "wine" },
  { test: /beer|lager|ale|cider|stout|draught|pint|craft/i, category: "beer" },
];

/** Map a Greene King drink section label → DrinkCategory, or null (DROPPED). */
export function mapSectionToCategory(section: string): DrinkCategory | null {
  if (typeof section !== "string" || section.trim() === "") return null;
  // 0% cocktail sections are soft/other, not cocktail — check before cocktail.
  if (/0\s*%/.test(section) && /cocktail|spritz/i.test(section)) return "other";
  for (const rule of DRINK_SECTION_RULES) {
    if (rule.test.test(section)) return rule.category;
  }
  return null;
}

const FOOD_SECTION_RULES: Array<{ test: RegExp; category: FoodCategory }> = [
  { test: /starter|small plate|appetiser|appetizer/i, category: "starters" },
  { test: /sharer|to share|for the table|nachos/i, category: "sharers" },
  { test: /burger/i, category: "burgers" },
  { test: /dessert|pudding|sweet/i, category: "desserts" },
  { test: /side/i, category: "sides" },
  { test: /bar snack|nibble|bite/i, category: "bar-snacks" },
  { test: /main|classic|roast|ciabatta|grill|pie|fish|salad|kids/i, category: "mains" },
];

/** Map a Greene King food section label → FoodCategory (unmatched → other). */
export function mapSectionToFoodCategory(section: string): FoodCategory {
  if (typeof section !== "string" || section.trim() === "") return "other";
  for (const rule of FOOD_SECTION_RULES) {
    if (rule.test.test(section)) return rule.category;
  }
  return "other";
}

// ---------------------------------------------------------------------------
// Markdown drink parser
// ---------------------------------------------------------------------------

const SECTION_RE = /^#{2,3}\s+(.+?)\s*$/;
const ITEM_RE = /^#{4}\s+(.+?)\s*$/;
const PRICE_TOKEN_RE = /£\s*(\d+(?:\.\d{1,2})?)/g;
const ABV_RE = /(\d+(?:\.\d+)?)\s*%/;

function isFinitePositive(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function parsePoundPrices(text: string): number[] {
  const out: number[] = [];
  const re = new RegExp(PRICE_TOKEN_RE.source, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    const n = Number(m[1]);
    if (Number.isFinite(n) && n >= 0) out.push(n);
  }
  return out;
}

function lineHasPrice(line: string): boolean {
  return /£\s*\d/.test(line);
}

function stripSectionCount(title: string): string {
  return title.replace(/\s*\(\d+\)\s*$/, "").trim();
}

/**
 * Parse a Greene King menu markdown page into priced drink items.
 * Wine glass/bottle blocks emit one row per serving (smallest glass + bottle).
 * Items without a parseable £ price are dropped — never guessed.
 */
export function parseDrinkMarkdown(markdown: string): GreeneKingDrinkItem[] {
  if (typeof markdown !== "string" || markdown.trim() === "") return [];

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const items: GreeneKingDrinkItem[] = [];
  let section = "";
  let itemName: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (!itemName || !section) {
      itemName = null;
      buf = [];
      return;
    }
    const body = buf.join("\n").trim();
    const categoryHint = mapSectionToCategory(section);
    // Food-only sections on a combined menu page are ignored here.
    if (!categoryHint) {
      itemName = null;
      buf = [];
      return;
    }

    const abvMatch = body.match(ABV_RE);
    const abv = abvMatch ? Number(abvMatch[1]) : undefined;
    const description = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !/^glass$/i.test(l) && !/^bottle$/i.test(l) && !lineHasPrice(l))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    const lower = body.toLowerCase();
    const hasGlass = /\bglass\b/.test(lower);
    const hasBottle = /\bbottle\b/.test(lower);
    const prices = parsePoundPrices(body);

    if (prices.length === 0) {
      itemName = null;
      buf = [];
      return;
    }

    const push = (priceGbp: number, servingSize?: string) => {
      items.push({
        name: itemName!,
        section,
        priceGbp,
        description: description || undefined,
        abv: Number.isFinite(abv) ? abv : undefined,
        servingSize,
      });
    };

    if (hasGlass && hasBottle && prices.length >= 2) {
      push(prices[0], "glass");
      push(prices[prices.length - 1], "bottle");
    } else if (hasBottle && !hasGlass) {
      push(prices[prices.length - 1], "bottle");
    } else if (hasGlass && !hasBottle) {
      push(prices[0], "glass");
    } else {
      push(prices[0]);
    }

    itemName = null;
    buf = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const sec = line.match(SECTION_RE);
    if (sec && !line.startsWith("####")) {
      const title = stripSectionCount(sec[1].replace(/\*\*/g, "").trim());
      if (/^filters?$/i.test(title) || /^menus?\b/i.test(title)) continue;
      if (line.startsWith("## ") && !line.startsWith("### ")) {
        flush();
        section = title;
        continue;
      }
      flush();
      section = title;
      continue;
    }
    const item = line.match(ITEM_RE);
    if (item) {
      flush();
      itemName = item[1].replace(/\*\*/g, "").trim();
      buf = [];
      continue;
    }
    if (itemName) buf.push(line);
  }
  flush();
  return items;
}

export function candidateDrinksFromMarkdown(
  markdown: string,
  identity: GreeneKingPubIdentity,
): GreeneKingCandidateDrink[] {
  const rows: GreeneKingCandidateDrink[] = [];
  for (const item of parseDrinkMarkdown(markdown)) {
    if (!item.name.trim()) continue;
    if (!isFinitePositive(item.priceGbp)) continue;
    const category = mapSectionToCategory(item.section);
    if (!category || !isDrinkCategory(category)) continue;
    rows.push({
      drinkName: item.name.trim(),
      category,
      priceGbp: item.priceGbp,
      description: item.description,
      abv: item.abv,
      servingSize: item.servingSize,
      identity,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Food parsers (markdown #### blocks OR interact bullet lists)
// ---------------------------------------------------------------------------

const FOOD_BULLET_RE =
  /^\s*[-*]\s+\*\*(.+?)\*\*\s*:\s*£\s*(\d+(?:\.\d{1,2})?)\s*$/;
const FOOD_SECTION_BOLD_RE = /^#{2,3}\s+\*?\*?(.+?)\*?\*?\s*$/;

function dietaryFromName(name: string): FoodDietary[] | undefined {
  const tags: FoodDietary[] = [];
  if (/\bvegan\b|\(vg\)/i.test(name)) tags.push("vegan");
  if (/\bvegetarian\b|\(v\)/i.test(name) && !tags.includes("vegan")) {
    tags.push("vegetarian");
  }
  if (/\bgluten[- ]?free\b|\(gf\)/i.test(name)) tags.push("gluten-free");
  return tags.length > 0 ? tags : undefined;
}

/** Parse food from interact-style bullet text (### **Starters** / * **Item**: £x). */
export function parseFoodMarkdownFromInteractText(text: string): GreeneKingFoodItem[] {
  if (typeof text !== "string" || text.trim() === "") return [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const items: GreeneKingFoodItem[] = [];
  let section = "";

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const sec = line.match(FOOD_SECTION_BOLD_RE);
    if (sec && !line.startsWith("####")) {
      section = stripSectionCount(sec[1].replace(/\*\*/g, "").trim());
      continue;
    }
    const bullet = line.match(FOOD_BULLET_RE);
    if (bullet && section) {
      const name = bullet[1].trim();
      const priceGbp = Number(bullet[2]);
      if (!name || !isFinitePositive(priceGbp)) continue;
      items.push({
        name,
        section,
        priceGbp,
        dietary: dietaryFromName(name),
      });
    }
  }
  return items;
}

/**
 * Parse food from #### markdown blocks when present (same shape as drinks but
 * under food section headings). Falls back to interact-bullet parsing when no
 * #### food items yield prices.
 */
export function parseFoodMarkdown(markdown: string): GreeneKingFoodItem[] {
  if (typeof markdown !== "string" || markdown.trim() === "") return [];

  // Prefer interact-bullet shape when present — it's the common scrape form.
  const fromInteract = parseFoodMarkdownFromInteractText(markdown);
  if (fromInteract.length > 0) return fromInteract;

  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const items: GreeneKingFoodItem[] = [];
  let section = "";
  let itemName: string | null = null;
  let buf: string[] = [];

  const flush = () => {
    if (!itemName || !section) {
      itemName = null;
      buf = [];
      return;
    }
    // Skip drink sections when scanning a combined page.
    if (mapSectionToCategory(section) && !/starter|sharer|main|burger|dessert|side|snack/i.test(section)) {
      itemName = null;
      buf = [];
      return;
    }
    const body = buf.join("\n");
    const prices = parsePoundPrices(body);
    if (prices.length === 0) {
      itemName = null;
      buf = [];
      return;
    }
    const description = body
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !lineHasPrice(l))
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    items.push({
      name: itemName,
      section,
      priceGbp: prices[0],
      description: description || undefined,
      dietary: dietaryFromName(itemName),
    });
    itemName = null;
    buf = [];
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const sec = line.match(SECTION_RE);
    if (sec && !line.startsWith("####")) {
      const title = stripSectionCount(sec[1].replace(/\*\*/g, "").trim());
      if (/^filters?$/i.test(title)) continue;
      flush();
      section = title;
      continue;
    }
    const item = line.match(ITEM_RE);
    if (item) {
      flush();
      itemName = item[1].replace(/\*\*/g, "").trim();
      buf = [];
      continue;
    }
    if (itemName) buf.push(line);
  }
  flush();
  return items;
}

export function candidateFoodFromText(
  text: string,
  identity: GreeneKingPubIdentity,
): GreeneKingCandidateFood[] {
  const rows: GreeneKingCandidateFood[] = [];
  for (const item of parseFoodMarkdown(text)) {
    if (!item.name.trim()) continue;
    if (!isFinitePositive(item.priceGbp)) continue;
    const category = mapSectionToFoodCategory(item.section);
    if (!isFoodCategory(category)) continue;
    rows.push({
      itemName: item.name.trim(),
      category,
      priceGbp: item.priceGbp,
      description: item.description,
      dietary: item.dietary,
      identity,
    });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Venue matching
// ---------------------------------------------------------------------------

function normalise(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(the|greene\s*king|pub|bar|tavern|arms)\b/g, " ")
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function tokens(value: string): Set<string> {
  return new Set(normalise(value).split(" ").filter((t) => t.length > 1));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter += 1;
  return inter / (a.size + b.size - inter);
}

/**
 * Match a Greene King pub identity to exactly one dataset venue, or null.
 * Prefer website slug containment when available; otherwise require strong
 * normalised-name overlap (Jaccard ≥ 0.6). Ambiguous ties → null.
 */
export function matchVenue(
  identity: GreeneKingPubIdentity,
  dataset: DatasetVenue[],
  minScore = 0.6,
): VenueMatch | null {
  const slug = identity.slug.toLowerCase();
  if (slug) {
    const bySlug = dataset.filter((v) => {
      const site = (v.website ?? "").toLowerCase();
      return site.includes(`/pubs/`) && site.includes(`/${slug}`);
    });
    if (bySlug.length === 1) {
      return { venueKey: bySlug[0].venueKey, score: 1, matchedName: bySlug[0].name };
    }
    if (bySlug.length > 1) {
      // Disambiguate by name score among slug hits.
      const nameTokens = tokens(identity.name);
      const scored = bySlug
        .map((v) => ({
          venueKey: v.venueKey,
          score: jaccard(nameTokens, tokens(v.name)),
          matchedName: v.name,
        }))
        .sort((a, b) => b.score - a.score);
      if (scored[0] && (!scored[1] || scored[1].score < scored[0].score)) {
        return scored[0];
      }
      return null;
    }
  }

  const nameTokens = tokens(identity.name);
  if (nameTokens.size === 0) return null;
  const loc = normalise(identity.locality.replace(/greater-/g, ""));

  const scored: VenueMatch[] = [];
  for (const venue of dataset) {
    const score = jaccard(nameTokens, tokens(venue.name));
    if (score < minScore) continue;
    if (loc) {
      const addr = normalise(venue.address);
      const locOk = loc.split(" ").some((part) => part.length > 2 && addr.includes(part));
      // Locality is a soft hint for London (greater-london rarely appears in
      // addresses) — only enforce when the locality looks like a borough/town.
      if (loc !== "london" && loc !== "greater london" && !locOk) continue;
    }
    scored.push({ venueKey: venue.venueKey, score, matchedName: venue.name });
  }
  if (scored.length === 0) return null;
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  const tie = scored[1];
  if (tie && tie.score === top.score && tie.venueKey !== top.venueKey) return null;
  return top;
}
