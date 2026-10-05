// The drink lane a free-text Plan request asks for.
// ---------------------------------------------------------------------------
// A Plan query is a sentence about a night out, not a printed drink name. Drink
// words turn up in it that nobody is asking to drink: a street ("Rye Lane"), a
// pub ("near The Wine Bar", "the Rose and Crown"), a menu ("the cocktail
// menu"), a refusal ("no cocktails") or someone else's order ("my mate wants
// pints"). Picking the wrong lane is not harmless - a non-beer lane drops pint
// evidence, so a ceiling rejects every stop, and a missed lane prices a wine
// night with pints. So this parser first cuts those spans out and only then
// reads what is left with the shared drink taxonomy, keeping its whole
// vocabulary and compounds ("glass of red", "root beer", "espresso martini").
// A first-person consumption clause ("while I am on pints") wins, and a request
// that names two lanes names none.

import { drinkCategoriesInText, drinkKeywordSpans } from "@/lib/drinkCategoryFromText";
import type { DrinkCategory } from "@/lib/drinks";

const CLAUSE_BREAK = /\b(?:while|whilst|but|whereas|although|though)\b|[,;!?]|\.(?!\d)/;

const COMPANION = "(?:mate|friend|partner|girlfriend|boyfriend|wife|husband|date|mum|dad|brother|sister)";
const POSSESSIVE = "(?:my|our|her|his|their)";
// "Pints for my mate": the order before the marker is the companion's.
const ORDER_FOR_COMPANION = new RegExp(`(?:^|\\band\\b)(?:(?!\\band\\b)[^])*?\\bfor ${POSSESSIVE} ${COMPANION}\\b`, "g");
// "My mate wants pints": the order after the marker is the companion's.
const COMPANION_ORDER = new RegExp(
  `\\b(?:${POSSESSIVE} ${COMPANION}(?:'s)?|she|he)(?:'s| is)? (?:wants|likes|loves|drinks|prefers|fancies|drinking|having)\\b[^]*?(?=\\band\\b|$)`,
  "g",
);

const FIRST_PERSON_ON = /\b(i am|i'm|im|we are|we're|i'll be|we'll be|is|[a-z]+'s)\s+on\b/gi;
const FIRST_PERSON_CONSUMPTION = /\b(?:i am|i'm|im|we are|we're|i'll be|we'll be) (?:drinking|having)\b|\b(?:i|we) (?:want|fancy|drink|like|prefer|need)\b|\b(?:i'd|we'd|i would|we would) (?:like|love|prefer)\b|\bfor (?:me|us)\b/;

// "In Soho serving wine", "a night in Soho drinking cocktails": the drink a
// place serves or a crew drinks there is a request, never part of the place.
const SERVING = "serving|serves|serve|pouring|pours|doing|does|drinking|drinks|having|has|have|that|which|where|who";
const LOCATION_WORDS = "near|at|in|by|opposite|beside|next to|around|off|outside|behind|past|from|towards?|via";
const SPAN_BREAK = `${LOCATION_WORDS}|${SERVING}|under|over|below|max|for|with`;
const SPAN_END = `(?=\\b(?:${SPAN_BREAK})\\b|${FIRST_PERSON_CONSUMPTION.source}|$)`;
// "near The Wine Bar", "on Rye Lane", "at Gin and Juice": a place, never an order.
const LOCATION_SPAN = new RegExp(`\\b(?:${LOCATION_WORDS})\\b[^]*?${SPAN_END}`, "g");
const PLACE_NOUNS = "lane|street|st|road|rd|avenue|ave|way|alley|bowl|palace|crown|arms|inn|tavern|house|hall|yard|market|square|place|court|row|hill|rooms|tree|terrace|garden|gardens|menu|menus|list|lists";
// A place or menu named without a preposition: "Rye Lane", "Rose and Crown", "cocktail menu".
const PLACE_OR_MENU = new RegExp(`\\b[\\w'&-]+(?:\\s+(?:and|&)\\s+[\\w'&-]+)?\\s+(?:${PLACE_NOUNS})\\b`, "g");
// "on the Wine Bar terrace", "on Cocktail Alley": `on` names a place only
// when a place noun ends that one phrase. "Soho on the wine", "on the
// Prosecco" and "on a wine crawl" name no place, and "on wine then Borough
// Market" moves on to a place, so the drink before it stays a request.
const ON_PLACE_BREAK = `${SPAN_BREAK}|then|till|until|round|down|up|along|all|to`;
const ON_PLACE = new RegExp(`\\bon\\s+(?:(?!(?:${ON_PLACE_BREAK})\\b)[\\w'&-]+\\s+)*?(?:${PLACE_NOUNS})\\b`, "g");
const REFUSAL = /\b(?:no|not|don't|dont|never|without|avoid|avoiding|except|hate|skip|instead of|rather than)\b/g;
const REFUSAL_LEAD = /^\s+(?:(?:want|like|drink|fancy|need|do|a|an|any|the|more)\s+)*/;
const COORDINATOR = /^\s+(?:or|nor)\s+/;
// Bare words the taxonomy reads as drinks that a night-out sentence rarely
// means as one: "a long session", "a bitter wind", and "shot" as an idiom.
const AMBIGUOUS_BARE_WORD = /\b(?:ryes?|roses?|ports?|punch(?:es)?|sours?|bitters?|sessions?|pales?|drafts?)(?![\wé])|\b(?:worth a|give (?:it|this|that) a|long|big) shot\b|\bshot at\b/g;

function singular(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * Cut every refused drink out of a request. A refusal takes the whole drink it
 * names, as the shared taxonomy reads it ("no ginger beer", "no gin and
 * tonic"), then each drink coordinated with `or`/`nor`, including a colour
 * shared with the next drink ("no red or white wine"). A refused word that is
 * not a drink ("no frills or fuss wine night") refuses nothing after it.
 */
function withoutRefusals(text: string): string {
  const phrases: { start: number; end: number }[] = [];
  for (const span of drinkKeywordSpans(text)) {
    const last = phrases.at(-1);
    if (last && /^\s+$/.test(text.slice(last.end, span.start))) last.end = span.end;
    else phrases.push({ start: span.start, end: span.end });
  }
  const phraseAt = (at: number) => phrases.find((phrase) => phrase.start === at);
  const coordinatedPhrase = (at: number) => {
    const coordinator = COORDINATOR.exec(text.slice(at));
    return coordinator ? phraseAt(at + coordinator[0].length) : undefined;
  };
  let request = text;
  for (const marker of text.matchAll(REFUSAL)) {
    const headAt = marker.index + marker[0].length + (REFUSAL_LEAD.exec(text.slice(marker.index + marker[0].length))?.[0].length ?? 0);
    let end = phraseAt(headAt)?.end;
    if (end === undefined) {
      const word = /^[\w'&-]+/.exec(text.slice(headAt))?.[0] ?? "";
      const next = coordinatedPhrase(headAt + word.length);
      const nextText = next ? text.slice(next.start, next.end) : "";
      const shared = `${word} ${nextText.split(" ").at(-1)}`;
      end = next && word && drinkKeywordSpans(shared).some((span) => span.start === 0 && span.end === shared.length)
        ? next.end
        : headAt + word.length;
    }
    for (let next = coordinatedPhrase(end); next; next = coordinatedPhrase(end)) end = next.end;
    request = request.slice(0, marker.index) + " ".repeat(end - marker.index) + request.slice(end);
  }
  return request;
}

function requestedCategories(clause: string): Set<DrinkCategory> {
  const request = clause
    .replace(ORDER_FOR_COMPANION, " ")
    .replace(COMPANION_ORDER, " ")
    .replace(LOCATION_SPAN, " ")
    .replace(ON_PLACE, " ")
    .replace(PLACE_OR_MENU, " ")
    .split(/\s+/)
    .map(singular)
    .join(" ");
  return drinkCategoriesInText(withoutRefusals(request).replace(AMBIGUOUS_BARE_WORD, " "));
}

function singleCategory(categories: Set<DrinkCategory>): DrinkCategory | null {
  return categories.size === 1 ? ([...categories][0] ?? null) : null;
}

/** The single drink lane a Plan query requests, or null when it names none or several. */
export function planRequestedDrinkCategory(query: string): DrinkCategory | null {
  const text = query
    .replace(/[‘’]/g, "'")
    .toLocaleLowerCase()
    .replace(FIRST_PERSON_ON, "$1 drinking");
  const consumed = new Set<DrinkCategory>();
  const requested = new Set<DrinkCategory>();
  for (const clause of text.split(CLAUSE_BREAK)) {
    const ownClause = clause.replace(ORDER_FOR_COMPANION, " ").replace(COMPANION_ORDER, " ");
    const target = FIRST_PERSON_CONSUMPTION.test(ownClause) ? consumed : requested;
    for (const category of requestedCategories(clause)) target.add(category);
  }
  return consumed.size > 0 ? singleCategory(consumed) : singleCategory(requested);
}
