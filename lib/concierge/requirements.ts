// Hard venue requirements: what a discovery ask names that a pub must have on
// record to be offered. A mood is a preference and only moves the ranking. A
// requirement filters, and a pub with no record of it is left out rather than
// guessed in.
//
// Evidence rules:
//   - A beer garden needs the dated garden fact. `amenities.beerGarden` also
//     carries pavement seating and undated flags, so it never answers alone.
//   - Outdoor seating accepts a dated garden or a dated outdoor-seating fact.
//   - A drink needs its name in the pub's own priced drink names. Drink
//     categories are not evidence, because the builder can assign one by hash.

import placeNames from "@/lib/ask/placeNames.generated.json";
import { wordsOnly } from "@/lib/ask/placePhrases";
import { BEERS } from "@/lib/beers";
import type { ConciergeVenue, DatedVenueFact } from "@/lib/concierge/rank";
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

export type VenueRequirement =
  | { kind: "garden" | "outdoor-seating" | "darts" | "pool" | "dogs" }
  | { kind: "drink"; label: string; match: DrinkMatch };

type DrinkMatch =
  | { by: "brand"; brand: DrinkBrand }
  | { by: "subtype"; subtype: DrinkSubtype }
  | { by: "category"; category: DrinkCategory };

const FEATURE_TERMS: ReadonlyArray<readonly [Exclude<VenueRequirement["kind"], "drink">, RegExp]> = [
  ["garden", /\b(?:beer )?gardens?\b/],
  ["outdoor-seating", /\boutdoors?\b|\bal fresco\b|\bterraces?\b|\b(?:sit|sitting|seats?|seating|drinks?|drinking|tables?|space)\s+outside\b/],
  ["darts", /\bdarts? ?boards?\b|\b(?:play|playing|with|has|have|got)\s+(?:a\s+)?darts\b/],
  ["pool", /\bpool tables?\b|\b(?:play|playing|shoot|shooting)\s+pool\b|\bwith\s+(?:a\s+)?pool\b/],
  ["dogs", /\bdog friendly\b|\bdogs? (?:allowed|welcome)\b|\b(?:bring|with)\s+(?:my|our|the|a)\s+dogs?\b/],
];

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

/** Takes the first needle found, so a brand's words cannot also count as a style. */
function takeNeedle(padded: string, needles: readonly string[]): string | null {
  const hit = needles.find((needle) => needle && padded.includes(` ${needle} `));
  return hit ? withoutPhrase(padded, hit) : null;
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
    const rest = takeNeedle(padded, brandMatchNeedles(brand).filter((needle) => !places.has(needle)));
    if (rest === null) continue;
    padded = rest;
    found.push({ kind: "drink", label: brand.label, match: { by: "brand", brand } });
  }
  padded = withoutPlaces(padded);
  for (const subtype of DRINK_SUBTYPES) {
    if (subtype.category !== "beer") continue;
    const rest = takeNeedle(padded, subtype.tokens.map(normalizeDrinkHaystack).filter((token) => !AMBIGUOUS_STYLE_TOKENS.has(token)));
    if (rest === null) continue;
    padded = rest;
    found.push({ kind: "drink", label: subtype.longLabel === "IPA" ? "IPA" : subtype.longLabel.toLowerCase(), match: { by: "subtype", subtype } });
  }
  for (const [category, label] of DRINK_CATEGORY_LABELS) {
    if (category === "alcohol-free" ? /\b(?:non alcoholic|alcohol free|low alcohol|zero alcohol)\b/.test(padded) : haystackMatchesCategory(padded, category)) {
      found.push({ kind: "drink", label, match: { by: "category", category } });
    }
  }
  return { found, rest: padded };
}

/** Hard requirements the ask names, in a stable order. Moods and budgets are not here. */
export function venueRequirementsInText(text: string): VenueRequirement[] {
  const drinks = drinkRequirements(text);
  const features = FEATURE_TERMS.filter(([, pattern]) => pattern.test(drinks.rest)).map(([kind]) => kind);
  const outdoorCoveredByGarden = features.includes("garden");
  return [
    ...features
      .filter((kind) => !(kind === "outdoor-seating" && outdoorCoveredByGarden))
      .map((kind) => ({ kind })),
    ...drinks.found,
  ];
}

/** The same ask with a garden relaxed to outdoor seating, for the scarcity line only. */
export function outdoorSeatingInstead(requirements: readonly VenueRequirement[]): VenueRequirement[] | null {
  if (!requirements.some((requirement) => requirement.kind === "garden")) return null;
  return requirements.map((requirement) => requirement.kind === "garden" ? { kind: "outdoor-seating" } : requirement);
}

function datedLine(label: string, fact: DatedVenueFact): string {
  return `${label} on record (${fact.source}, ${formatObservedDate(new Date(`${fact.observedAt}T12:00:00Z`))})`;
}

function drinkOnRecord(venue: ConciergeVenue, match: DrinkMatch): boolean {
  const names = (venue.drinkText ?? "").split(";").map((name) => name.trim()).filter(Boolean);
  if (match.by === "category" && match.category === "alcohol-free" && venue.amenities.nonAlcoholic === true) return true;
  return names.some((name) => match.by === "brand"
    ? haystackMatchesBrand(name, match.brand)
    : match.by === "subtype"
      ? haystackMatchesSubtype(name, match.subtype) || haystackMatchesSubtypeBrand(name, match.subtype)
      : haystackMatchesCategory(name, match.category));
}

/** The line that proves a pub meets one requirement, or null when it has no record of it. */
export function requirementEvidence(venue: ConciergeVenue, requirement: VenueRequirement): string | null {
  const facts = venue.features ?? {};
  switch (requirement.kind) {
    case "garden":
      return facts.garden ? datedLine("Beer garden", facts.garden) : null;
    case "outdoor-seating":
      return facts.garden
        ? datedLine("Beer garden", facts.garden)
        : facts.outdoorSeating ? datedLine("Outdoor seating", facts.outdoorSeating) : null;
    case "darts":
      return venue.amenities.darts === true ? "Darts on record" : null;
    case "pool":
      return venue.amenities.pool === true ? "Pool table on record" : null;
    case "dogs":
      return facts.dogsWelcome ? datedLine("Dogs welcome", facts.dogsWelcome) : null;
    case "drink":
      return drinkOnRecord(venue, requirement.match) ? `${requirement.label} on its listed drinks` : null;
  }
}

export function requirementLabel(requirement: VenueRequirement): string {
  switch (requirement.kind) {
    case "garden": return "a beer garden";
    case "outdoor-seating": return "outdoor seating";
    case "darts": return "darts";
    case "pool": return "a pool table";
    case "dogs": return "dogs welcome";
    case "drink": return requirement.label;
  }
}

/** The scarcity line when fewer pubs meet the requirements than were asked for. */
export function requirementScarcityLine(input: {
  requirements: readonly VenueRequirement[];
  found: number;
  area?: string;
  /** More pubs would qualify with outdoor seating in place of a garden. */
  outdoorSeatingOnly?: boolean;
}): string {
  const labels = input.requirements.map(requirementLabel);
  const named = labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : labels[0] ?? "";
  const area = input.area?.trim();
  const where = area && area.toLocaleLowerCase("en-GB") !== "london" ? ` in ${area}` : "";
  const line = input.found === 0
    ? `No listed pub${where} has ${named} on record, so I won't guess.`
    : `Only ${input.found} listed ${input.found === 1 ? "pub" : "pubs"}${where} ${input.found === 1 ? "has" : "have"} ${named} on record.`;
  return input.outdoorSeatingOnly
    ? `${line} More have outdoor seating on record but no garden. Ask to sit outside to see them.`
    : line;
}
