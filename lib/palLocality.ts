// Pub Pal locality grounding (Trusted Handoff L16). Pure, node-testable: decides
// WHERE a Pal answer is grounded from the real gazetteer/night-area taxonomy —
// never inventing a locality and never describing a London-wide answer as local.
//
// Precedence (contract §L16): an area named in the query beats the remembered
// area; a remembered area fills in when the query names none; with no context at
// all the honest answer is London-wide, explicitly NOT ranked by distance.

import { LONDON_BOROUGHS } from "@/lib/boroughs";
import { normalizeSearchText } from "@/lib/textSlug";
import {
  NIGHT_PATCHES,
  resolveNightPatch,
  type NightPatchId,
  type RememberedArea,
} from "@/lib/nightPatches";
import type { PlanningIntentArea } from "@/lib/planningIntent";

type PalLocalityScope = "query" | "remembered" | "london-wide";

export type PalLocality = {
  scope: PalLocalityScope;
  /** The canonical acceptance area, ready for the "pal" PlanningIntent. Null = London-wide. */
  area: PlanningIntentArea;
  /** Human label for copy ("Brixton", "Soho", "London"). */
  label: string;
  /** True only when a real area was resolved; false = London-wide, distance-unranked. */
  grounded: boolean;
  /**
   * A place the query named that the taxonomy cannot place ("Blackfriars").
   * Only ever set on a London-wide answer, so the line can say it could not
   * place the name instead of claiming that no area was given.
   */
  unplaced?: string;
  /** The reader asked for London itself ("in London"), so London-wide is their answer, not a gap. */
  askedLondon?: boolean;
};

/** Honest "no distance evidence" marker — never replaced with a fabricated number. */
export const PAL_DISTANCE_UNKNOWN = "Distance not sourced";

function mentions(haystack: string, needle: string): boolean {
  const token = normalizeSearchText(needle);
  if (!token) return false;
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`).test(haystack);
}

/** First gazetteer area named in the query, night patches (nightlife order) before boroughs. */
function areaFromQuery(query: string): PlanningIntentArea {
  const text = normalizeSearchText(query);
  if (!text) return null;
  for (const patch of NIGHT_PATCHES) {
    if (mentions(text, patch.label) || mentions(text, patch.id)) {
      return { kind: "night-patch", id: patch.id as NightPatchId };
    }
  }
  for (const borough of LONDON_BOROUGHS) {
    if (mentions(text, borough)) return { kind: "borough", name: borough };
  }
  return null;
}

/** Words that end a place name in "pubs in Blackfriars for a quiet pint". */
const PLACE_PHRASE_STOP = new Set([
  "for", "now", "with", "that", "which", "or", "please",
  "under", "over", "after", "before", "on", "at", "near", "around",
]);

/**
 * Months, weekdays, holidays and times of day. Each one ends a place name the
 * way PLACE_PHRASE_STOP does: "in December" names no place, and "near
 * Blackfriars Friday night" names Blackfriars.
 */
const TIME_WORDS = new Set([
  "january", "february", "march", "april", "may", "june", "july", "august",
  "september", "october", "november", "december",
  "monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday",
  "christmas", "xmas", "easter", "halloween", "valentine", "year", "eve", "day",
  "night", "weekend", "tonight", "today", "tomorrow", "morning", "afternoon",
  "evening", "midnight", "nye",
]);

/** Holidays whose first word is no time word on its own: "New Year", not "New Cross". */
const HOLIDAY_PHRASES = new Set(["new year", "boxing day", "bonfire night"]);

/** The word as the time lists spell it: "Year's", "Years" and "Fridays" stem to "year" and "friday". */
function timeStem(word: string): string {
  const stem = word.toLowerCase().replace(/['’]s$/, "");
  const singular = stem.replace(/s$/, "");
  return TIME_WORDS.has(singular) ? singular : stem;
}

/** "London", "Central London", "East London": the whole city, which is London-wide, not a place. */
const LONDON_SCOPE = /^(?:(?:central|north|south|east|west|greater)\s+)?london$/;

/**
 * Every place a query names after "in", "near", "around" or "close to" when it
 * is written as a proper noun ("Blackfriars", "Elephant and Castle"), in order.
 * The taxonomy knows only the night patches and boroughs, so this lets the
 * answer say it could not place a name rather than claim none was given.
 * Lower-case phrases are never taken: "in the cheapest" is not a place. A
 * phrase that names only a time ("in December") names nothing.
 */
function namedPlacesFromQuery(query: string): string[] {
  const names: string[] = [];
  for (const match of query.matchAll(
    /\b(?:in|near|around|close to)\s+(?:the\s+)?([A-Z][\p{L}'’-]*(?:\s+(?:and\s+|of\s+|the\s+)?[A-Z][\p{L}'’-]*){0,2})/gu,
  )) {
    const name = match[1] ? placeBeforeTime(match[1]) : null;
    if (name) names.push(name);
  }
  return names;
}

/** The capitalised words of a phrase up to its first stop, time or holiday word. */
function placeBeforeTime(phrase: string): string | null {
  const words = phrase.split(/\s+/);
  const kept: string[] = [];
  for (const [index, word] of words.entries()) {
    const stem = timeStem(word);
    const next = words[index + 1];
    if (
      PLACE_PHRASE_STOP.has(stem) ||
      TIME_WORDS.has(stem) ||
      (next !== undefined && HOLIDAY_PHRASES.has(`${stem} ${timeStem(next)}`))
    ) {
      break;
    }
    kept.push(word);
  }
  const name = kept.join(" ").trim();
  return name.length >= 3 ? name : null;
}

/** Map the remembered-area store shape onto a canonical acceptance area. */
function areaFromRemembered(remembered: RememberedArea | null): PlanningIntentArea {
  if (!remembered) return null;
  if (remembered.kind === "borough") {
    return LONDON_BOROUGHS.includes(remembered.name)
      ? { kind: "borough", name: remembered.name }
      : null;
  }
  return NIGHT_PATCHES.some((patch) => patch.id === remembered.id)
    ? { kind: "night-patch", id: remembered.id as NightPatchId }
    : null;
}

function labelFor(area: PlanningIntentArea): string {
  if (area === null) return "London";
  if (area.kind === "borough") return area.name;
  return resolveNightPatch(area.id)?.label ?? area.id;
}

/**
 * Resolve where a Pal answer is grounded. Explicit query area wins; else the
 * remembered area; else an honest London-wide scope that must never be shown as
 * a local, distance-ranked result.
 */
export function resolvePalLocality(
  query: string,
  remembered: RememberedArea | null,
): PalLocality {
  const fromQuery = areaFromQuery(query);
  if (fromQuery) {
    return { scope: "query", area: fromQuery, label: labelFor(fromQuery), grounded: true };
  }
  // A place the reader named that the taxonomy cannot place beats the remembered
  // area: grounding "pubs in Blackfriars" in a remembered Soho would hand the
  // planner a stale area for the pub they chose. "In London" beats it too, but
  // is the London-wide answer the reader asked for, not a place we missed.
  const named = namedPlacesFromQuery(query);
  const unplaced = named.find((name) => !LONDON_SCOPE.test(normalizeSearchText(name)));
  const fromRemembered = named.length > 0 ? null : areaFromRemembered(remembered);
  if (fromRemembered) {
    return { scope: "remembered", area: fromRemembered, label: labelFor(fromRemembered), grounded: true };
  }
  return {
    scope: "london-wide",
    area: null,
    label: "London",
    grounded: false,
    ...(unplaced ? { unplaced } : named.length > 0 ? { askedLondon: true } : {}),
  };
}

/** House-voice locality line. Grounded answers name the area; London-wide is explicit. */
export function palLocalityLine(locality: PalLocality): string {
  if (locality.grounded) {
    return locality.scope === "query"
      ? `In ${locality.label}, the area you named.`
      : `Around ${locality.label}, the area you last picked.`;
  }
  if (locality.unplaced) {
    return `Across London. We couldn't place "${locality.unplaced}", so these aren't ranked by distance.`;
  }
  if (locality.askedLondon) {
    return "Across London, as you asked, not ranked by distance.";
  }
  return "Across London. No area set, so these aren't ranked by distance.";
}

/**
 * Honest walk label: a real minute count, or null so the card omits distance
 * rather than inventing one. Callers show PAL_DISTANCE_UNKNOWN when they must
 * state the absence explicitly.
 */
export function palWalkLabel(walkMinutes: number | null | undefined): string | null {
  return typeof walkMinutes === "number" && Number.isFinite(walkMinutes) && walkMinutes >= 0
    ? `about ${Math.round(walkMinutes)} min on foot`
    : null;
}
