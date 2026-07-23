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
import { londonDayKey } from "@/lib/pintContributions";

export type SurpriseDrinkVenueEvidence = {
  venueId: string;
  venueName: string;
  /** Menu item observed at this venue. It must match the persona's exact order. */
  drinkName: string;
  /** Observed listed price for the exact drink, in pounds. */
  priceGbp: number;
  /** Human-readable upstream/menu source, not a generated availability claim. */
  source: string;
  /** ISO instant with `Z` or a numeric offset when this evidence was observed. */
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
  /** Explicit selection instant. Evidence may not be newer than this value. */
  asOfIso: string;
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
const EXPLICIT_ISO_INSTANT = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-](\d{2}):(\d{2}))$/i;
const MAX_EVIDENCE_AGE_MS = 90 * 24 * 60 * 60 * 1_000;

function cleanToken(value: string): string {
  return value.trim().toLocaleLowerCase("en-GB");
}

function stableTextCompare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function parseExplicitIsoInstant(value: string): number | null {
  const clean = value.trim();
  const match = clean.match(EXPLICIT_ISO_INSTANT);
  if (!match) return null;
  const [, year, month, day, hour, minute, second, , zone, offsetHour, offsetMinute] = match;
  if (
    !validDayKey(`${year}-${month}-${day}`)
    || Number(hour) > 23
    || Number(minute) > 59
    || Number(second) > 59
    || (zone.toUpperCase() !== "Z" && (Number(offsetHour) > 23 || Number(offsetMinute) > 59))
  ) return null;
  const parsed = Date.parse(clean);
  return Number.isFinite(parsed) ? parsed : null;
}

function validObservedAt(value: string, asOfMs: number): boolean {
  const observedAt = parseExplicitIsoInstant(value);
  return (
    observedAt !== null
    && observedAt <= asOfMs
    && observedAt >= asOfMs - MAX_EVIDENCE_AGE_MS
  );
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
  asOfMs: number,
  expectedDrinkName: string,
): SurpriseDrinkVenueEvidence[] {
  const candidates: SurpriseDrinkVenueEvidence[] = [];
  for (const row of evidence) {
    if (!row || typeof row !== "object") continue;
    if (
      typeof row.venueId !== "string" ||
      typeof row.venueName !== "string" ||
      typeof row.drinkName !== "string" ||
      typeof row.priceGbp !== "number" ||
      typeof row.source !== "string" ||
      typeof row.observedAt !== "string"
    ) {
      continue;
    }
    const venueId = row.venueId.trim();
    const venueName = row.venueName.trim();
    const drinkName = row.drinkName.trim();
    const source = row.source.trim();
    const observedAt = row.observedAt.trim();
    if (
      !venueId ||
      !venueName ||
      cleanToken(drinkName.normalize("NFKC")) !== cleanToken(expectedDrinkName.normalize("NFKC")) ||
      !source ||
      !Number.isFinite(row.priceGbp) ||
      row.priceGbp <= 0 ||
      row.priceGbp > 500 ||
      !validObservedAt(observedAt, asOfMs)
    ) continue;
    candidates.push({
      venueId,
      venueName,
      drinkName: expectedDrinkName,
      priceGbp: row.priceGbp,
      source,
      observedAt: new Date(Date.parse(observedAt)).toISOString(),
    });
  }

  candidates.sort((a, b) =>
    stableTextCompare(a.venueId, b.venueId)
    || Date.parse(b.observedAt) - Date.parse(a.observedAt)
    || stableTextCompare(a.source, b.source)
    || stableTextCompare(a.venueName, b.venueName));
  const byVenue = new Map<string, SurpriseDrinkVenueEvidence>();
  const conflictedVenueIds = new Set<string>();
  for (const row of candidates) {
    if (conflictedVenueIds.has(row.venueId)) continue;
    const current = byVenue.get(row.venueId);
    if (!current) {
      byVenue.set(row.venueId, row);
      continue;
    }
    if (Date.parse(current.observedAt) === Date.parse(row.observedAt) && current.priceGbp !== row.priceGbp) {
      byVenue.delete(row.venueId);
      conflictedVenueIds.add(row.venueId);
    }
  }
  return [...byVenue.values()];
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
    ? `As ordered in ${persona.knownFor}. Source: ${persona.sourceName}.`
    : `Reported favourite. Source: ${persona.sourceName}.`;
}

function weatherRationale(
  persona: PersonaDrink,
  verdict: DrinkWeatherVerdict | null | undefined,
  weatherCategory: DrinkCategory | null,
): string {
  if (!verdict || !weatherCategory) {
    return "No weather suggestion was available, so weather did not affect this pick.";
  }
  if (persona.drinkCategory === weatherCategory) {
    return `Fits tonight's weather suggestion: ${verdict.drinkSuggestion}.`;
  }
  return `Tonight's weather points to ${verdict.drinkSuggestion}; this menu-listed choice is next.`;
}

const EVIDENCE_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

function evidenceDateLabel(value: string): string {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value ?? "0");
  return `${part("day")} ${EVIDENCE_MONTHS[part("month") - 1]} ${part("year")}`;
}

function availabilityRationale(
  persona: PersonaDrink,
  venues: readonly SurpriseDrinkVenueEvidence[],
): string {
  const category = categoryLabel(persona.drinkCategory).toLocaleLowerCase("en-GB");
  if (venues.length === 1) {
    return `Listed at ${venues[0].venueName} for £${venues[0].priceGbp.toFixed(2)} (${category}), checked ${evidenceDateLabel(venues[0].observedAt)}.`;
  }
  const prices = venues.map((venue) => venue.priceGbp);
  const latest = venues.reduce((best, venue) =>
    Date.parse(venue.observedAt) > Date.parse(best.observedAt) ? venue : best);
  return `Listed at ${venues.length} pubs from £${Math.min(...prices).toFixed(2)} (${category}); latest check ${evidenceDateLabel(latest.observedAt)}.`;
}

/**
 * Select one sourced persona drink from confirmed pub availability.
 *
 * Ordering is deterministic and independent of input ordering. Weather-fitting
 * choices lead, then the person/day hash provides a stable tie-break. Explicit
 * `anotherIndex` walks that fixed order and wraps without random churn.
 */
export function selectSurpriseDrink(input: SurpriseDrinkInput): SurpriseDrinkResult {
  if (
    !input
    || typeof input.personKey !== "string"
    || typeof input.dayKey !== "string"
    || typeof input.asOfIso !== "string"
  ) {
    return { status: "empty", reason: "invalid-selection-key" };
  }
  const personKey = input.personKey.trim();
  const dayKey = input.dayKey.trim();
  const asOfMs = parseExplicitIsoInstant(input.asOfIso);
  if (
    !personKey ||
    !validDayKey(dayKey) ||
    asOfMs === null ||
    londonDayKey(new Date(asOfMs)) !== dayKey ||
    !Number.isSafeInteger(input.anotherIndex) ||
    input.anotherIndex < 0
  ) {
    return { status: "empty", reason: "invalid-selection-key" };
  }

  const personas = loadPersonaDrinks();
  const personaById = new Map(personas.map((persona) => [persona.id, persona]));
  const availabilityRowsByPersona = new Map<
    string,
    { venues: SurpriseDrinkVenueEvidence[]; alcoholTypes: AlcoholType[] }
  >();

  for (const available of input.availability) {
    if (
      !available ||
      typeof available.personaId !== "string" ||
      !["alcoholic", "low-no", "unknown"].includes(available.alcoholType) ||
      !Array.isArray(available.venues) ||
      !personaById.has(available.personaId)
    ) {
      continue;
    }
    const persona = personaById.get(available.personaId)!;
    const venues = cleanVenueEvidence(available.venues, asOfMs, persona.drink);
    if (venues.length === 0) continue;
    const current = availabilityRowsByPersona.get(available.personaId) ?? {
      venues: [],
      alcoholTypes: [],
    };
    current.venues.push(...venues);
    current.alcoholTypes.push(available.alcoholType);
    availabilityRowsByPersona.set(available.personaId, current);
  }

  const availabilityByPersona = new Map<
    string,
    { venues: SurpriseDrinkVenueEvidence[]; alcoholType: AlcoholType }
  >();
  for (const [personaId, available] of availabilityRowsByPersona) {
    const persona = personaById.get(personaId)!;
    const venues = cleanVenueEvidence(available.venues, asOfMs, persona.drink);
    if (venues.length === 0) continue;
    const alcoholTypes = new Set(available.alcoholTypes);
    availabilityByPersona.set(personaId, {
      venues,
      alcoholType: alcoholTypes.size === 1 ? available.alcoholTypes[0] : "unknown",
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
      return a.tieBreak - b.tieBreak || stableTextCompare(a.persona.id, b.persona.id);
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
