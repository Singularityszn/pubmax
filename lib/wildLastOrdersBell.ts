// THE LAST ORDERS BELL (wild idea 07, docs/plans/DESIGN_UX_PLAN.md section 12).
//
// When a pub's SOURCED hours say it closes within 45 minutes, a brass bell
// rings once and a card says so, with where the hours came from and, when the
// same pack holds one, a pub about ten minutes' walk away that is open later.
//
// Pure: the pack, the pub and the clock are passed in. The hours answer is
// lib/lastOrders.ts `minutesUntilClose`, the one Tonight's Last orders reads,
// so a pub it cannot answer for (no hours, unreadable hours, a bank holiday the
// hours are silent on) never rings, and a pub it does not hold rings for no
// one. Nothing here guesses an hour.

import { haversineKm } from "@/lib/haversine";
import { londonCivilTime, londonWallClockInstant, minutesUntilClose } from "@/lib/lastOrders";
import type { LastOrdersPub } from "@/lib/lastOrdersList";
import { walkMinutesFromKm } from "@/lib/walkMinutes";

/** The bell rings when the hours leave this many minutes or fewer. */
export const BELL_MINUTES = 45;
/** "Nearby" is about ten minutes' walk. */
const NEARBY_WALK_MINUTES = 10;
/** A pub open later must still have this long left when you walk in. */
const NEARBY_ARRIVAL_MINUTES = 15;
/** And close at least this much later than the pub calling time, or it is no later at all. */
const NEARBY_LATER_MINUTES = 15;
/** A name match without an id match must sit this close, in km. */
const SAME_PUB_KM = 0.08;

type BellNearby = {
  venueId: string;
  name: string;
  walkMinutes: number;
  /** `HH:MM`, or null when its hours run all night. */
  closesAt: string | null;
};

export type LastOrdersBellAnswer = {
  venueId: string;
  name: string;
  minutesLeft: number;
  closesAt: string;
  /** "tonight" for an evening or after-midnight close, "today" for an afternoon one. */
  when: "tonight" | "today";
  nearby: BellNearby | null;
};

function normaliseName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[’‘]/g, "'")
    .replace(/&/g, "and")
    .replace(/^the\s+/, "")
    .replace(/[^a-z0-9' ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The pack's row for this pub: by venue id, or by the same name a few doors
 * away when the page's id is not the one the pack links (an OSM id against a
 * curated one). Null when the pack does not hold it.
 */
export function findBellPub(
  pubs: readonly LastOrdersPub[],
  pub: { venueId: string; name: string; lat?: number | null; lng?: number | null },
): LastOrdersPub | null {
  const byId = pubs.find((row) => row.venueId === pub.venueId);
  if (byId) return byId;
  if (typeof pub.lat !== "number" || typeof pub.lng !== "number") return null;
  const wanted = normaliseName(pub.name);
  if (!wanted) return null;
  return (
    pubs.find(
      (row) =>
        normaliseName(row.name) === wanted &&
        haversineKm([pub.lng!, pub.lat!], [row.lng, row.lat]) <= SAME_PUB_KM,
    ) ?? null
  );
}

function closeMinuteOfDay(closesAt: string): number {
  const [hour = 0, minute = 0] = closesAt.split(":").map(Number);
  return hour * 60 + minute;
}

/**
 * The bell's answer for one pub at `now`, or null when it should not ring:
 * the pack does not hold the pub, its hours cannot be read, it is closed, it
 * runs all night, or it has more than {@link BELL_MINUTES} left.
 */
export function lastOrdersBell(input: {
  pubs: readonly LastOrdersPub[];
  pub: { venueId: string; name: string; lat?: number | null; lng?: number | null };
  now: Date;
}): LastOrdersBellAnswer | null {
  const row = findBellPub(input.pubs, input.pub);
  if (!row) return null;
  const answer = minutesUntilClose(row.openingHours, input.now);
  if (answer.state !== "open" || answer.minutesLeft > BELL_MINUTES) return null;

  const closeMinute = closeMinuteOfDay(answer.closesAt);
  const when = closeMinute >= 17 * 60 || closeMinute < 6 * 60 ? "tonight" : "today";

  let nearby: BellNearby | null = null;
  let nearbyKey = Number.POSITIVE_INFINITY;
  for (const other of input.pubs) {
    if (other.venueId === row.venueId) continue;
    const walkMinutes = walkMinutesFromKm(haversineKm([row.lng, row.lat], [other.lng, other.lat]));
    if (walkMinutes > NEARBY_WALK_MINUTES) continue;
    const theirs = minutesUntilClose(other.openingHours, input.now);
    let left: number;
    let closesAt: string | null;
    if (theirs.state === "open-all-night") {
      left = Number.POSITIVE_INFINITY;
      closesAt = null;
    } else if (theirs.state === "open") {
      left = theirs.minutesLeft;
      closesAt = theirs.closesAt;
    } else {
      continue;
    }
    // Open LATER than this pub, and still open long enough once you get there.
    if (left < answer.minutesLeft + NEARBY_LATER_MINUTES) continue;
    if (left - walkMinutes < NEARBY_ARRIVAL_MINUTES) continue;
    // Nearest first; at the same walk, the one open longest.
    const key = walkMinutes * 10_000 - Math.min(left, 9_999);
    if (key < nearbyKey) {
      nearbyKey = key;
      nearby = { venueId: other.venueId, name: other.name, walkMinutes, closesAt };
    }
  }

  return {
    venueId: row.venueId,
    name: row.name,
    minutesLeft: answer.minutesLeft,
    closesAt: answer.closesAt,
    when,
    nearby,
  };
}

/**
 * `?wildclock=HH:MM` read as that minute of TODAY on London's clock, or null
 * when the address does not ask for one. Only the wild switch reads it, so a
 * screenshot can show the bell at 22:40 whatever the hour.
 */
export function wildClockFromSearch(search: string, today: Date): Date | null {
  let value: string | null = null;
  try {
    value = new URLSearchParams(search).get("wildclock");
  } catch {
    return null;
  }
  const match = value ? /^(\d{1,2}):(\d{2})$/.exec(value.trim()) : null;
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  const { day } = londonCivilTime(today);
  return new Date(londonWallClockInstant(day.ymd, hour * 60 + minute));
}
