// Hard venue requirements: what a discovery ask names that a pub must have on
// record to be offered. A mood is a preference and only moves the ranking. A
// requirement filters, and a pub with no record of it is left out rather than
// guessed in.
//
// Evidence rules:
//   - A beer garden needs the dated garden fact, from a source and a date that
//     lib/venueFeatureEvidence.ts accepts. `amenities.beerGarden` also carries
//     pavement seating and undated flags, so it never answers alone.
//   - Outdoor seating accepts a dated garden or a dated outdoor-seating fact.
//   - A quiz needs a sourced quiz listing for that pub.
//   - A drink needs its name in the pub's own priced drink names. Drink
//     categories are not evidence, because the builder can assign one by hash.

import placeNames from "@/lib/ask/placeNames.generated.json";
import { wordsOnly } from "@/lib/ask/placePhrases";
import { BEERS } from "@/lib/beers";
import type { ConciergeVenue } from "@/lib/concierge/rank";
import { formatObservedDate } from "@/lib/dataFreshnessFormat";
import {
  DRINK_BRANDS,
  brandMatchNeedles,
  haystackMatchesBrand,
  haystackMatchesCategory,
  normalizeDrinkHaystack,
  type DrinkBrand,
} from "@/lib/drinkBrands";
import {
  DRINK_SUBTYPES,
  haystackMatchesSubtype,
  haystackMatchesSubtypeBrand,
  type DrinkSubtype,
} from "@/lib/drinkSubtypes";
import type { DrinkCategory } from "@/lib/drinks";
import { legacyPintPriceObservedAt, namedLegacyPintPriceSource } from "@/lib/legacyPriceEvidence.mjs";
import { isNonAlcoholicDrink } from "@/lib/nonAlcoholicDrinks";
import { canonicalOutVenueId } from "@/lib/out/venueId";
import type { VenuePrice } from "@/lib/venues";
import { positiveFeatureObservation, type VenueFeature, type VenueFeatureObservation } from "@/lib/venueFeatureEvidence";
import type { WhatsOnRow } from "@/lib/whatsOn";

export type VenueRequirement = (
  | { kind: "garden" | "outdoor-seating" | "darts" | "pool" | "dogs" | "quiz" }
  | { kind: "drink"; label: string; match: DrinkMatch }
) & { excluded?: true; unclear?: true };

type DrinkMatch =
  | { by: "brand"; brand: DrinkBrand }
  | { by: "subtype"; subtype: DrinkSubtype }
  | { by: "category"; category: DrinkCategory };

const FEATURE_TERMS: ReadonlyArray<readonly [Exclude<VenueRequirement["kind"], "drink">, RegExp]> = [
  ["garden", /\b(?:beer )?gardens?\b/],
  ["outdoor-seating", /\boutdoors?\b|\bal fresco\b|\bterraces?\b|\b(?:sit|sitting|seats?|seating|drinks?|drinking|tables?|space)\s+outside\b/],
  ["darts", /\bdarts? ?boards?\b|\b(?:play|playing|with|has|have|got)\s+(?:a\s+)?darts\b/],
  ["pool", /\bpool tables?\b|\b(?:play|playing|shoot|shooting)\s+pool(?: tables?)?\b|\bwith\s+(?:a\s+)?pool(?: tables?)?\b/],
  ["dogs", /\bdog friendly\b|\bdogs? (?:allowed|welcome)\b|\b(?:bring|with)\s+(?:my|our|the|a)\s+dogs?\b/],
  ["quiz", /\bquiz(?:zes)?\b|\btrivia\b/],
];

const NEGATED_FEATURE_TERMS: ReadonlyMap<Exclude<VenueRequirement["kind"], "drink">, RegExp> = new Map([
  ["dogs", /\bno dogs?\b|\bdogs? (?:are |is )?(?:not|never|arent|isnt) (?:allowed|welcome|permitted)\b|\bdogs? banned\b/],
  ["darts", /\bno darts\b/],
  ["pool", /\bno pool\b/],
]);

/** Drinks a pub's priced drink names can answer. Soft drinks and coffee never reach them. */
const DRINK_CATEGORY_LABELS: ReadonlyArray<readonly [DrinkCategory, string]> = [
  ["gin", "gin"],
  ["wine", "wine"],
  ["whisky", "whisky"],
  ["vodka", "vodka"],
  ["rum", "rum"],
  ["alcohol-free", "alcohol-free drinks"],
];
const BRAND_CATEGORIES = new Set<DrinkCategory>(["beer", ...DRINK_CATEGORY_LABELS.map(([category]) => category)]);

let placePhrasesLongestFirst: string[] | null = null;

function placePhrases(): string[] {
  placePhrasesLongestFirst ??= [...new Set([
    ...placeNames.nightAreas.flatMap((area) => [area.name, ...area.aliases, ...area.transportAnchors]),
    ...placeNames.localityNames,
    ...placeNames.stationNames,
  ].map(wordsOnly).filter(Boolean))].sort((a, b) => b.length - a.length);
  return placePhrasesLongestFirst;
}

function withoutPhrase(text: string, phrase: string): string {
  return text.includes(` ${phrase} `) ? text.split(` ${phrase} `).join(" ") : text;
}

function withoutPlaces(padded: string): string {
  for (const phrase of placePhrases()) padded = withoutPhrase(padded, phrase);
  return padded;
}

const NEGATORS = new Set([
  "no", "not", "without", "never", "dont", "doesnt", "isnt", "arent", "cant", "wont",
  "avoid", "avoiding", "skip", "except", "excluding", "nothing", "none",
]);
const NEGATION_IDIOMS = new Set(["only", "just", "too", "so", "sure", "bothered", "fussed", "far", "more", "less", "much", "mind", "quite", "necessarily"]);
const NEGATION_FILLERS = new Set([
  "a", "an", "the", "any", "some", "sort", "kind", "type", "of", "in", "at", "all", "slightest", "least", "bit",
  "whatsoever", "really", "even", "pub", "pubs", "bar", "bars", "place", "places", "venue", "venues", "somewhere",
  "anywhere", "one", "ones", "with", "that", "which", "where", "who", "have", "has", "having", "had", "got",
  "serve", "serves", "serving", "sell", "sells", "offer", "offers", "do", "does", "want", "wanna", "need", "like",
  "fancy", "to", "go", "be", "is", "are", "there", "i", "we", "me", "us", "my", "our", "it",
]);
const CLAUSE_BREAKS = new Set(["but", "though", "although", "plus", "also"]);
const COORDINATORS = new Set(["and", "or", "nor"]);
const DETERMINERS = new Set(["a", "an", "the", "any"]);
const NEGATION_REACH = 10;

function governingNegator(words: readonly string[], end: number, fillers: ReadonlySet<string>): number | null {
  let index = end - 1;
  while (index >= 0 && end - index <= NEGATION_REACH && fillers.has(words[index]!)) index -= 1;
  return index >= 0 && NEGATORS.has(words[index]!) && !NEGATION_IDIOMS.has(words[index + 1] ?? "") ? index : null;
}

type NegationScope = "stated" | "unclear" | null;

function negatorInClause(words: readonly string[], end: number): boolean {
  for (let back = end - 1; back >= 0; back -= 1) {
    const word = words[back]!;
    if (CLAUSE_BREAKS.has(word)) return false;
    if (NEGATORS.has(word) && !NEGATION_IDIOMS.has(words[back + 1] ?? "")) return true;
  }
  return false;
}

function negatedBefore(padded: string, at: number): NegationScope {
  const words = padded.slice(0, Math.max(0, at)).trim().split(/\s+/).filter(Boolean);
  if (governingNegator(words, words.length, NEGATION_FILLERS) !== null) return "stated";
  let index = words.length - 1;
  while (index >= 0 && DETERMINERS.has(words[index]!)) index -= 1;
  if (index >= 0 && COORDINATORS.has(words[index]!)) {
    for (let back = index - 1; back >= 0 && index - back <= NEGATION_REACH; back -= 1) {
      const word = words[back]!;
      if (CLAUSE_BREAKS.has(word)) break;
      if (NEGATORS.has(word) && !NEGATION_IDIOMS.has(words[back + 1] ?? "")) return "stated";
    }
  }
  return negatorInClause(words, words.length) ? "unclear" : null;
}

function categorySpan(padded: string, category: DrinkCategory): { start: number; end: number } | null {
  let offset = 0;
  const words = padded.split(" ").map((word) => {
    const at = offset;
    offset += word.length + 1;
    return { word, at };
  });
  const single = words.find(({ word }) => word && haystackMatchesCategory(word, category));
  if (single) return { start: single.at, end: single.at + single.word.length };
  const pairAt = words.findIndex(({ word }, index) => word && haystackMatchesCategory(`${word} ${words[index + 1]?.word ?? ""}`.trim(), category));
  const pair = words[pairAt];
  return pair ? { start: pair.at, end: pair.at + pair.word.length + 1 + (words[pairAt + 1]?.word.length ?? 0) } : null;
}

function requirementScope(padded: string, start: number, end: number): NegationScope {
  const before = negatedBefore(padded, start);
  if (before) return before;
  const prior = padded.slice(0, start).trim().split(/\s+/).at(-1);
  const after = padded.slice(end).trim().split(/\s+/).filter(Boolean);
  if (prior === "free" || after[0] === "free") return "unclear";
  if (/^(?:(?:is|are|was|were) )?(?:not|never|isnt|arent|wasnt|werent) (?:allowed|welcome|permitted|served|available|wanted|needed)\b/.test(after.join(" "))) return "unclear";
  return null;
}

function excludedIf<T extends VenueRequirement>(requirement: T, scope: NegationScope): T {
  if (scope === "unclear") return { ...requirement, excluded: true, unclear: true };
  return scope === "stated" ? { ...requirement, excluded: true } : requirement;
}

/** Takes the first needle found, so a brand's words cannot also count as a style. */
function takeNeedle(padded: string, needles: readonly string[]): { rest: string; excluded: NegationScope } | null {
  const hit = needles.find((needle) => needle && padded.includes(` ${needle} `));
  const at = hit ? padded.indexOf(` ${hit} `) : -1;
  return hit ? { rest: withoutPhrase(padded, hit), excluded: requirementScope(padded, at, at + hit.length + 1) } : null;
}

/** An adjective first, so a bare one never stands for the style: "a hazy evening". */
const AMBIGUOUS_STYLE_TOKENS = new Set(["hazy"]);

/**
 * Brands are read before place names are taken out, so "Camden Hells" stays a
 * beer, but a needle that is itself a place ("camden") never names one. The
 * rest of the ask is read with every place removed: "Covent Garden" is not a
 * garden.
 */
function drinkRequirements(text: string): { found: VenueRequirement[]; rest: string } {
  const places = new Set(placePhrases());
  let padded = ` ${wordsOnly(text)} `;
  const found: VenueRequirement[] = [];
  const brands = [...BEERS, ...[...BRAND_CATEGORIES].flatMap((category) => DRINK_BRANDS[category])];
  const seenBrands = new Set<string>();
  for (const brand of brands) {
    if (seenBrands.has(brand.id)) continue;
    seenBrands.add(brand.id);
    const taken = takeNeedle(padded, brandMatchNeedles(brand).filter((needle) => !places.has(needle)));
    if (taken === null) continue;
    padded = taken.rest;
    found.push(excludedIf({ kind: "drink", label: brand.label, match: { by: "brand", brand } }, taken.excluded));
  }
  padded = withoutPlaces(padded);
  for (const subtype of DRINK_SUBTYPES) {
    if (subtype.category !== "beer") continue;
    const taken = takeNeedle(padded, subtype.tokens.map(normalizeDrinkHaystack).filter((token) => !AMBIGUOUS_STYLE_TOKENS.has(token)));
    if (taken === null) continue;
    padded = taken.rest;
    found.push(excludedIf({ kind: "drink", label: subtype.longLabel === "IPA" ? "IPA" : subtype.longLabel.toLowerCase(), match: { by: "subtype", subtype } }, taken.excluded));
  }
  for (const [category, label] of DRINK_CATEGORY_LABELS) {
    const alcoholFree = category === "alcohol-free" ? /\b(?:non alcoholic|alcohol free|low alcohol|zero alcohol)\b/.exec(padded) : null;
    if (category === "alcohol-free" ? alcoholFree : haystackMatchesCategory(padded, category)) {
      const span = alcoholFree ? { start: alcoholFree.index, end: alcoholFree.index + alcoholFree[0].length } : categorySpan(padded, category);
      found.push(excludedIf({ kind: "drink", label, match: { by: "category", category } }, span ? requirementScope(padded, span.start, span.end) : null));
    }
  }
  return { found, rest: padded };
}

/** Hard requirements the ask names, in a stable order. Moods and budgets are not here. */
export function venueRequirementsInText(text: string): VenueRequirement[] {
  const drinks = drinkRequirements(text.replace(/[,;.!?]+/g, " but "));
  const features = FEATURE_TERMS.flatMap(([kind, pattern]) => {
    if (NEGATED_FEATURE_TERMS.get(kind)?.test(drinks.rest)) return [excludedIf({ kind }, "stated")];
    const hit = pattern.exec(drinks.rest);
    return hit ? [excludedIf({ kind }, requirementScope(drinks.rest, hit.index, hit.index + hit[0].length))] : [];
  });
  const outdoorCoveredByGarden = features.some((feature) => feature.kind === "garden");
  return [
    ...features.filter((feature) => !(feature.kind === "outdoor-seating" && outdoorCoveredByGarden)),
    ...drinks.found,
  ];
}

/** The same ask with a garden relaxed to outdoor seating, for the scarcity line only. */
export function outdoorSeatingInstead(requirements: readonly VenueRequirement[]): VenueRequirement[] | null {
  if (!requirements.some((requirement) => requirement.kind === "garden" && !requirement.excluded)) return null;
  return requirements.map((requirement) => requirement.kind === "garden" && !requirement.excluded ? { kind: "outdoor-seating" } : requirement);
}

export type QuizListing = { source: string; observedAt: string };

export type PricedDrink = { name: string; source: string; observedAt: string };

export type RequirementContext = {
  now: number;
  quizListings: ReadonlyMap<string, QuizListing> | null;
  pricedDrinks: ReadonlyMap<string, readonly PricedDrink[]> | null;
  websiteAmenities: ReadonlyMap<string, Partial<Record<"darts" | "pool", readonly VenueFeatureObservation[]>>> | null;
};

export type RequirementProof = { requirement: string; source: string; observedAt: string };

export function requirementKey(requirement: VenueRequirement): string {
  const key = requirement.kind === "drink" ? `drink:${requirement.label}` : requirement.kind;
  return requirement.unclear ? `unclear:${key}` : requirement.excluded ? `not:${key}` : key;
}

export function venueQuizListings(rows: readonly WhatsOnRow[], now: number): Map<string, QuizListing> {
  const listings = new Map<string, QuizListing>();
  for (const row of rows) {
    const venueId = canonicalOutVenueId(row.venueId);
    const source = row.source?.label?.trim();
    const observedAt = Date.parse(row.observedAt);
    if (row.kind !== "quiz" || !venueId || !source || listings.has(venueId)) continue;
    if (!Number.isFinite(observedAt) || observedAt > now || !(row.startsAt || row.startsDate)) continue;
    listings.set(venueId, { source, observedAt: row.observedAt });
  }
  return listings;
}

export function venuePricedDrinks(
  venues: readonly { id: string; prices?: readonly VenuePrice[] }[],
  now: number,
): Map<string, PricedDrink[]> {
  const drinks = new Map<string, PricedDrink[]>();
  for (const venue of venues) {
    const rows = (venue.prices ?? []).flatMap((price) => {
      const name = price.pint_name?.trim();
      const source = namedLegacyPintPriceSource(price)?.label;
      const observedAt = legacyPintPriceObservedAt(price, now);
      return name && source && observedAt ? [{ name, source, observedAt }] : [];
    });
    if (rows.length) drinks.set(venue.id, rows);
  }
  return drinks;
}

export function requirementCoverageGaps(requirements: readonly VenueRequirement[], context: RequirementContext): string[] {
  return requirements.filter((requirement) => requirement.excluded
    || ((requirement.kind === "darts" || requirement.kind === "pool") && context.websiteAmenities === null)
    || (requirement.kind === "quiz" && context.quizListings === null)
    || (requirement.kind === "drink" && context.pricedDrinks === null)).map(requirementKey);
}

function observedFeature(
  requirement: string,
  observation: VenueFeatureObservation | undefined,
  feature: VenueFeature,
  now: number,
): RequirementProof | null {
  return observation && positiveFeatureObservation(observation, feature, now)
    ? { requirement, source: observation[1], observedAt: observation[2] }
    : null;
}

function drinkNameMatches(name: string, match: DrinkMatch): boolean {
  if (match.by === "category" && match.category === "alcohol-free" && isNonAlcoholicDrink(name)) return true;
  return match.by === "brand"
    ? haystackMatchesBrand(name, match.brand)
    : match.by === "subtype"
      ? haystackMatchesSubtype(name, match.subtype) || haystackMatchesSubtypeBrand(name, match.subtype)
      : haystackMatchesCategory(name, match.category);
}

function drinkTagged(venue: ConciergeVenue, match: DrinkMatch): boolean {
  if (match.by === "category" && match.category === "alcohol-free" && venue.amenities.nonAlcoholic === true) return true;
  return (venue.drinkText ?? "").split(";").map((name) => name.trim()).some((name) => name && drinkNameMatches(name, match));
}

function requirementTagged(venue: ConciergeVenue, requirement: VenueRequirement): boolean {
  if (requirement.excluded) return false;
  switch (requirement.kind) {
    case "darts":
      return venue.amenities.darts === true;
    case "pool":
      return venue.amenities.pool === true;
    case "drink":
      return drinkTagged(venue, requirement.match);
    default:
      return false;
  }
}

/** What proves a pub meets one requirement, or null when it has no accepted record of it. */
export function requirementProof(
  venue: ConciergeVenue,
  requirement: VenueRequirement,
  context: RequirementContext,
): RequirementProof | null {
  if (requirement.excluded) return null;
  const facts = venue.features ?? {};
  const key = requirementKey(requirement);
  switch (requirement.kind) {
    case "garden":
      return observedFeature(key, facts.garden, "beerGarden", context.now);
    case "outdoor-seating":
      return observedFeature(key, facts.garden, "beerGarden", context.now)
        ?? observedFeature(key, facts.outdoorSeating, "outdoorSeating", context.now);
    case "darts":
    case "pool": {
      const feature = requirement.kind;
      const observation = context.websiteAmenities?.get(venue.id)?.[feature]
        ?.find((candidate) => positiveFeatureObservation(candidate, feature, context.now));
      return observation ? { requirement: key, source: observation[1], observedAt: observation[2] } : null;
    }
    case "dogs":
      return observedFeature(key, facts.dogsWelcome, "dogsWelcome", context.now);
    case "quiz": {
      const listing = context.quizListings?.get(venue.id);
      return listing ? { requirement: key, source: listing.source, observedAt: listing.observedAt } : null;
    }
    case "drink": {
      const match = requirement.match;
      const row = context.pricedDrinks?.get(venue.id)?.find((drink) => drinkNameMatches(drink.name, match));
      return row ? { requirement: key, source: row.source, observedAt: row.observedAt } : null;
    }
  }
}

export function requirementProofs(
  venue: ConciergeVenue,
  requirements: readonly VenueRequirement[],
  context: RequirementContext,
): RequirementProof[] | null {
  const proofs: RequirementProof[] = [];
  for (const requirement of requirements) {
    const proof = requirementProof(venue, requirement, context);
    if (!proof) return null;
    proofs.push(proof);
  }
  return proofs;
}

export function unverifiedRequirements(
  venue: ConciergeVenue,
  requirements: readonly VenueRequirement[],
  context: RequirementContext,
): string[] | null {
  const tagged: string[] = [];
  for (const requirement of requirements) {
    if (requirementProof(venue, requirement, context)) continue;
    if (!requirementTagged(venue, requirement)) return null;
    tagged.push(requirementKey(requirement));
  }
  return tagged.length ? tagged : null;
}

function observedDay(observedAt: string): string {
  return formatObservedDate(new Date(/^\d{4}-\d{2}-\d{2}$/.test(observedAt) ? `${observedAt}T12:00:00Z` : observedAt));
}

export function requirementProofLine(
  venue: ConciergeVenue,
  requirement: VenueRequirement,
  proof: RequirementProof,
  now: number,
): string {
  const dated = ` (${proof.source}, ${observedDay(proof.observedAt)})`;
  const fromGarden = observedFeature(proof.requirement, venue.features?.garden, "beerGarden", now) !== null;
  switch (requirement.kind) {
    case "garden":
      return `Beer garden on record${dated}`;
    case "outdoor-seating":
      return `${fromGarden ? "Beer garden" : "Outdoor seating"} on record${dated}`;
    case "darts":
      return `Darts on record${dated}`;
    case "pool":
      return `Pool table on record${dated}`;
    case "dogs":
      return `Dogs welcome on record${dated}`;
    case "quiz":
      return `Quiz listed${dated}`;
    case "drink":
      return `${requirement.label} on its listed drinks${dated}`;
  }
}

function requirementLabel(requirement: VenueRequirement): string {
  switch (requirement.kind) {
    case "garden": return "a beer garden";
    case "outdoor-seating": return "outdoor seating";
    case "darts": return "darts";
    case "pool": return "a pool table";
    case "dogs": return "dogs welcome";
    case "quiz": return "a quiz";
    case "drink": return requirement.label;
  }
}

function coverageGapReason(requirement: VenueRequirement): string {
  if (requirement.unclear) return `I can't tell whether you want ${requirementLabel(requirement)} or not`;
  if (requirement.excluded) {
    return requirement.kind === "dogs"
      ? "I can't check that a pub turns dogs away"
      : `I can't check that a pub has no ${requirement.kind === "drink" ? requirement.label : requirementLabel(requirement).replace(/^an? /, "")}`;
  }
  switch (requirement.kind) {
    case "quiz": return "I can't check the quiz listings right now";
    case "drink": return `I can't check the dated price records for ${requirement.label} right now`;
    default: return `I can't check the pub website records for ${requirementLabel(requirement)} here`;
  }
}

function listed(labels: readonly string[]): string {
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : labels[0] ?? "";
}

/** The line when fewer pubs meet the requirements than were asked for, or some could not be checked. */
export function requirementScarcityLine(input: {
  requirements: readonly VenueRequirement[];
  found: number;
  area?: string;
  coverageGaps?: readonly string[];
  unverified?: number;
  /** More pubs would qualify with outdoor seating in place of a garden. */
  outdoorSeatingOnly?: boolean;
}): string {
  const gaps = input.requirements.filter((requirement) => input.coverageGaps?.includes(requirementKey(requirement)));
  const unverified = input.unverified ?? 0;
  const tagged = unverified
    ? ` ${unverified}${input.found ? " more" : ""} listed ${unverified === 1 ? "pub has" : "pubs have"} an unchecked tag for it, which is not proof either way.`
    : "";
  if (gaps.length) return `${gaps.map(coverageGapReason).join(". ")}, so I won't name a pub as confirmed.${tagged}`;
  const named = listed(input.requirements.map(requirementLabel));
  const area = input.area?.trim();
  const where = area && area.toLocaleLowerCase("en-GB") !== "london" ? ` in ${area}` : "";
  const record = unverified ? `a dated record of ${named}` : `${named} on record`;
  const line = input.found === 0
    ? `No listed pub${where} has ${record}, so I won't guess.`
    : `Only ${input.found} listed ${input.found === 1 ? "pub" : "pubs"}${where} ${input.found === 1 ? "has" : "have"} ${record}.`;
  return input.outdoorSeatingOnly
    ? `${line} More have outdoor seating on record but no garden. Ask to sit outside to see them.${tagged}`
    : `${line}${tagged}`;
}
