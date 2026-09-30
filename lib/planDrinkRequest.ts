// The drink lane a free-text Plan request asks for.
// ---------------------------------------------------------------------------
// The general label taxonomy (`drinkCategoryFromText`) classifies a printed
// drink name, so it treats "Rye", "Rose" or "Punch" as drink words. A Plan
// query is a sentence about a night out: those words are far more often part
// of a street or pub name than a request. Picking the wrong lane is not
// harmless - a non-beer lane drops pint evidence, so a ceiling rejects every
// stop. This parser therefore reads only unambiguous drink nouns, ignores
// mentions that name a place, a menu, someone else's drink or a refusal, and
// lets a first-person consumption clause ("while I am on pints") win. Mixed
// requests name no single lane and return null.

import type { DrinkCategory } from "@/lib/drinks";

const REQUEST_TERMS: ReadonlyArray<[DrinkCategory, readonly string[]]> = [
  ["beer", ["pint", "pints", "beer", "beers", "lager", "lagers", "ale", "ales", "ipa", "ipas", "stout", "stouts", "cider", "ciders", "guinness"]],
  ["wine", ["wine", "wines", "prosecco", "champagne"]],
  ["whisky", ["whisky", "whiskies", "whiskey", "whiskeys", "bourbon", "scotch"]],
  ["gin", ["gin", "gins", "g&t", "g&ts"]],
  ["vodka", ["vodka", "vodkas"]],
  ["rum", ["rum", "rums"]],
  ["cocktail", ["cocktail", "cocktails", "spritz", "spritzes", "margarita", "margaritas"]],
  ["shot", ["shots"]],
];

const CLAUSE_BREAK = /\b(?:while|whilst|but|whereas|although|though)\b|[,;!?]|\.(?!\d)/;
const PLACE_OR_MENU_NOUN = /^\s+(?:lane|street|st|road|rd|avenue|ave|way|bowl|palace|crown|arms|inn|tavern|house|hall|yard|market|square|place|court|row|hill|rooms|tree|garden|gardens|menu|menus|list|lists)\b/;
const NEGATION_BEFORE = /\b(?:no|not|don't|dont|never|without|avoid|avoiding|except|hate|skip|instead of|rather than)\s+(?:\S+\s+){0,2}$/;
const COMPANION = /\bfor (?:my|our|her|his|their) (?:mate|friend|partner|girlfriend|boyfriend|wife|husband|date|mum|dad|brother|sister)\b|\b(?:my|our|her|his|their) (?:mate|friend|partner|girlfriend|boyfriend|wife|husband|date|mum|dad|brother|sister)(?:'s)? (?:wants|likes|loves|drinks|prefers|fancies|is on)\b|\b(?:she|he)(?:'s| is)? (?:on|drinking|wants|likes|prefers|fancies)\b/;
const FIRST_PERSON_CONSUMPTION = /\b(?:i am|i'm|im|we are|we're|i'll be|we'll be) (?:on|drinking|having)\b|\b(?:i|we) (?:want|fancy|drink|like|prefer|need)\b|\b(?:i'd|we'd|i would|we would) (?:like|love|prefer)\b|\bfor (?:me|us)\b/;

function escapeTerm(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionedCategories(clause: string): Set<DrinkCategory> {
  const categories = new Set<DrinkCategory>();
  for (const [category, terms] of REQUEST_TERMS) {
    for (const term of terms) {
      const pattern = new RegExp(`(^|[^a-z0-9&])${escapeTerm(term)}(?=[^a-z0-9&]|$)`, "g");
      for (const match of clause.matchAll(pattern)) {
        const start = match.index + match[1].length;
        const end = start + term.length;
        if (PLACE_OR_MENU_NOUN.test(clause.slice(end))) continue;
        if (NEGATION_BEFORE.test(clause.slice(0, start))) continue;
        categories.add(category);
      }
    }
  }
  return categories;
}

function singleCategory(categories: Set<DrinkCategory>): DrinkCategory | null {
  return categories.size === 1 ? [...categories][0] : null;
}

/** The single drink lane a Plan query requests, or null when it names none or several. */
export function planRequestedDrinkCategory(query: string): DrinkCategory | null {
  const text = query.toLocaleLowerCase().replace(/[‘’]/g, "'");
  const consumed = new Set<DrinkCategory>();
  const requested = new Set<DrinkCategory>();
  for (const clause of text.split(CLAUSE_BREAK)) {
    if (COMPANION.test(clause)) continue;
    const target = FIRST_PERSON_CONSUMPTION.test(clause) ? consumed : requested;
    for (const category of mentionedCategories(clause)) target.add(category);
  }
  return consumed.size > 0 ? singleCategory(consumed) : singleCategory(requested);
}
