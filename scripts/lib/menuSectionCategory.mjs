const GREENE_KING_RULES = [
  [null, ["main menu", "dessert", "snack", "kids", "ciabatta", "sunday menu", "gluten"]],
  ["wine", ["wine", "champagne", "spark"]],
  ["cocktail", ["cocktail", "spritz", "0%"]],
  ["beer", ["beer", "lager", "ale", "cider", "draught", "keg", "stout"]],
  ["whisky", ["whisk", "whiskey"]],
  ["gin", ["gin"]],
  ["vodka", ["vodka"]],
  ["rum", ["rum"]],
  ["shot", ["spirit", "shot"]],
  ["coffee", ["coffee", "hot drink"]],
  ["alcohol-free", ["alcohol-free", "alcohol free", "non-alcoholic", "no & low", "no and low"]],
  ["soft-drink", ["soft drink", "drink"]],
];

const MBPLC_RULES = [
  [null, ["fever-tree", "mixer", "tonic", "main menu", "sandwich", "buffet", "breakfast", "food"]],
  ["wine", ["wine", "champagne", "spark"]],
  ["cocktail", ["cocktail", "spritz"]],
  ["coffee", ["coffee", "hot drink"]],
  ["alcohol-free", ["alcohol-free", "alcohol free", "non-alcoholic", "low and no", "no & low", "no and low", "0.0"]],
  ["soft-drink", ["soft drink", "soda"]],
  ["beer", ["beer", "lager", "ale", "cider", "draught", "craft"]],
  ["whisky", ["whisk", "whiskey"]],
  ["gin", ["gin"]],
  ["vodka", ["vodka"]],
  ["rum", ["rum"]],
  ["shot", ["tequila", "spirit", "shot"]],
  ["other", ["other"]],
];

function categoryFromRules(section, rules) {
  const heading = section.toLowerCase();
  for (const [category, keywords] of rules) {
    if (keywords.some((keyword) => heading.includes(keyword))) return category;
  }
  return null;
}

export function mapGreeneKingSectionToCategory(section) {
  return categoryFromRules(section, GREENE_KING_RULES);
}

export function mapMbplcSectionToCategory(section) {
  return categoryFromRules(section, MBPLC_RULES);
}
