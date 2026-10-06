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
  "for", "tonight", "today", "now", "with", "that", "which", "or", "please",
  "under", "over", "after", "before", "on", "at", "near", "around",
]);

/**
 * The place a query names after "in", "near", "around" or "by" when it is
 * written as a proper noun ("Blackfriars", "Elephant and Castle"). The taxonomy
 * knows only the night patches and boroughs, so this lets the answer say it
 * could not place a name rather than claim none was given. Lower-case phrases
 * are never taken: "in the cheapest" is not a place.
 */
function namedPlaceFromQuery(query: string): string | null {
  const match = query.match(
    /\b(?:in|near|around|by|close to)\s+(?:the\s+)?([A-Z][\p{L}'’-]*(?:\s+(?:and\s+|of\s+|the\s+)?[A-Z][\p{L}'’-]*){0,2})/u,
  );
  if (!match?.[1]) return null;
  const words = match[1].split(/\s+/);
  const kept: string[] = [];
  for (const word of words) {
    if (PLACE_PHRASE_STOP.has(word.toLowerCase())) break;
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
  const fromRemembered = areaFromRemembered(remembered);
  if (fromRemembered) {
    return { scope: "remembered", area: fromRemembered, label: labelFor(fromRemembered), grounded: true };
  }
  const unplaced = namedPlaceFromQuery(query);
  return {
    scope: "london-wide",
    area: null,
    label: "London",
    grounded: false,
    ...(unplaced ? { unplaced } : {}),
  };
}

/** House-voice locality line. Grounded answers name the area; London-wide is explicit. */
export function palLocalityLine(locality: PalLocality): string {
  if (locality.grounded) {
    return locality.scope === "query"
      ? `Grounded in ${locality.label}, the area you named.`
      : `Grounded around ${locality.label}, your remembered area.`;
  }
  if (locality.unplaced) {
    return `Across London. We could not place \u201c${locality.unplaced}\u201d, so these are not ranked by distance.`;
  }
  return "Across London. No area set, so these are not ranked by distance.";
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
