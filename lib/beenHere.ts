// "Been here": the pubs a person says they have been to, and nothing else.
//
// Launch plan 1 Nov 2026, section 4 ("Keep") and the Beli row of section 5:
// an optional first-run card, "Tap the pubs you've been to", starts a
// person's Been list in about thirty seconds. This module is the PURE LEAF
// behind it: the list's name, the pubs the card offers, the card's words, the
// shape of the one write that moves the card's taps to an account, and the
// device markers. It imports no store, no fetch and no React, so the card, the
// route and the passport read one set of rules.
//
// THE HONESTY FENCE. A tap says "I have been to this pub" and nothing more. It
// carries NO DATE, so it is never a diary entry (lib/diary.ts needs the day of
// the visit, and a first-run tap has none). It is a saved list instead, the
// built-in "Been here" (lib/savedListPolicy.ts), which already lives on the
// device before an account exists. The passport prints such a row as "No date"
// on the owner's own page and never invents one (lib/profilePassport.ts).
//
// WHERE A TAP GOES. On the device at once, through the same device store every
// saved list uses (lib/savedPubs.ts). The card also keeps the taps in a small
// carry set, and the carry (lib/beenHereCarry.ts) moves that set to the
// signed-in account in ONE request, so twelve taps in thirty seconds never
// meet the per-minute save limit one tap at a time would. A tap made signed
// out belongs to the device and moves to the first account that signs in on
// it; a tap made signed in names its account and moves only to that account.

import { safeLocalStorage } from "@/lib/safeStorage";

/** The built-in saved list a tap lands on. Mirrors BUILT_IN_LIST_TYPES. */
export const BEEN_HERE_LIST = "Been here";

export type BeenHereFirstRunPub = {
  venueId: string;
  /** The name the map prints for this pub. */
  name: string;
  /** The London borough the pub's own record names. */
  area: string;
};

/**
 * The twelve pubs the card offers. None is a pick of this module's own: each
 * is a stop on a hand-made London crawl (lib/curatedCrawls.ts) AND a pub the
 * cited historic-pub record carries (public/data/historic_pubs.json, each row
 * sourced to its Wikipedia article), so a Londoner is likely to know it. The
 * name and the area are the venue dataset's own words.
 * `__tests__/beenHereFirstRun.test.ts` holds every row to all three sources.
 */
export const BEEN_HERE_FIRST_RUN_PUBS: readonly BeenHereFirstRunPub[] = [
  { venueId: "venue-1yd70c7", name: "The Lamb", area: "Camden" },
  { venueId: "venue-fr71bp", name: "Museum Tavern", area: "Camden" },
  { venueId: "venue-11n82fd", name: "The Seven Stars", area: "Camden" },
  { venueId: "venue-phqazo", name: "The Coach & Horses", area: "Westminster" },
  { venueId: "venue-xiesdn", name: "The Dog & Duck", area: "Westminster" },
  { venueId: "venue-gk2fp9", name: "Sherlock Holmes", area: "Westminster" },
  { venueId: "venue-1ha28jc", name: "The Grenadier", area: "Westminster" },
  { venueId: "venue-1sx1vco", name: "Ye Olde Cock Tavern", area: "City of London" },
  { venueId: "venue-gv8lwa", name: "Anchor", area: "Southwark" },
  { venueId: "venue-16pnwmm", name: "Prospect of Whitby", area: "Tower Hamlets" },
  { venueId: "venue-ekvkuv", name: "The Grapes", area: "Tower Hamlets" },
  { venueId: "venue-1snxfi3", name: "The Spaniards Inn", area: "Barnet" },
];

/** The card's words, in one place so the voice fences read them. */
export const BEEN_HERE_COPY = {
  kicker: "Been here",
  title: "Tap the pubs you've been to",
  lead: "Tap the ones you know and they start your Been here list. No dates, just the pubs.",
  /** Signed out: the taps stay on this device until an account can hold them. */
  deviceLine: "Kept on this device. Sign in and they move to your account.",
  /** Signed in: the list is a saved list, and saved lists show on a profile. */
  accountLine: "It shows on your profile with your other saved lists.",
  chipsLabel: "Pubs to tap",
  done: "Done",
  notNow: "Not now",
} as const;

// ── The one write that moves the card's taps to an account ──────────────────

/** The POST /api/saved-pubs action that adds the carry set to Been here. */
export const BEEN_HERE_CARRY_ACTION = "carryBeenHere";

/** The most pubs one carry may add. Twice the card, so a retry always fits. */
export const BEEN_HERE_CARRY_MAX = 24;

/** A venue id is short and has no spaces; the route never trusts the length. */
const MAX_VENUE_ID = 64;
const VENUE_ID = /^[A-Za-z0-9._:-]+$/;

/**
 * The venue ids of a carry request, deduplicated in order, or null when the
 * value is not a list of between one and BEEN_HERE_CARRY_MAX plain ids. The
 * route and the device store read ids through this one rule.
 */
export function parseBeenHereVenueIds(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const id = item.trim();
    if (!id || id.length > MAX_VENUE_ID || !VENUE_ID.test(id)) return null;
    if (!ids.includes(id)) ids.push(id);
  }
  return ids.length <= BEEN_HERE_CARRY_MAX ? ids : null;
}

// ── Device markers ─────────────────────────────────────────────────────────

/** Set the first time the card is on screen. The card never shows again. */
export const BEEN_HERE_FIRST_RUN_SEEN_KEY = "pubmax:been-here-first-run:v1";

/** The card's taps that no account holds yet. */
export const BEEN_HERE_CARRY_KEY = "pubmax:been-here-carry:v1";

type KeyStore = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function store(storage?: KeyStore | null): KeyStore | null {
  return storage === undefined ? safeLocalStorage() : storage;
}

/**
 * Whether the card has been on screen on this device. A storage we cannot
 * read answers true: a card whose dismissal cannot be kept would come back on
 * every visit, and its taps could not be kept either.
 */
export function hasSeenBeenHereFirstRun(storage?: KeyStore | null): boolean {
  const target = store(storage);
  if (!target) return true;
  try {
    return target.getItem(BEEN_HERE_FIRST_RUN_SEEN_KEY) !== null;
  } catch {
    return true;
  }
}

export function markBeenHereFirstRunSeen(storage?: KeyStore | null): void {
  const target = store(storage);
  if (!target) return;
  try {
    target.setItem(BEEN_HERE_FIRST_RUN_SEEN_KEY, "1");
  } catch {
    // A full or blocked store keeps nothing; the card still closes.
  }
}

/**
 * The taps waiting for an account. `owner` is the account the taps were made
 * under, or null for taps made signed out, which belong to the device and move
 * to whichever account signs in on it first.
 */
export type BeenHereCarry = { owner: string | null; venueIds: string[] };

const EMPTY_CARRY: BeenHereCarry = { owner: null, venueIds: [] };

export function readBeenHereCarry(storage?: KeyStore | null): BeenHereCarry {
  const target = store(storage);
  if (!target) return EMPTY_CARRY;
  let value: unknown;
  try {
    const raw = target.getItem(BEEN_HERE_CARRY_KEY);
    value = raw ? JSON.parse(raw) : null;
  } catch {
    return EMPTY_CARRY;
  }
  if (!value || typeof value !== "object") return EMPTY_CARRY;
  const record = value as { owner?: unknown; venueIds?: unknown };
  const venueIds = parseBeenHereVenueIds(record.venueIds) ?? [];
  const owner = typeof record.owner === "string" && record.owner ? record.owner : null;
  return venueIds.length ? { owner, venueIds } : EMPTY_CARRY;
}

export function writeBeenHereCarry(carry: BeenHereCarry, storage?: KeyStore | null): void {
  const target = store(storage);
  if (!target) return;
  try {
    if (carry.venueIds.length === 0) target.removeItem(BEEN_HERE_CARRY_KEY);
    else target.setItem(BEEN_HERE_CARRY_KEY, JSON.stringify(carry));
  } catch {
    // Nothing kept; the device save itself still stands.
  }
}

/**
 * The carry set after one tap. A tap under another account than the set's own
 * starts the set afresh, so one account's taps never move to another.
 */
export function carryAfterTap(
  carry: BeenHereCarry,
  venueId: string,
  wanted: boolean,
  owner: string | null,
): BeenHereCarry {
  const base = carry.owner === owner ? carry.venueIds : [];
  const rest = base.filter((id) => id !== venueId);
  const venueIds = wanted ? [...rest, venueId].slice(-BEEN_HERE_CARRY_MAX) : rest;
  return { owner, venueIds };
}

/** Whether `userId` may receive this carry set. */
export function carryBelongsTo(carry: BeenHereCarry, userId: string): boolean {
  return Boolean(userId) && (carry.owner === null || carry.owner === userId);
}

// ── Same-tab change signal ─────────────────────────────────────────────────

const CHANGE_EVENT = "pubmax:been-here-changed";
let revision = 0;

/** Tell this tab's readers that an account's Been here list has changed. */
export function emitBeenHereChanged(): void {
  revision += 1;
  if (typeof window === "undefined") return;
  try {
    window.dispatchEvent(new Event(CHANGE_EVENT));
  } catch {
    // An environment with no Event constructor still bumps the revision.
  }
}

/** For useSyncExternalStore: a number that moves when the list moves. */
export function beenHereRevision(): number {
  return revision;
}

export function subscribeBeenHere(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  window.addEventListener(CHANGE_EVENT, onChange);
  return () => window.removeEventListener(CHANGE_EVENT, onChange);
}
