// Detects non-alcoholic / low-alcohol (0.0%–0.5% ABV) drinks from a pub's drink
// names, so the map can flag and filter the pubs that actually pour a proper
// alcohol-free pint (Lucky Saint, Guinness 0.0, Nanny State, "…Alcohol Free 0.5%").
// Pure + string-only, so it's fully covered by __tests__/nonAlcoholicDrinks.test.ts
// against real dataset drink names.
//
// Deliberately conservative: a bare "ERDINGER" is the ALCOHOLIC wheat beer, so we
// only match "Erdinger Alkoholfrei" — never the brand alone. Same idea for lager
// names that only count when paired with a "0".

const NA_BRANDS: readonly string[] = [
  "lucky saint",
  "nanny state",
  "big drop",
  "mash gang",
  "days brewing",
  "beck's blue",
  "becks blue",
  "free damm",
  "erdinger alkoholfrei",
  "infinite session",
  "impossibrew",
  "st peter's without",
];

export const NON_ALCOHOLIC_QUALIFIER = /\b(?:alcohol[\s-]?free|non[\s-]?alcoholic|low[\s-]alcohol|zero[\s-]alcohol|0[.,]0\b|0[.,]5\s*%|0\s*%|AF\b)/i;

const NA_PATTERNS: readonly RegExp[] = [
  NON_ALCOHOLIC_QUALIFIER,
  /(guinness|heineken|peroni|san miguel|corona|stella|birra moretti|estrella|madri|asahi)\s*0/i,
];

// Is a single drink name a non-alcoholic / low-no option?
export function isNonAlcoholicDrink(name: string): boolean {
  const raw = String(name ?? "");
  const lower = raw.toLowerCase();
  if (!lower.trim()) return false;
  if (NA_BRANDS.some((brand) => lower.includes(brand))) return true;
  return NA_PATTERNS.some((pattern) => pattern.test(raw));
}

// Does this pub pour at least one non-alcoholic option?
export function hasNonAlcoholic(pintNames: readonly string[]): boolean {
  return pintNames.some((name) => isNonAlcoholicDrink(name));
}
