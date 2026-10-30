// The Pal's price quest: once a London day, the person's own Pal asks them to
// check one pint price near them. The quest IS the price evidence mission
// /near already ranks (lib/priceEvidenceMissions.ts): this module adds the
// Pal's words and the stamp, never a second ranking.
//
// A stamp is the pub and the day the person answered the quest, kept on this
// device for the Pal's stamp book (components/pal/PalQuestStamps.tsx). It is a
// mark, never a score: nothing counts them, nothing in the product branches on
// them, and no line names a number, a level or a streak (docs/VOICE.md,
// `gamified-level`). The quest asks for a price, never a drink: the person can
// read the board or ask at the bar.

import type { PriceEvidenceMissionReason } from "@/lib/priceEvidenceMissions";
import { londonDayKey } from "@/lib/pintContributions";

export type PalQuestStamp = {
  /** The London day the quest was answered: YYYY-MM-DD. */
  day: string;
  venueId: string;
  venueName: string;
};

/** The stamp book on this device. A device identity key: it leaves with the account. */
export const PAL_QUEST_STAMPS_KEY = "pubmax:pal-quest-stamps:v1";

/** The book keeps the newest stamps only, so it never grows without end. */
const MAX_STAMPS = 60;

const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** The stamps a stored value holds, newest day first, one per day, at most MAX_STAMPS. */
export function parsePalQuestStamps(raw: string | null): PalQuestStamp[] {
  let value: unknown;
  try {
    value = raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
  if (!Array.isArray(value)) return [];
  const byDay = new Map<string, PalQuestStamp>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const { day, venueId, venueName } = item as Record<string, unknown>;
    if (typeof day !== "string" || !DAY.test(day)) continue;
    if (typeof venueId !== "string" || !venueId || typeof venueName !== "string" || !venueName.trim()) continue;
    if (!byDay.has(day)) byDay.set(day, { day, venueId, venueName: venueName.trim() });
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)).slice(0, MAX_STAMPS);
}

type Storage = Pick<globalThis.Storage, "getItem" | "setItem">;

function localStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readPalQuestStamps(storage: Storage | null = localStore()): PalQuestStamp[] {
  try {
    return parsePalQuestStamps(storage?.getItem(PAL_QUEST_STAMPS_KEY) ?? null);
  } catch {
    return [];
  }
}

/**
 * Stamp today's quest. The first answer of a London day is the day's stamp; a
 * second price that day is still welcome, and stamps nothing.
 */
export function stampPalQuest(
  stamp: Omit<PalQuestStamp, "day">,
  now: Date = new Date(),
  storage: Storage | null = localStore(),
): PalQuestStamp[] {
  const day = londonDayKey(now);
  const stamps = readPalQuestStamps(storage);
  if (!day || stamps.some((kept) => kept.day === day)) return stamps;
  const next = parsePalQuestStamps(JSON.stringify([{ ...stamp, day }, ...stamps]));
  try {
    storage?.setItem(PAL_QUEST_STAMPS_KEY, JSON.stringify(next));
  } catch {
    // A full or blocked store keeps the old book; the cheer still plays.
  }
  return next;
}

/** Today's stamp, if the quest is already answered today. */
export function palQuestStampToday(stamps: readonly PalQuestStamp[], now: Date = new Date()): PalQuestStamp | null {
  const day = londonDayKey(now);
  return stamps.find((stamp) => stamp.day === day) ?? null;
}

/** What the Pal asks: the mission's own reason, in the Pal's voice. */
export function palQuestLine(palName: string, reason: PriceEvidenceMissionReason, venueName: string): string {
  const pub = venueName.trim() || "this pub";
  if (reason === "missing") return `${palName}'s quest for today: nobody has logged a price at ${pub} yet. Be the first?`;
  if (reason === "stale") return `${palName}'s quest for today: the price at ${pub} is out of date. Check the board for me?`;
  return `${palName}'s quest for today: one person logged a price at ${pub}. Can you check it?`;
}

/** The small print under every quest: it asks for a price, never a drink. */
export const PAL_QUEST_NO_DRINK = "No need to buy anything. Read the board or ask at the bar.";

/** What the Pal says when the quest is answered. */
export function palQuestDoneLine(palName: string, venueName: string): string {
  return `Quest done. ${palName} stamped ${venueName.trim() || "this pub"} in your book.`;
}

/** A stamp's date as the stamp prints it: "30 Oct". */
export function palQuestStampDate(day: string): string {
  if (!DAY.test(day)) return "";
  const date = new Date(`${day}T12:00:00Z`);
  return new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(date);
}
