// The Year in Pints share: the part of "Your year so far" (lib/palYear.ts) a
// person may send. The person ticks which lines go on the card, and the link
// carries those lines and nothing else: no handle, no account, no Pal and no
// line they left unticked. The card (app/api/year-card) and the shared page
// (app/year-in-pints/[year]) read the link, so they can show only what the
// link holds, and they name a pub only from the venue dataset, never from text
// in the link. It keeps the wrap's law: free forever, a year read back and
// never a score, so it carries no pints drunk, no streak and no rank.

import { MONTHS, dayLabel, type PalYearFacts } from "@/lib/palYear";

/** One line of the year a person may tick, in the order the card reads them. */
export const YEAR_SHARE_PARTS = ["nights", "month", "stops", "favourite", "first", "prices"] as const;
export type YearSharePart = (typeof YEAR_SHARE_PARTS)[number];

/**
 * Ticked until the person unticks them: the counts. A line that names a pub
 * or a day says where and when someone drinks, so it waits for a tick.
 */
export const DEFAULT_YEAR_SHARE_PARTS: readonly YearSharePart[] = ["nights", "month", "stops", "prices"];

/** The first year the wrap reads back. */
const FIRST_YEAR_IN_PINTS = 2026;

export type YearShare = {
  year: number;
  /** The month (1 to 12) the year was read up to. Before 12 it is the year so far. */
  through: number;
  nights?: number;
  /** The busiest month, 1 to 12. */
  month?: number;
  stops?: number;
  favourite?: { venueId: string; visits: number };
  /** The first night's London day (YYYY-MM-DD) and its first stop, when it was a crawl. */
  first?: { day: string; venueId: string | null };
  prices?: { count: number; boroughs: number };
};

// A pub is named by its dataset id and nothing else. The shape is checked
// here, and the name is looked up on the server, so an id the dataset does not
// know names no pub.
const VENUE_ID = /^[a-z0-9][a-z0-9-]{1,110}$/;
const MAX_NIGHTS = 366;
const MAX_STOPS = 5000;
const MAX_PRICES = 100_000;
const MAX_BOROUGHS = 33;

function monthOf(day: string): number {
  return Number(day.slice(5, 7));
}

/**
 * A favourite or venue-backed first night is offered only when its pub name
 * is visible. A first night without a venue offers only its date.
 */
export function yearShareOffer(facts: PalYearFacts, venueNames: Readonly<Record<string, string>>): YearSharePart[] {
  return YEAR_SHARE_PARTS.filter((part) => {
    switch (part) {
      case "nights":
        return facts.nightsKept > 0;
      case "month":
        return facts.nightsKept > 1 && facts.busiestMonth !== null;
      case "stops":
        return facts.stopsWalked > 0;
      case "favourite":
        return facts.favourite !== null && Boolean(venueNames[facts.favourite.venueId]);
      case "first":
        return facts.firstNight !== null && (
          !facts.firstNight.firstStopVenueId || Boolean(venueNames[facts.firstNight.firstStopVenueId])
        );
      case "prices":
        return facts.pricesMapped > 0;
    }
  });
}

/**
 * The share holding only the ticked lines, read up to `today` (a London day).
 * Null when nothing ticked is there to send.
 */
export function yearShareFrom(
  facts: PalYearFacts,
  parts: ReadonlySet<YearSharePart>,
  today: string,
  venueNames: Readonly<Record<string, string>>,
): YearShare | null {
  const selected = new Set(yearShareOffer(facts, venueNames).filter((part) => parts.has(part)));
  const sameYear = today.startsWith(`${facts.year}-`);
  const share: YearShare = { year: facts.year, through: sameYear ? monthOf(today) : 12 };
  if (selected.has("nights")) share.nights = facts.nightsKept;
  if (selected.has("month") && facts.busiestMonth) {
    share.month = MONTHS.indexOf(facts.busiestMonth as (typeof MONTHS)[number]) + 1;
  }
  if (selected.has("stops")) share.stops = facts.stopsWalked;
  if (selected.has("favourite") && facts.favourite) share.favourite = { ...facts.favourite };
  if (selected.has("first") && facts.firstNight) {
    share.first = { day: facts.firstNight.day, venueId: facts.firstNight.firstStopVenueId };
  }
  if (selected.has("prices")) {
    share.prices = { count: facts.pricesMapped, boroughs: facts.boroughs };
  }
  return hasLines(share) ? share : null;
}

function hasLines(share: YearShare): boolean {
  return YEAR_SHARE_PARTS.some((part) => yearSharePartPresent(share, part));
}

function yearSharePartPresent(share: YearShare, part: YearSharePart): boolean {
  switch (part) {
    case "nights":
      return share.nights !== undefined;
    case "month":
      return share.month !== undefined;
    case "stops":
      return share.stops !== undefined;
    case "favourite":
      return share.favourite !== undefined;
    case "first":
      return share.first !== undefined;
    case "prices":
      return share.prices !== undefined;
  }
}

/** The query both the page and the card read. Short keys, so a link stays short. */
export function yearShareQuery(share: YearShare): string {
  const params = new URLSearchParams();
  params.set("to", String(share.through));
  if (share.nights !== undefined) params.set("n", String(share.nights));
  if (share.month !== undefined) params.set("m", String(share.month));
  if (share.stops !== undefined) params.set("s", String(share.stops));
  if (share.favourite) {
    params.set("fv", share.favourite.venueId);
    params.set("fc", String(share.favourite.visits));
  }
  if (share.first) {
    params.set("fd", share.first.day.slice(5));
    if (share.first.venueId) params.set("fs", share.first.venueId);
  }
  if (share.prices) {
    params.set("p", String(share.prices.count));
    params.set("b", String(share.prices.boroughs));
  }
  return params.toString();
}

/** The page a shared year opens on. */
export function yearSharePath(share: YearShare): string {
  return `/year-in-pints/${share.year}?${yearShareQuery(share)}`;
}

/** The card a shared year previews with. */
export function yearShareCardPath(share: YearShare): string {
  return `/api/year-card?y=${share.year}&${yearShareQuery(share)}`;
}

type ParamReader = { get(name: string): string | null };

function intParam(params: ParamReader, key: string, min: number, max: number): number | undefined {
  const raw = params.get(key);
  if (raw === null || !/^\d{1,6}$/.test(raw)) return undefined;
  const value = Number(raw);
  return value >= min && value <= max ? value : undefined;
}

function venueParam(params: ParamReader, key: string): string | undefined {
  const raw = params.get(key);
  return raw !== null && VENUE_ID.test(raw) ? raw : undefined;
}

/** A real calendar day in `year`, from "MM-DD". */
function dayParam(params: ParamReader, key: string, year: number): string | undefined {
  const raw = params.get(key);
  if (raw === null || !/^\d{2}-\d{2}$/.test(raw)) return undefined;
  const day = `${year}-${raw}`;
  const date = new Date(`${day}T12:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === day ? day : undefined;
}

/**
 * The share a link holds, read up to `today` (a London day). Every value is
 * checked on its own and a bad one is dropped rather than guessed, so a link
 * cannot claim a year that has not happened, a month past the one it was read
 * to, or a count no year could hold. Null when no line survives.
 */
export function parseYearShare(yearRaw: string | null | undefined, params: ParamReader, today: string): YearShare | null {
  if (!yearRaw || !/^\d{4}$/.test(yearRaw)) return null;
  const year = Number(yearRaw);
  const thisYear = Number(today.slice(0, 4));
  if (year < FIRST_YEAR_IN_PINTS || year > thisYear) return null;
  const through = intParam(params, "to", 1, year === thisYear ? monthOf(today) : 12);
  if (through === undefined) return null;

  const share: YearShare = { year, through };
  const nights = intParam(params, "n", 1, MAX_NIGHTS);
  if (nights !== undefined) share.nights = nights;
  const month = intParam(params, "m", 1, through);
  if (month !== undefined) share.month = month;
  const stops = intParam(params, "s", 1, MAX_STOPS);
  if (stops !== undefined) share.stops = stops;
  const favourite = venueParam(params, "fv");
  const visits = intParam(params, "fc", 2, MAX_NIGHTS);
  if (favourite && visits !== undefined) share.favourite = { venueId: favourite, visits };
  const firstDay = dayParam(params, "fd", year);
  if (firstDay && monthOf(firstDay) <= through) share.first = { day: firstDay, venueId: venueParam(params, "fs") ?? null };
  const prices = intParam(params, "p", 1, MAX_PRICES);
  if (prices !== undefined) share.prices = { count: prices, boroughs: intParam(params, "b", 0, MAX_BOROUGHS) ?? 0 };
  return hasLines(share) ? share : null;
}

/** "My 2026 so far", or "My 2026 in pints" once the year is read to December. */
export function yearShareHeading(share: Pick<YearShare, "year" | "through">): string {
  return share.through >= 12 ? `My ${share.year} in pints` : `My ${share.year} so far`;
}

/** "January to October" for a year so far; null for a whole year. */
export function yearShareSpan(share: Pick<YearShare, "through">): string | null {
  if (share.through >= 12) return null;
  return share.through === 1 ? "January" : `January to ${MONTHS[share.through - 1]}`;
}

function count(value: number, one: string, many: string): string {
  return value === 1 ? `One ${one}` : `${value.toLocaleString("en-GB")} ${many}`;
}

/**
 * One line of the shared year, in the sharer's words. A pub with no known
 * name is left out of its line, and a favourite with no name has no line.
 */
export function yearShareLine(
  share: YearShare,
  part: YearSharePart,
  venueNames: Readonly<Record<string, string>>,
): string | null {
  switch (part) {
    case "nights":
      return share.nights !== undefined ? `${count(share.nights, "night out", "nights out")}.` : null;
    case "month":
      return share.month !== undefined ? `${MONTHS[share.month - 1]} was the busiest month.` : null;
    case "stops":
      return share.stops !== undefined ? `${count(share.stops, "stop walked", "stops walked")}.` : null;
    case "favourite": {
      const name = share.favourite ? venueNames[share.favourite.venueId] : undefined;
      return share.favourite && name ? `Kept coming back to ${name}. ${share.favourite.visits} crawls in all.` : null;
    }
    case "first": {
      if (!share.first) return null;
      const name = share.first.venueId ? venueNames[share.first.venueId] : undefined;
      return name
        ? `First night out: ${dayLabel(share.first.day)}, at ${name}.`
        : `First night out: ${dayLabel(share.first.day)}.`;
    }
    case "prices": {
      if (!share.prices) return null;
      const where = share.prices.boroughs > 1 ? ` across ${share.prices.boroughs} boroughs` : "";
      return `${count(share.prices.count, "price mapped", "prices mapped")}${where}. Every one helps the next person.`;
    }
  }
}

/** Every line the shared year holds, in card order. */
export function yearShareLines(share: YearShare, venueNames: Readonly<Record<string, string>>): string[] {
  return YEAR_SHARE_PARTS.flatMap((part) => {
    const line = yearShareLine(share, part, venueNames);
    return line ? [line] : [];
  });
}

/** The pubs a shared year names, for the server to look up. */
export function yearShareVenueIds(share: YearShare): string[] {
  const ids = [share.favourite?.venueId, share.first?.venueId ?? undefined].filter((id): id is string => Boolean(id));
  return [...new Set(ids)];
}

/** December is when the wrap is read as the year, not the year so far. */
export function isYearInPintsSeason(today: string): boolean {
  return monthOf(today) === 12;
}
