// Dog policy and opening hours a pub's own website states, as the venue detail
// carries them. The harvest that writes them is
// scripts/harvest/pub-website-amenities/hours-and-dogs.mjs. Each fact keeps
// the page it came from, the day it was read and the passage that states it,
// and absent is unknown.

import type { OpeningWindow, WeeklyOpeningHours } from "@/lib/busyness";
import { DAY_MS } from "@/lib/dayMs";
import { OPENING_EVIDENCE_FRESH_DAYS } from "@/lib/planRouteEvidence";
import type { Venue } from "@/lib/venues";

type VenueSiteDogs = { policy: "welcome" | "not-allowed"; evidence: string };
type VenueSiteHours = { hours: WeeklyOpeningHours; statedDays: number[]; evidence: string };

export type VenueSiteFacts = {
  sourceUrl: string;
  /** The day the page was read, YYYY-MM-DD. */
  readOn: string;
  dogs?: VenueSiteDogs;
  hours?: VenueSiteHours;
};

const CLOCK = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const READ_ON = /^\d{4}-\d{2}-\d{2}$/;

function asWindow(value: unknown): OpeningWindow | null {
  const window = value as Partial<OpeningWindow> | null;
  return window && typeof window.opens === "string" && typeof window.closes === "string" &&
    CLOCK.test(window.opens) && CLOCK.test(window.closes) ? { opens: window.opens, closes: window.closes } : null;
}

function asHours(value: unknown): VenueSiteHours | null {
  const record = value as Partial<VenueSiteHours> | null;
  if (!record || typeof record.evidence !== "string" || !record.hours || typeof record.hours !== "object") return null;
  const hours: WeeklyOpeningHours = {};
  for (const [day, windows] of Object.entries(record.hours)) {
    const index = Number(day);
    if (!Number.isInteger(index) || index < 0 || index > 6 || !Array.isArray(windows)) return null;
    const parsed = windows.map(asWindow);
    if (parsed.some((window) => window === null)) return null;
    hours[index] = parsed as OpeningWindow[];
  }
  const statedDays = Object.keys(hours).map(Number).sort((a, b) => a - b);
  return statedDays.length ? { hours, statedDays, evidence: record.evidence } : null;
}

function asDogs(value: unknown): VenueSiteDogs | null {
  const record = value as Partial<VenueSiteDogs> | null;
  return record && (record.policy === "welcome" || record.policy === "not-allowed") && typeof record.evidence === "string"
    ? { policy: record.policy, evidence: record.evidence }
    : null;
}

/** One harvested row as the venue carries it, or null when the row is malformed or states nothing. */
export function venueSiteFactsFromRow(row: unknown): VenueSiteFacts | null {
  const record = row as Record<string, unknown> | null;
  if (!record || typeof record.sourceUrl !== "string" || !/^https?:\/\//.test(record.sourceUrl)) return null;
  if (typeof record.readOn !== "string" || !READ_ON.test(record.readOn)) return null;
  const dogs = asDogs(record.dogs);
  const hours = asHours(record.hours);
  if (!dogs && !hours) return null;
  return { sourceUrl: record.sourceUrl, readOn: record.readOn, ...(dogs ? { dogs } : {}), ...(hours ? { hours } : {}) };
}

/**
 * The venue with what its own site states. The site's hours decide open state
 * only while the read is as fresh as the opening-evidence rule allows, and
 * only when nothing else has set the venue's hours; Google Places hours,
 * applied after this, replace them when they are fresh.
 */
export function applyVenueSiteFacts(venue: Venue, facts: VenueSiteFacts | null | undefined, now = new Date()): Venue {
  if (!facts) return venue;
  const age = now.getTime() - Date.parse(`${facts.readOn}T00:00:00Z`);
  const fresh = Number.isFinite(age) && age >= -DAY_MS && age <= OPENING_EVIDENCE_FRESH_DAYS * DAY_MS;
  return {
    ...venue,
    siteFacts: facts,
    ...(facts.hours && fresh && !venue.openingHours ? { openingHours: facts.hours.hours } : {}),
  };
}
