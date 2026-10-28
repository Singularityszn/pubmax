// "Your year so far", told by the person's own Pub Pal (components/pal/
// PalYear.tsx), as pure arithmetic and words. It reads back what the person
// already did this year, from records the app already keeps: the nights kept
// on this device (lib/nightsKept.ts), the crawls walked on this device
// (lib/crawlCompletion.ts) and the prices they mapped (GET /api/pint-drops/
// stats?year=...). Sharing is defined in lib/yearInPints.ts. It keeps the
// wrap's law: it is free forever, a year read back and never a score. It
// counts no pints drunk, no streak and no rank, and nothing in the product
// branches on it.

import { londonDayKey } from "@/lib/pintContributions";

export type PalYearCrawl = {
  stopIds: readonly string[];
  visited: readonly string[];
  startedAt: string;
  completedAt?: string;
};

export type PalYearInput = {
  /** The London calendar year being read back. */
  year: number;
  /** London days (YYYY-MM-DD) a finished night was kept on this device. */
  nightsKeptDays: readonly string[];
  crawls: readonly PalYearCrawl[];
  /** The caller supplies prices and boroughs for `year` in London time. Null means unknown. */
  contributions: { pricesMapped: number; boroughs: number } | null;
};

export type PalYearFacts = {
  year: number;
  nightsKept: number;
  /** The month with the most nights kept, as its English name; null for none or a tie. */
  busiestMonth: string | null;
  stopsWalked: number;
  /** The pub the person came back to in two or more crawls; null otherwise. */
  favourite: { venueId: string; visits: number } | null;
  /** The first night this year: its London day, and its first stop if it was a crawl. */
  firstNight: { day: string; firstStopVenueId: string | null } | null;
  pricesMapped: number;
  boroughs: number;
};

export const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

function inYear(day: string, year: number): boolean {
  return day.startsWith(`${year}-`);
}

/** A crawl's London day: the day it finished, or the day it started. */
function crawlDay(crawl: PalYearCrawl): string | null {
  const when = crawl.completedAt ?? crawl.startedAt;
  if (!when || Number.isNaN(new Date(when).getTime())) return null;
  return londonDayKey(when);
}

export function palYearFacts(input: PalYearInput): PalYearFacts {
  const { year } = input;
  const nights = Array.from(new Set(input.nightsKeptDays.filter((day) => inYear(day, year)))).sort();

  const perMonth = new Map<number, number>();
  for (const day of nights) {
    const month = Number(day.slice(5, 7)) - 1;
    perMonth.set(month, (perMonth.get(month) ?? 0) + 1);
  }
  const ranked = [...perMonth.entries()].sort((a, b) => b[1] - a[1]);
  const busiestMonth = ranked.length > 0 && (ranked.length === 1 || ranked[0]![1] > ranked[1]![1])
    ? MONTHS[ranked[0]![0]] ?? null
    : null;

  const crawls = input.crawls
    .map((crawl) => ({ crawl, day: crawlDay(crawl) }))
    .filter((entry): entry is { crawl: PalYearCrawl; day: string } => entry.day !== null && inYear(entry.day, year));

  let stopsWalked = 0;
  const crawlsPerVenue = new Map<string, number>();
  for (const { crawl } of crawls) {
    const visited = new Set(crawl.visited.filter((id) => crawl.stopIds.includes(id)));
    stopsWalked += visited.size;
    for (const id of visited) crawlsPerVenue.set(id, (crawlsPerVenue.get(id) ?? 0) + 1);
  }
  const top = [...crawlsPerVenue.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  const favourite = top && top[1] >= 2 ? { venueId: top[0], visits: top[1] } : null;

  const firstCrawl = [...crawls].sort((a, b) => a.day.localeCompare(b.day))[0];
  const firstKept = nights[0];
  let firstNight: PalYearFacts["firstNight"] = null;
  if (firstCrawl && (!firstKept || firstCrawl.day <= firstKept)) {
    firstNight = { day: firstCrawl.day, firstStopVenueId: firstCrawl.crawl.stopIds[0] ?? null };
  } else if (firstKept) {
    firstNight = { day: firstKept, firstStopVenueId: null };
  }

  return {
    year,
    nightsKept: nights.length,
    busiestMonth,
    stopsWalked,
    favourite,
    firstNight,
    pricesMapped: Math.max(0, Math.floor(input.contributions?.pricesMapped ?? 0)),
    boroughs: Math.max(0, Math.floor(input.contributions?.boroughs ?? 0)),
  };
}

/** "18 October", from a London day. */
export function dayLabel(day: string): string {
  const month = MONTHS[Number(day.slice(5, 7)) - 1];
  return month ? `${Number(day.slice(8, 10))} ${month}` : day;
}

function plural(count: number, one: string, many: string): string {
  return count === 1 ? `one ${one}` : `${count} ${many}`;
}

/**
 * What the Pal says about the year, one fact a line, in its own voice. A pub
 * with no known name is left out of its line rather than guessed.
 */
export function palYearLines(facts: PalYearFacts, venueNames: Readonly<Record<string, string>>): string[] {
  const lines: string[] = [];
  if (facts.nightsKept > 0) {
    const kept = plural(facts.nightsKept, "night", "nights");
    lines.push(`We kept ${kept} together this year.`);
    if (facts.busiestMonth && facts.nightsKept > 1) lines.push(`${facts.busiestMonth} was our busiest month.`);
  }
  if (facts.stopsWalked > 0) lines.push(`We walked ${plural(facts.stopsWalked, "stop", "stops")}.`);
  const favourite = facts.favourite ? venueNames[facts.favourite.venueId] : undefined;
  if (facts.favourite && favourite) lines.push(`You kept coming back to ${favourite}. ${facts.favourite.visits} crawls in all.`);
  if (facts.firstNight) {
    const first = facts.firstNight.firstStopVenueId ? venueNames[facts.firstNight.firstStopVenueId] : undefined;
    lines.push(first
      ? `Our first night was ${dayLabel(facts.firstNight.day)}, starting at ${first}.`
      : `Our first night was ${dayLabel(facts.firstNight.day)}.`);
  }
  if (facts.pricesMapped > 0) {
    const where = facts.boroughs > 1 ? ` across ${facts.boroughs} boroughs` : "";
    lines.push(`You have mapped ${plural(facts.pricesMapped, "price", "prices")}${where} so far. Every one helps the next person.`);
  }
  return lines;
}
