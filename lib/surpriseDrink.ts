// A pure, controlled "Surprise me" selector for the pub-tied persona lens.
//
// The caller owns the interaction state and increments `anotherIndex` only
// after an explicit "Another" action. This module never reads time, storage,
// account state or randomness. A persona is eligible only when the caller has
// supplied current venue-level availability evidence for that exact order.
// Category hints alone are deliberately insufficient: they can highlight a
// lens, but they cannot prove that a pub serves the named drink.

import { categoryLabel, type AlcoholType, type DrinkCategory } from "@/lib/drinks";
import type { DrinkWeatherVerdict } from "@/lib/drinkWeather";
import {
  drinkCategoryForVerdict,
  loadPersonaDrinks,
  type PersonaDrink,
} from "@/lib/personaDrinks";

export type SurpriseDrinkVenueEvidence = {
  venueId: string;
  venueName: string;
  /** Human-readable upstream/menu source, not a generated availability claim. */
  source: string;
  /** ISO timestamp or date at which this availability evidence was observed. */
  observedAt: string;
};

export type SurpriseDrinkAvailability = {
  /** Must resolve to the shipped, sourced public/canon persona dataset. */
  personaId: string;
  /** Unknown is never treated as zero-proof. */
  alcoholType: AlcoholType;
  /** At least one valid row is required for the persona to be eligible. */
  venues: readonly SurpriseDrinkVenueEvidence[];
};

export type SurpriseDrinkHardExclusions = {
  personaIds?: readonly string[];
  drinkCategories?: readonly DrinkCategory[];
  /** Case-insensitive exact drink names, useful for a direct "never this" ask. */
  drinkNames?: readonly string[];
};

export type SurpriseDrinkInput = {
  /** Stable opaque person/device key. It is used for selection only, never saved. */
  personKey: string;
  /** The person's local calendar date, in YYYY-MM-DD form. */
  dayKey: string;
  /** Controlled counter: zero for the first pick, +1 for each explicit Another. */
  anotherIndex: number;
  /** Confirmed exact-drink availability. Category-only map hints must not enter here. */
  availability: readonly SurpriseDrinkAvailability[];
  weatherVerdict?: DrinkWeatherVerdict | null;
  zeroProof?: boolean;
  hardExclusions?: SurpriseDrinkHardExclusions;
};

export type SurpriseDrinkEmptyReason =
  | "invalid-selection-key"
  | "no-confirmed-availability"
  | "all-hard-excluded"
  | "no-zero-proof-availability";

export type SurpriseDrinkSelection = {
  status: "selected";
  persona: PersonaDrink;
  venues: SurpriseDrinkVenueEvidence[];
  alcoholType: AlcoholType;
  anotherIndex: number;
  rationale: {
    source: string;
    weather: string;
    availability: string;
  };
  /** Preview-only. A consumer must ask before writing a preference or memory. */
  persistence: "requires-explicit-confirmation";
};

export type SurpriseDrinkResult =
  | SurpriseDrinkSelection
  | { status: "empty"; reason: SurpriseDrinkEmptyReason };

type EligibleChoice = {
  persona: PersonaDrink;
  venues: SurpriseDrinkVenueEvidence[];
  alcoholType: AlcoholType;
  fitsWeather: boolean;
  tieBreak: number;
};

const DAY_KEY = /^\d{4}-\d{2}-\d{2}$/;

function cleanToken(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB");
}

function validObservedAt(value: string): boolean {
  return value.trim().length > 0 && Number.isFinite(Date.parse(value));
}

function validDayKey(value: string): boolean {
  if (!DAY_KEY.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function cleanVenueEvidence(
  evidence: readonly SurpriseDrinkVenueEvidence[],
): SurpriseDrinkVenueEvidence[] {
  const byVenue = new Map<string, SurpriseDrinkVenueEvidence>();
  for (const row of evidence) {
    if (!row || typeof row !== "object") continue;
    if (
      typeof row.venueId !== "string" ||
      typeof row.venueName !== "string" ||
      typeof row.source !== "string" ||
      typeof row.observedAt !== "string"
    ) {
      continue;
    }
    const venueId = row.venueId.trim();
    const venueName = row.venueName.trim();
    const source = row.source.trim();
    const observedAt = row.observedAt.trim();
    if (!venueId || !venueName || !source || !validObservedAt(observedAt)) continue;
    if (!byVenue.has(venueId)) {
      byVenue.set(venueId, { venueId, venueName, source, observedAt });
    }
  }
  return [...byVenue.values()].sort((a, b) => a.venueId.localeCompare(b.venueId));
}

// FNV-1a over UTF-16 code units. It is deliberately small and specified here,
// so the same person/day/input yields the same order in every JS runtime.
function stableHash(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function sourceRationale(persona: PersonaDrink): string {
  return persona.kind === "fictional"
    ? `Canon order sourced to ${persona.sourceName}.`
    : `Reported favourite sourced to ${persona.sourceName}.`;
}

function weatherRationale(
  persona: PersonaDrink,
  verdict: DrinkWeatherVerdict | null | undefined,
  weatherCategory: DrinkCategory | null,
): string {
  if (!verdict || !weatherCategory) {
    return "No grounded weather preference was available, so weather did not affect this pick.";
  }
  if (persona.drinkCategory === weatherCategory) {
    return `Fits tonight's weather suggestion: ${verdict.drinkSuggestion}.`;
  }
  return `Tonight's weather points to ${verdict.drinkSuggestion}; this is the next confirmed available choice.`;
}

function availabilityRationale(
  persona: PersonaDrink,
  venues: readonly SurpriseDrinkVenueEvidence[],
): string {
  const category = categoryLabel(persona.drinkCategory).toLocaleLowerCase("en-GB");
  if (venues.length === 1) {
    return `Confirmed at ${venues[0].venueName} from its ${category} drink availability evidence.`;
  }
  return `Confirmed at ${venues.length} pubs from their ${category} drink availability evidence.`;
}

/**
 * Select one sourced persona drink from confirmed pub availability.
 *
 * Ordering is deterministic and independent of input ordering. Weather-fitting
 * choices lead, then the person/day hash provides a stable tie-break. Explicit
 * `anotherIndex` walks that fixed order and wraps without random churn.
 */
export function selectSurpriseDrink(input: SurpriseDrinkInput): SurpriseDrinkResult {
  const personKey = input.personKey.trim();
  const dayKey = input.dayKey.trim();
  if (
    !personKey ||
    !validDayKey(dayKey) ||
    !Number.isSafeInteger(input.anotherIndex) ||
    input.anotherIndex < 0
  ) {
    return { status: "empty", reason: "invalid-selection-key" };
  }

  const personas = loadPersonaDrinks();
  const personaById = new Map(personas.map((persona) => [persona.id, persona]));
  const availabilityByPersona = new Map<
    string,
    { venues: SurpriseDrinkVenueEvidence[]; alcoholType: AlcoholType }
  >();

  for (const available of input.availability) {
    if (
      !available ||
      typeof available.personaId !== "string" ||
      !["alcoholic", "low-no", "unknown"].includes(available.alcoholType) ||
      !Array.isArray(available.venues) ||
      !personaById.has(available.personaId) ||
      availabilityByPersona.has(available.personaId)
    ) {
      continue;
    }
    const venues = cleanVenueEvidence(available.venues);
    if (venues.length === 0) continue;
    availabilityByPersona.set(available.personaId, {
      venues,
      alcoholType: available.alcoholType,
    });
  }

  if (availabilityByPersona.size === 0) {
    return { status: "empty", reason: "no-confirmed-availability" };
  }

  const excludedPersonaIds = new Set(
    (input.hardExclusions?.personaIds ?? []).map(cleanToken),
  );
  const excludedCategories = new Set(input.hardExclusions?.drinkCategories ?? []);
  const excludedDrinkNames = new Set(
    (input.hardExclusions?.drinkNames ?? []).map(cleanToken),
  );

  const notHardExcluded = personas.filter((persona) => {
    if (!availabilityByPersona.has(persona.id)) return false;
    if (excludedPersonaIds.has(cleanToken(persona.id))) return false;
    if (excludedCategories.has(persona.drinkCategory)) return false;
    return !excludedDrinkNames.has(cleanToken(persona.drink));
  });

  if (notHardExcluded.length === 0) {
    return { status: "empty", reason: "all-hard-excluded" };
  }

  const zeroProofEligible = input.zeroProof
    ? notHardExcluded.filter(
        (persona) => availabilityByPersona.get(persona.id)?.alcoholType === "low-no",
      )
    : notHardExcluded;
  if (zeroProofEligible.length === 0) {
    return { status: "empty", reason: "no-zero-proof-availability" };
  }

  const weatherCategory = drinkCategoryForVerdict(input.weatherVerdict);
  const seed = `${personKey}\u0000${dayKey}`;
  const ordered: EligibleChoice[] = zeroProofEligible
    .map((persona) => {
      const available = availabilityByPersona.get(persona.id)!;
      return {
        persona,
        venues: available.venues,
        alcoholType: available.alcoholType,
        fitsWeather: persona.drinkCategory === weatherCategory,
        tieBreak: stableHash(`${seed}\u0000${persona.id}`),
      };
    })
    .sort((a, b) => {
      if (a.fitsWeather !== b.fitsWeather) return a.fitsWeather ? -1 : 1;
      return a.tieBreak - b.tieBreak || a.persona.id.localeCompare(b.persona.id);
    });

  const choice = ordered[input.anotherIndex % ordered.length];
  return {
    status: "selected",
    persona: choice.persona,
    venues: choice.venues,
    alcoholType: choice.alcoholType,
    anotherIndex: input.anotherIndex,
    rationale: {
      source: sourceRationale(choice.persona),
      weather: weatherRationale(choice.persona, input.weatherVerdict, weatherCategory),
      availability: availabilityRationale(choice.persona, choice.venues),
    },
    persistence: "requires-explicit-confirmation",
  };
}
