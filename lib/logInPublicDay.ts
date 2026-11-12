import { londonDayKey } from "@/lib/pintContributions";

/**
 * The Product Hunt "log in public" date, as a Europe/London calendar day.
 * Set it to null to turn the day off, or change it to move the day.
 * README.md's Pint Drops feature guide owns the displayed scope and behaviour.
 *
 * This leaf stays this small because home reads it on every visit. What the
 * day shows lives in lib/logInPublicDrops.ts, inside the section's own chunk.
 */
export const LOG_IN_PUBLIC_DAY: string | null = "2026-11-17";

export function logInPublicDayActive(now: Date, day: string | null = LOG_IN_PUBLIC_DAY): boolean {
  return day !== null && londonDayKey(now) === day;
}
