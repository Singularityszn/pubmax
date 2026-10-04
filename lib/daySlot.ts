// Which part of the London day it is. ONE owner, because two surfaces answer it.
//
// The greeting at the top of Today has always derived this
// (lib/dayGreeting.ts). The drink-weather verdict beside it had the word
// "evening" baked into its sentences, so a reader was greeted "Good morning"
// over a card reading "Crisp autumn evening. Amber ale weather." Both now read
// the same band from here, and neither may keep a copy of the boundaries.
//
// A leaf on purpose: it imports the London clock and nothing else, so
// lib/drinkWeather.ts can take it without a cycle through the greeting that
// already imports drinkWeather's own types.

import { londonHour } from "@/lib/londonHour";

export type DaySlot = "morning" | "afternoon" | "evening" | "night";

/** Time band for a moment, London wall clock. */
export function daySlot(now: Date): DaySlot {
  const hour = londonHour(now);
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 22) return "evening";
  return "night";
}

/**
 * The band /tonight names. The Day/Tonight switch is already on Tonight, so a
 * morning or afternoon clock must not make its weather line say morning.
 * Evening and night keep the clock, because those are tonight. Only that
 * strip reads this; every other surface reads the clock's `daySlot`.
 */
export function tonightDayPart(now: Date): DaySlot {
  const slot = daySlot(now);
  if (slot === "morning" || slot === "afternoon") return "evening";
  return slot;
}
