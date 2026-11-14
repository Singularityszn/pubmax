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
import { canonicalOutVenueId } from "@/lib/out/venueId";
import { positiveFeatureObservation, type VenueFeature, type VenueFeatureObservation } from "@/lib/venueFeatureEvidence";
import type { WhatsOnRow } from "@/lib/whatsOn";

export type VenueRequirement =
  | { kind: "garden" | "outdoor-seating" | "darts" | "pool" | "dogs" | "quiz" }
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
  ["quiz", /\bquiz(?:zes)?\b|\btrivia\b/],
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

export type QuizListing = { source: string; observedAt: string };

export type RequirementContext = {
  now: number;
  quizListings: ReadonlyMap<string, QuizListing> | null;
};

export type RequirementProof = { requirement: string; source: string | null; observedAt: string | null };

export function requirementKey(requirement: VenueRequirement): string {
  return requirement.kind === "drink" ? `drink:${requirement.label}` : requirement.kind;
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

export function requirementCoverageGaps(requirements: readonly VenueRequirement[], context: RequirementContext): string[] {
  return requirements.some((requirement) => requirement.kind === "quiz") && context.quizListings === null ? ["quiz"] : [];
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

function drinkOnRecord(venue: ConciergeVenue, match: DrinkMatch): boolean {
  const names = (venue.drinkText ?? "").split(";").map((name) => name.trim()).filter(Boolean);
  if (match.by === "category" && match.category === "alcohol-free" && venue.amenities.nonAlcoholic === true) return true;
  return names.some((name) => match.by === "brand"
    ? haystackMatchesBrand(name, match.brand)
    : match.by === "subtype"
      ? haystackMatchesSubtype(name, match.subtype) || haystackMatchesSubtypeBrand(name, match.subtype)
      : haystackMatchesCategory(name, match.category));
}

/** What proves a pub meets one requirement, or null when it has no accepted record of it. */
export function requirementProof(
  venue: ConciergeVenue,
  requirement: VenueRequirement,
  context: RequirementContext,
): RequirementProof | null {
  const facts = venue.features ?? {};
  const key = requirementKey(requirement);
  const unsourced: RequirementProof = { requirement: key, source: null, observedAt: null };
  switch (requirement.kind) {
    case "garden":
      return observedFeature(key, facts.garden, "beerGarden", context.now);
    case "outdoor-seating":
      return observedFeature(key, facts.garden, "beerGarden", context.now)
        ?? observedFeature(key, facts.outdoorSeating, "outdoorSeating", context.now);
    case "darts":
      return venue.amenities.darts === true ? unsourced : null;
    case "pool":
      return venue.amenities.pool === true ? unsourced : null;
    case "dogs":
      return observedFeature(key, facts.dogsWelcome, "dogsWelcome", context.now);
    case "quiz": {
      const listing = context.quizListings?.get(venue.id);
      return listing ? { requirement: key, source: listing.source, observedAt: listing.observedAt } : null;
    }
    case "drink":
      return drinkOnRecord(venue, requirement.match) ? unsourced : null;
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

function observedDay(observedAt: string): string {
  return formatObservedDate(new Date(/^\d{4}-\d{2}-\d{2}$/.test(observedAt) ? `${observedAt}T12:00:00Z` : observedAt));
}

export function requirementProofLine(
  venue: ConciergeVenue,
  requirement: VenueRequirement,
  proof: RequirementProof,
  now: number,
): string {
  const dated = proof.source && proof.observedAt ? ` (${proof.source}, ${observedDay(proof.observedAt)})` : "";
  const fromGarden = observedFeature(proof.requirement, venue.features?.garden, "beerGarden", now) !== null;
  switch (requirement.kind) {
    case "garden":
      return `Beer garden on record${dated}`;
    case "outdoor-seating":
      return `${fromGarden ? "Beer garden" : "Outdoor seating"} on record${dated}`;
    case "darts":
      return "Darts on record";
    case "pool":
      return "Pool table on record";
    case "dogs":
      return `Dogs welcome on record${dated}`;
    case "quiz":
      return `Quiz listed${dated}`;
    case "drink":
      return `${requirement.label} on its listed drinks`;
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

function listed(labels: readonly string[]): string {
  return labels.length > 1 ? `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}` : labels[0] ?? "";
}

/** The line when fewer pubs meet the requirements than were asked for, or some could not be checked. */
export function requirementScarcityLine(input: {
  requirements: readonly VenueRequirement[];
  found: number;
  area?: string;
  coverageGaps?: readonly string[];
  /** More pubs would qualify with outdoor seating in place of a garden. */
  outdoorSeatingOnly?: boolean;
}): string {
  const gaps = input.requirements.filter((requirement) => input.coverageGaps?.includes(requirementKey(requirement)));
  if (gaps.length) {
    return `I can't check the listings for ${listed(gaps.map(requirementLabel))} right now, so I won't name a pub for it.`;
  }
  const named = listed(input.requirements.map(requirementLabel));
  const area = input.area?.trim();
  const where = area && area.toLocaleLowerCase("en-GB") !== "london" ? ` in ${area}` : "";
  const line = input.found === 0
    ? `No listed pub${where} has ${named} on record, so I won't guess.`
    : `Only ${input.found} listed ${input.found === 1 ? "pub" : "pubs"}${where} ${input.found === 1 ? "has" : "have"} ${named} on record.`;
  return input.outdoorSeatingOnly
    ? `${line} More have outdoor seating on record but no garden. Ask to sit outside to see them.`
    : line;
}
