// Each publisher has its own ordered substring policy. The first match wins,
// including exclusions. Unknown headings remain null.
const GREENE_KING_SECTION_RULES = [
  { category: null, terms: ["main menu", "dessert", "snack", "kids", "ciabatta", "sunday menu", "gluten"] },
  { category: "wine", terms: ["wine", "champagne", "spark"] },
  { category: "cocktail", terms: ["cocktail", "spritz", "0%"] },
  { category: "beer", terms: ["beer", "lager", "ale", "cider", "draught", "keg", "stout"] },
  { category: "whisky", terms: ["whisk", "whiskey"] },
  { category: "gin", terms: ["gin"] },
  { category: "vodka", terms: ["vodka"] },
  { category: "rum", terms: ["rum"] },
  { category: "shot", terms: ["spirit", "shot"] },
  { category: "coffee", terms: ["coffee", "hot drink"] },
  { category: "alcohol-free", terms: ["alcohol-free", "alcohol free", "non-alcoholic", "no & low", "no and low"] },
  { category: "soft-drink", terms: ["soft drink"] },
  { category: "soft-drink", terms: ["drink"] },
];

const MBPLC_SECTION_RULES = [
  { category: null, terms: ["fever-tree", "mixer", "tonic", "main menu", "sandwich", "buffet", "breakfast", "food"] },
  { category: "wine", terms: ["wine", "champagne", "spark"] },
  { category: "cocktail", terms: ["cocktail", "spritz"] },
  { category: "coffee", terms: ["coffee", "hot drink"] },
  { category: "alcohol-free", terms: ["alcohol-free", "alcohol free", "non-alcoholic", "low and no", "no & low", "no and low", "0.0"] },
  { category: "soft-drink", terms: ["soft drink", "soda"] },
  { category: "beer", terms: ["beer", "lager", "ale", "cider", "draught", "craft"] },
  { category: "whisky", terms: ["whisk", "whiskey"] },
  { category: "gin", terms: ["gin"] },
  { category: "vodka", terms: ["vodka"] },
  { category: "rum", terms: ["rum"] },
  { category: "shot", terms: ["tequila"] },
  { category: "shot", terms: ["spirit", "shot"] },
  { category: "other", terms: ["other"] },
];

function matchSection(section, rules) {
  const lower = section.toLowerCase();
  for (const { category, terms } of rules) {
    if (terms.some(term => lower.includes(term))) return category;
  }
  return null;
}

export function mapGreeneKingSectionToCategory(section) {
  return matchSection(section, GREENE_KING_SECTION_RULES);
}

export function mapMbplcSectionToCategory(section) {
  return matchSection(section, MBPLC_SECTION_RULES);
}
