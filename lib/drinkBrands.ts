// Curated drink-brand catalogs for Discover → map deep-links and the map
// drink lens. Pure + browser-safe: no server imports. Brands are a starter
// vocabulary (~4–8 per category) so `?drink=gin&brand=sipsmith` can filter
// without inventing a full menu DB. Identity is the `id`; matching uses the
// normalised label + optional aliases against venue search text / hints.

import {
  DRINK_CATEGORIES,
  type DrinkCategory,
  isDrinkCategory,
} from "@/lib/drinks";

export type DrinkBrand = {
  id: string;
  label: string;
  aliases?: string[];
};

export type DrinkBrandCatalog = Record<DrinkCategory, DrinkBrand[]>;

// Starter lists. Beer ids intentionally overlap lib/beers.ts where possible so
// the map favorite-pint path and the brand catalog can share an id. Shot/other
// stay empty — honest thin coverage until real menu rows land.
export const DRINK_BRANDS: DrinkBrandCatalog = {
  vodka: [
    { id: "absolut", label: "Absolut" },
    { id: "smirnoff", label: "Smirnoff" },
    { id: "grey-goose", label: "Grey Goose", aliases: ["gray goose"] },
    { id: "belvedere", label: "Belvedere" },
    { id: "ketel-one", label: "Ketel One" },
    { id: "ciroc", label: "Cîroc", aliases: ["ciroc"] },
  ],
  gin: [
    { id: "sipsmith", label: "Sipsmith" },
    { id: "tanqueray", label: "Tanqueray" },
    { id: "bombay-sapphire", label: "Bombay Sapphire", aliases: ["bombay"] },
    { id: "hendricks", label: "Hendrick's", aliases: ["hendricks"] },
    { id: "gordon", label: "Gordon's", aliases: ["gordons"] },
    { id: "beefeater", label: "Beefeater" },
    { id: "whitley-neill", label: "Whitley Neill" },
  ],
  whisky: [
    { id: "jameson", label: "Jameson" },
    { id: "jack-daniels", label: "Jack Daniel's", aliases: ["jack daniels", "jd"] },
    { id: "johnnie-walker", label: "Johnnie Walker", aliases: ["johnny walker"] },
    { id: "makers-mark", label: "Maker's Mark", aliases: ["makers mark"] },
    { id: "lagavulin", label: "Lagavulin" },
    { id: "glenlivet", label: "The Glenlivet", aliases: ["glenlivet"] },
    { id: "talisker", label: "Talisker" },
  ],
  rum: [
    { id: "bacardi", label: "Bacardi" },
    { id: "captain-morgan", label: "Captain Morgan" },
    { id: "havana-club", label: "Havana Club" },
    { id: "diplomatico", label: "Diplomático", aliases: ["diplomatico"] },
    { id: "mount-gay", label: "Mount Gay" },
    { id: "sailor-jerry", label: "Sailor Jerry", aliases: ["sailor jerry"] },
  ],
  wine: [
    { id: "prosecco", label: "Prosecco" },
    { id: "rioja", label: "Rioja" },
    { id: "malbec", label: "Malbec" },
    { id: "chardonnay", label: "Chardonnay" },
    { id: "pinot-grigio", label: "Pinot Grigio", aliases: ["pinot grigio"] },
    { id: "sauvignon-blanc", label: "Sauvignon Blanc" },
    { id: "champagne", label: "Champagne" },
  ],
  beer: [
    { id: "guinness", label: "Guinness" },
    { id: "neck-oil", label: "Neck Oil", aliases: ["neck oil", "beavertown", "bevertown"] },
    { id: "estrella", label: "Estrella", aliases: ["estrella damm"] },
    { id: "peroni", label: "Peroni" },
    { id: "amstel", label: "Amstel" },
    { id: "madri", label: "Madrí", aliases: ["madri"] },
    { id: "camden-hells", label: "Camden Hells", aliases: ["camden hell", "hells lager"] },
    { id: "birra-moretti", label: "Birra Moretti", aliases: ["moretti"] },
  ],
  cocktail: [
    { id: "negroni", label: "Negroni" },
    { id: "espresso-martini", label: "Espresso Martini" },
    { id: "aperol-spritz", label: "Aperol Spritz", aliases: ["aperol"] },
    { id: "old-fashioned", label: "Old Fashioned" },
    { id: "margarita", label: "Margarita" },
    { id: "mojito", label: "Mojito" },
  ],
  shot: [],
  other: [],
};

// Category tokens used when a venue has no structured drinkCategories hint —
// matched as substrings against normalised search text / pint names.
export const CATEGORY_SEARCH_TOKENS: Record<DrinkCategory, string[]> = {
  beer: ["beer", "pint", "lager", "ale", "ipa", "stout", "porter", "cider"],
  wine: ["wine", "prosecco", "champagne", "rioja", "malbec", "chardonnay"],
  whisky: ["whisky", "whiskey", "scotch", "bourbon", "dram"],
  gin: ["gin", "gin and tonic"],
  vodka: ["vodka"],
  rum: ["rum", "rhum"],
  cocktail: ["cocktail", "spritz", "negroni", "martini", "margarita", "mojito"],
  shot: ["shot", "shots", "tequila", "sambuca"],
  other: [],
};

// Tokens matched against the raw (lowercased) string before punctuation collapse,
// so "g&t" does not become the over-broad "g t" (which hits "canning town").
const CATEGORY_RAW_TOKENS: Partial<Record<DrinkCategory, string[]>> = {
  gin: ["g&t", "g & t"],
};

/** Brands listed for a category (empty array for thin-coverage categories). */
export function brandsForCategory(cat: DrinkCategory): DrinkBrand[] {
  return DRINK_BRANDS[cat] ?? [];
}

/** Look up a brand by id across every category. */
export function findBrand(
  id: string,
): { category: DrinkCategory; brand: DrinkBrand } | null {
  const needle = normalizeBrandQuery(id);
  if (!needle) return null;
  for (const category of DRINK_CATEGORIES) {
    for (const brand of DRINK_BRANDS[category]) {
      if (brand.id === needle) return { category, brand };
    }
  }
  return null;
}

/** Lowercase + collapse punctuation so URL/query brand ids stay stable. */
export function normalizeBrandQuery(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Normalise free text for substring brand/category matching. */
export function normalizeDrinkHaystack(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** All match needles for a brand (id, label, aliases), normalised for haystacks. */
export function brandMatchNeedles(brand: DrinkBrand): string[] {
  const raw = [brand.id.replace(/-/g, " "), brand.label, ...(brand.aliases ?? [])];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of raw) {
    const n = normalizeDrinkHaystack(part);
    if (n && !seen.has(n)) {
      seen.add(n);
      out.push(n);
    }
  }
  return out;
}

/** True when haystack contains any brand needle as a word-ish token. */
export function haystackMatchesBrand(haystack: string, brand: DrinkBrand): boolean {
  const hay = normalizeDrinkHaystack(haystack);
  if (!hay) return false;
  return brandMatchNeedles(brand).some((needle) => {
    if (!needle) return false;
    // Multi-word needles stay substring (same as category tokens); single
    // tokens use word boundaries so "jd" does not match inside "adjourned".
    if (needle.includes(" ")) return hay.includes(needle);
    const re = new RegExp(`(^| )${needle}( |$)`);
    return re.test(hay);
  });
}

/** True when haystack mentions the category via curated tokens (word-ish). */
export function haystackMatchesCategory(
  haystack: string,
  category: DrinkCategory,
): boolean {
  const raw = haystack.toLowerCase();
  if ((CATEGORY_RAW_TOKENS[category] ?? []).some((token) => raw.includes(token))) {
    return true;
  }
  const hay = normalizeDrinkHaystack(haystack);
  if (!hay) return false;
  return CATEGORY_SEARCH_TOKENS[category].some((token) => {
    const n = normalizeDrinkHaystack(token);
    if (!n) return false;
    if (n.includes(" ")) return hay.includes(n);
    // Word-boundary guard so "gin" does not match inside "engineering".
    const re = new RegExp(`(^| )${n}( |$)`);
    return re.test(hay);
  });
}

/** Guard for URL/query drink values that are real DrinkCategory ids. */
export function parseDrinkCategoryParam(
  value: string | null | undefined,
): DrinkCategory | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().toLowerCase();
  return isDrinkCategory(trimmed) ? trimmed : null;
}

/** Categories with at least one curated brand (for UI empty-state honesty). */
export function categoryHasBrandCoverage(cat: DrinkCategory): boolean {
  return brandsForCategory(cat).length > 0;
}
