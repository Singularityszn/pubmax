// Last orders: the pubs near a point that their SOURCED hours say stay open at
// least half an hour more, nearest first and cheapest first at the same walk.
// Pure: the packs, the point and the clock are all passed in. The hours answer
// is lib/lastOrders.ts; a pub it cannot answer for is left off, never shown open.

import { haversineKm } from "@/lib/haversine";
import { londonCivilTime, minutesUntilClose } from "@/lib/lastOrders";
import { walkMinutesFromKm } from "@/lib/walkMinutes";

export const LAST_ORDERS_HOURS_PATH = "/data/last_orders/london_hours.json";
export const LAST_ORDERS_PRICES_PATH = "/data/last_orders/london_prices.json";

/** A pub must have at least this long left on its sourced hours to be listed. */
export const LAST_ORDERS_MIN_MINUTES = 30;
/** And still this long left when you walk in, so the walk is worth it. */
const LAST_ORDERS_ARRIVAL_MINUTES = 15;
/** Past this walk a pub is not "near". */
const LAST_ORDERS_MAX_WALK_MINUTES = 30;
const LAST_ORDERS_LIMIT = 12;

/** London 21:30 to 03:59 is when Tonight offers Last orders on its own. */
const WINDOW_OPENS = 21 * 60 + 30;
const WINDOW_CLOSES = 4 * 60;

export type LastOrdersPub = {
  venueId: string;
  name: string;
  lat: number;
  lng: number;
  openingHours: string;
  /** The mapper's `check_date:opening_hours`, or null when OSM states none. */
  hoursCheckDate: string | null;
};

export type LastOrdersHoursPack = {
  /** The day the OSM extract was read, YYYY-MM-DD, or null. */
  readOn: string | null;
  pubs: LastOrdersPub[];
};

export type LastOrdersPrice = { priceGbp: number; observedAt: string | null };

export type LastOrdersRow = {
  venueId: string;
  name: string;
  walkMinutes: number;
  /** Minutes the sourced hours say it stays open; null when it never closes tonight. */
  minutesLeft: number | null;
  /** The close, `HH:MM` London time; null when it never closes tonight. */
  closesAt: string | null;
  price: LastOrdersPrice | null;
  hoursCheckDate: string | null;
};

const DAY = /^\d{4}-\d{2}(?:-\d{2})?$/;

function isPackRow(value: unknown): value is [string, string, number, number, string, string] {
  return (
    Array.isArray(value)
    && value.length === 6
    && typeof value[0] === "string"
    && value[0].startsWith("venue-")
    && typeof value[1] === "string"
    && value[1].length > 0
    && typeof value[2] === "number"
    && Number.isFinite(value[2])
    && typeof value[3] === "number"
    && Number.isFinite(value[3])
    && typeof value[4] === "string"
    && value[4].length > 0
    && typeof value[5] === "string"
  );
}

/** The hours pack, or null when it is not one. A malformed row is dropped. */
export function parseLastOrdersHoursPack(value: unknown): LastOrdersHoursPack | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as { version?: unknown; readOn?: unknown; rows?: unknown };
  if (record.version !== 1 || !Array.isArray(record.rows)) return null;
  const pubs: LastOrdersPub[] = [];
  for (const row of record.rows) {
    if (!isPackRow(row)) continue;
    pubs.push({
      venueId: row[0],
      name: row[1],
      lat: row[2],
      lng: row[3],
      openingHours: row[4],
      hoursCheckDate: DAY.test(row[5]) ? row[5] : null,
    });
  }
  const readOn = typeof record.readOn === "string" && DAY.test(record.readOn) ? record.readOn : null;
  return { readOn, pubs };
}

/** The price pack as a map by venue id. Anything malformed reads as no price. */
export function parseLastOrdersPricesPack(value: unknown): ReadonlyMap<string, LastOrdersPrice> {
  const prices = new Map<string, LastOrdersPrice>();
  if (typeof value !== "object" || value === null) return prices;
  const rows = (value as { version?: unknown; rows?: unknown }).rows;
  if ((value as { version?: unknown }).version !== 1 || typeof rows !== "object" || rows === null) return prices;
  for (const [venueId, entry] of Object.entries(rows)) {
    if (!Array.isArray(entry)) continue;
    const [priceGbp, observedAt] = entry as unknown[];
    if (typeof priceGbp !== "number" || !Number.isFinite(priceGbp) || priceGbp <= 0) continue;
    prices.set(venueId, {
      priceGbp,
      observedAt: typeof observedAt === "string" && DAY.test(observedAt) ? observedAt : null,
    });
  }
  return prices;
}

/** Whether London's clock is in the late window Tonight leads with Last orders. */
export function isLastOrdersHour(now: Date): boolean {
  const { minutes } = londonCivilTime(now);
  return minutes >= WINDOW_OPENS || minutes < WINDOW_CLOSES;
}

/**
 * The listed pubs at `now`, from `from`. Nearest first in five-minute walk
 * bands; inside a band, a listed pint before none and the cheaper pint first,
 * then the pub open longest. A pub whose hours are unknown, closed, or close
 * inside half an hour is left off.
 */
export function rankLastOrders(input: {
  pubs: readonly LastOrdersPub[];
  prices: ReadonlyMap<string, LastOrdersPrice>;
  from: { lat: number; lng: number };
  now: Date;
  limit?: number;
}): LastOrdersRow[] {
  const rows: LastOrdersRow[] = [];
  for (const pub of input.pubs) {
    const walkMinutes = walkMinutesFromKm(
      haversineKm([input.from.lng, input.from.lat], [pub.lng, pub.lat]),
    );
    if (walkMinutes > LAST_ORDERS_MAX_WALK_MINUTES) continue;
    const answer = minutesUntilClose(pub.openingHours, input.now);
    let minutesLeft: number | null;
    let closesAt: string | null;
    if (answer.state === "open-all-night") {
      minutesLeft = null;
      closesAt = null;
    } else if (answer.state === "open") {
      if (answer.minutesLeft < LAST_ORDERS_MIN_MINUTES) continue;
      if (answer.minutesLeft - walkMinutes < LAST_ORDERS_ARRIVAL_MINUTES) continue;
      minutesLeft = answer.minutesLeft;
      closesAt = answer.closesAt;
    } else {
      continue;
    }
    rows.push({
      venueId: pub.venueId,
      name: pub.name,
      walkMinutes,
      minutesLeft,
      closesAt,
      price: input.prices.get(pub.venueId) ?? null,
      hoursCheckDate: pub.hoursCheckDate,
    });
  }
  const band = (row: LastOrdersRow) => Math.ceil(row.walkMinutes / 5);
  const priceKey = (row: LastOrdersRow) => row.price?.priceGbp ?? Number.POSITIVE_INFINITY;
  const leftKey = (row: LastOrdersRow) => row.minutesLeft ?? Number.POSITIVE_INFINITY;
  rows.sort(
    (a, b) =>
      band(a) - band(b)
      || priceKey(a) - priceKey(b)
      || leftKey(b) - leftKey(a)
      || a.walkMinutes - b.walkMinutes
      || a.name.localeCompare(b.name, "en-GB"),
  );
  return rows.slice(0, input.limit ?? LAST_ORDERS_LIMIT);
}

/**
 * The countdown chip's words: "Open 41 more min" inside two hours, the close
 * itself past that ("Open until 01:00"), and "Open all night" for 24/7.
 */
export function lastOrdersCountdownLabel(row: Pick<LastOrdersRow, "minutesLeft" | "closesAt">): string {
  if (row.minutesLeft === null || row.closesAt === null) return "Open all night";
  if (row.minutesLeft < 120) return `Open ${row.minutesLeft} more min`;
  return `Open until ${row.closesAt}`;
}
