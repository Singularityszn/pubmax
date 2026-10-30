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
  /** The London area (borough) the pub stands in, as the pub's own card names it. */
  area?: string;
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
    const { day, venueId, venueName, area } = item as Record<string, unknown>;
    if (typeof day !== "string" || !DAY.test(day)) continue;
    if (typeof venueId !== "string" || !venueId || typeof venueName !== "string" || !venueName.trim()) continue;
    const stamp: PalQuestStamp = { day, venueId, venueName: venueName.trim() };
    if (typeof area === "string" && area.trim()) stamp.area = area.trim();
    if (!byDay.has(day)) byDay.set(day, stamp);
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
 * Stamp today's quest, and return the new stamp. The first answer of a London
 * day is the day's stamp; a day already stamped, in this tab or another,
 * returns null, so a second price that day never claims the first one's pub.
 */
export function stampPalQuest(
  stamp: Omit<PalQuestStamp, "day">,
  now: Date = new Date(),
  storage: Storage | null = localStore(),
): PalQuestStamp | null {
  const day = londonDayKey(now);
  const stamps = readPalQuestStamps(storage);
  if (!day || stamps.some((kept) => kept.day === day)) return null;
  const added = parsePalQuestStamps(JSON.stringify([{ ...stamp, day }]))[0] ?? null;
  if (!added) return null;
  try {
    storage?.setItem(PAL_QUEST_STAMPS_KEY, JSON.stringify(parsePalQuestStamps(JSON.stringify([added, ...stamps]))));
  } catch {
    // A full or blocked store keeps the old book; the cheer still plays.
  }
  return added;
}

/** Today's stamp, if the quest is already answered today. */
export function palQuestStampToday(stamps: readonly PalQuestStamp[], now: Date = new Date()): PalQuestStamp | null {
  const day = londonDayKey(now);
  return stamps.find((stamp) => stamp.day === day) ?? null;
}

/**
 * What the Pal asks, in its voice, saying no more than the mission's reason
 * holds: a mission names a price to log or to check, never who logged one or
 * how many did (missionHeading in lib/priceEvidenceMissions.ts says the same).
 */
export function palQuestLine(palName: string, reason: PriceEvidenceMissionReason, venueName: string): string {
  const pub = venueName.trim() || "this pub";
  if (reason === "missing") return `${palName}'s quest for today: log a price at ${pub}?`;
  if (reason === "stale") return `${palName}'s quest for today: the price at ${pub} is out of date. Check the board for me?`;
  return `${palName}'s quest for today: check the price at ${pub}?`;
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

// ---------------------------------------------------------------------------
// The price passport: the stamp book as one page per London area, each page
// with a landmark that really stands in that area, or else a plain mark (the
// map's pictograms, lib/mapIcons.ts), and the person's Pal posed its own way
// for that area. Still a mark, never a score: a page names its area and shows
// its stamps, and nothing counts pages or stamps.
// ---------------------------------------------------------------------------

/** The page for stamps from before the passport knew their area. */
export const PAL_PASSPORT_ANYWHERE = "Around London";

export type PalPassportPage = { area: string; stamps: PalQuestStamp[] };

/** One page per area, the page with the newest stamp first, stamps newest first on each. */
export function palPassportPages(stamps: readonly PalQuestStamp[]): PalPassportPage[] {
  const pages = new Map<string, PalQuestStamp[]>();
  const sorted = [...stamps].sort((a, b) => (a.day < b.day ? 1 : a.day > b.day ? -1 : 0));
  for (const stamp of sorted) {
    const area = stamp.area ?? PAL_PASSPORT_ANYWHERE;
    pages.set(area, [...(pages.get(area) ?? []), stamp]);
  }
  return [...pages].map(([area, kept]) => ({ area, stamps: kept }));
}

function hashOf(text: string): number {
  let hash = 0;
  for (const char of text) hash = (hash * 31 + char.charCodeAt(0)) | 0;
  return Math.abs(hash);
}

/** The marks a page may wear: the map's own pictograms (iconId "lm:<key>"). */
export type PalPassportLandmark = "clock-tower" | "dome" | "shard" | "wheel" | "keep" | "canal" | "ship" | "chimneys" | "civic";

/** The plain mark, the map's generic civic building: it names no real place. */
export const PAL_PASSPORT_PLAIN_MARK = "civic" satisfies PalPassportLandmark;

/**
 * The areas whose page wears a named building, each with the curated landmark
 * (lib/landmarks.ts, by id) that really stands in that area and wears that
 * mark on the map. An area never borrows another area's building, so every
 * area not named here, and "Around London", wears the plain mark.
 */
export const PAL_PASSPORT_AREA_LANDMARKS: Readonly<Record<string, { mark: PalPassportLandmark; landmarkId: string }>> = {
  "westminster": { mark: "clock-tower", landmarkId: "big-ben" },
  "city of london": { mark: "dome", landmarkId: "st-pauls" },
  "tower hamlets": { mark: "keep", landmarkId: "tower-of-london" },
  "southwark": { mark: "shard", landmarkId: "the-shard" },
  "lambeth": { mark: "wheel", landmarkId: "london-eye" },
  "camden": { mark: "canal", landmarkId: "camden-lock" },
  "greenwich": { mark: "ship", landmarkId: "greenwich" },
  "wandsworth": { mark: "chimneys", landmarkId: "battersea-power-station" },
  "kensington and chelsea": { mark: "dome", landmarkId: "royal-albert-hall" },
  "richmond upon thames": { mark: "keep", landmarkId: "hampton-court-palace" },
};

/** The mark a page wears: its area's own building, or the plain mark. */
export function palPassportLandmark(area: string): PalPassportLandmark {
  return PAL_PASSPORT_AREA_LANDMARKS[area.trim().toLowerCase()]?.mark ?? PAL_PASSPORT_PLAIN_MARK;
}

/**
 * The Pal's pose on a page: a tilt, a facing and a hop of its own for each
 * area, steady across visits, so every page shows the Pal standing its own way.
 */
export function palPassportPose(area: string): { tiltDeg: number; flip: 1 | -1; hopPx: number } {
  const hash = hashOf(`pose:${area}`);
  const tilt = (hash % 13) + 6;
  return {
    tiltDeg: Math.floor(hash / 13) % 2 === 0 ? tilt : -tilt,
    flip: hash % 2 === 0 ? 1 : -1,
    hopPx: Math.floor(hash / 26) % 7,
  };
}

