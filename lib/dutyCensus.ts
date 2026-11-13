import { DEFAULT_VISIBILITY, type PintDrop } from "@/lib/pintDropShared";

// The before-1-February price census: a dated reason to log what you pay
// before alcohol duty rises. This leaf owns its dates, its figure, its source
// and the one rule for which Pint Drops it counts.

export const DUTY_CENSUS = {
  /** The London day the census starts: the day it shipped. */
  startsOn: "2026-11-12",
  dutyRisesOn: "2027-02-01",
  dutyRisePercent: "4.55",
  source: {
    label: "GOV.UK",
    title: "Changes to Alcohol Duty rates from 1 February 2027",
    publishedOn: "2026-10-28",
    url: "https://www.gov.uk/government/publications/changes-to-alcohol-duty-rates-from-1-february-2027",
  },
} as const;

function dayLabel(day: string, month: "short" | "long", year = false): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month,
    ...(year ? { year: "numeric" as const } : {}),
    timeZone: "UTC",
  }).format(Date.parse(`${day}T00:00:00Z`));
}

/** The census days as a card prints them: "12 Nov", "12 November", "1 Feb". */
export const DUTY_CENSUS_DAYS = {
  startShort: dayLabel(DUTY_CENSUS.startsOn, "short"),
  startLong: dayLabel(DUTY_CENSUS.startsOn, "long"),
  riseShort: dayLabel(DUTY_CENSUS.dutyRisesOn, "short"),
  riseLong: dayLabel(DUTY_CENSUS.dutyRisesOn, "long", true),
  sourceShort: dayLabel(DUTY_CENSUS.source.publishedOn, "short", true),
} as const;

export const DUTY_CENSUS_LINE =
  `Log what you pay before alcohol duty rises ${DUTY_CENSUS.dutyRisePercent}% on ${DUTY_CENSUS_DAYS.riseLong}.`;

/** Fewer counted drops than this print no figure, never a padded one. */
const DUTY_CENSUS_MIN_SHOWN_COUNT = 3;

// Both days fall in GMT, so London midnight is UTC midnight.
const STARTS_AT_MS = Date.parse(`${DUTY_CENSUS.startsOn}T00:00:00Z`);
const RISES_AT_MS = Date.parse(`${DUTY_CENSUS.dutyRisesOn}T00:00:00Z`);

export const DUTY_CENSUS_STARTS_AT = new Date(STARTS_AT_MS).toISOString();
export const DUTY_CENSUS_RISES_AT = new Date(RISES_AT_MS).toISOString();

/** The census asks only while the rise is still ahead. */
function dutyCensusOpen(nowMs: number): boolean {
  return nowMs < RISES_AT_MS;
}

/** The figure a surface may print, or null when there is none to print. */
export function dutyCensusShownCount(count: number | null | undefined): number | null {
  return typeof count === "number" && Number.isInteger(count) && count >= DUTY_CENSUS_MIN_SHOWN_COUNT
    ? count
    : null;
}

/** How far through the census window `nowMs` is, from 0 at the start to 1 at the rise. */
function dutyCensusElapsed(nowMs: number): number {
  const elapsed = (nowMs - STARTS_AT_MS) / (RISES_AT_MS - STARTS_AT_MS);
  return Math.min(1, Math.max(0, elapsed));
}

export type DutyCensusDrop = Pick<
  PintDrop,
  "status" | "visibility" | "priceGbp" | "provenance" | "createdAt"
>;

/**
 * A drop counts when a stranger can read it, it carries a real price a drinker
 * logged, and it was logged inside the census window. Friends-only, legacy,
 * hidden, unpriced and demo drops never count. Withdrawn authors are the
 * store's to remove, because only the store can read them.
 */
export function countsTowardDutyCensus(drop: DutyCensusDrop): boolean {
  const visibility = drop.visibility ?? DEFAULT_VISIBILITY;
  if (drop.status !== "visible") return false;
  if (visibility !== "public" && visibility !== "anonymous") return false;
  if (drop.provenance === "demo") return false;
  if (typeof drop.priceGbp !== "number" || !Number.isFinite(drop.priceGbp) || drop.priceGbp <= 0) {
    return false;
  }
  const createdAt = Date.parse(drop.createdAt);
  return createdAt >= STARTS_AT_MS && createdAt < RISES_AT_MS;
}

const COUNTED_AT = new Intl.DateTimeFormat("en-GB", {
  weekday: "long",
  day: "numeric",
  month: "long",
  hour: "2-digit",
  minute: "2-digit",
  timeZone: "Europe/London",
});

/** What a census card prints: its figure, when it was counted, and where the window stands. */
export type DutyCensusView = {
  count: number | null;
  /** The London time the figure was read, for a copy that is held. Null when live. */
  countedAt: string | null;
  elapsed: number;
};

/**
 * The card for a copy read at `nowMs` and held for `holdMs`, or null once the
 * rise falls inside the hold, so a held copy never asks after the duty rose.
 */
export function dutyCensusView(
  nowMs: number,
  count: number | null,
  holdMs = 0,
): DutyCensusView | null {
  if (!dutyCensusOpen(nowMs + holdMs)) return null;
  const shown = dutyCensusShownCount(count);
  return {
    count: shown,
    countedAt: shown !== null && holdMs > 0 ? COUNTED_AT.format(nowMs) : null,
    elapsed: dutyCensusElapsed(nowMs),
  };
}
