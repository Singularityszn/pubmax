// THE PRICE GLASS'S POURS (round-two wild idea 01, docs/plans/DESIGN_UX_PLAN.md
// section 12). The front door's hero shows a pint glass whose fill level is a
// price, and a row of chips chooses which price it pours. This module decides
// WHICH prices those are, from the readers the landing already reads, and
// words what each one is and where it comes from.
//
// Every figure here is one the app already stands behind:
//
//   - London: the average of each pub's cheapest listed pint over the listed
//     price cohort (`listedPriceCohort`, lib/pricedPubCount.ts), the very mean
//     the landing's saving line prints (`pintPriceAverages`, lib/pintSavings.ts).
//   - Cheapest: London's row of the hunt (lib/cheapestHunt.ts), which alone
//     decides which pint may be called the cheapest. The hunt is read by the
//     front door's own wiring and nothing else (__tests__/cheapestHunt.test.ts
//     names its readers), so app/page.tsx hands its two London pints over as
//     plain `PriceGlassPint` values and this module never imports it.
//   - A borough: the median of the same cohort's cheapest pints inside it, by
//     the house median (`median`, lib/zones.ts) and only where at least
//     `MIN_PRICED_VENUES` pubs back it, the same floor a fare-zone median needs.
//   - Dearest: the hunt's London dearest, the pub whose cheapest pint costs the
//     most, never a cocktail or a bottle.
//
// Each pour carries its own source line: who listed the one pint, or the read
// range of the pubs an average or a median is taken over. A missing read stays
// missing: an undated pub is counted out loud, never folded into the range.
//
// Pure: no fs, no React. lib/wildPriceGlass.server.ts wires the real reads, and
// the client glass (components/wild/PriceGlass.tsx) imports only the types.

import type { Route } from "next";

import { canonicalBorough, slugifyBorough } from "@/lib/boroughs";
import { formatObservedDate } from "@/lib/dataFreshness";
import { pintFactStats, type PricedPubLike } from "@/lib/pintFacts";
import { averageBasePhrase, listedPriceCohort, listedPriceCohortPrices } from "@/lib/pricedPubCount";
import { pintPriceAverages } from "@/lib/pintSavings";
import { PUB_LIST_BASE } from "@/lib/pubListBase";
import { median, MIN_PRICED_VENUES } from "@/lib/zones";
import type { Venue } from "@/lib/venues";

/** One run of a line: plain words, or words that link somewhere. */
export type PriceGlassText = {
  text: string;
  /** An internal page (a pub on the map). */
  href?: Route;
  /** A publisher's own page, opened in a new tab. */
  url?: string;
};

type PriceGlassPour = {
  /** Stable key: `london`, `cheapest`, `borough-<slug>`, `dearest`. */
  id: string;
  /** Which row of chips it sits in: the city's own three, or a borough. */
  group: "london" | "borough";
  /** The chip's word. */
  chip: string;
  /** The short name over the figure, such as "Hackney median". */
  title: string;
  priceGbp: number;
  /** What the figure is, in one sentence. */
  what: PriceGlassText[];
  /** Who listed it, or when the prices behind it were read. */
  source: PriceGlassText[];
};

export type WildPriceGlass = {
  /**
   * London's average first (the glass's opening pour), then its cheapest, the
   * boroughs cheapest first, then its dearest: the scale read upward.
   */
  pours: PriceGlassPour[];
  /** The glass is full at this price. */
  scaleMaxGbp: number;
};

/** A full glass. Every London figure we hold today sits under it. */
const PRICE_GLASS_SCALE_MAX_GBP = 10;

/** At most this many boroughs get a chip. */
export const PRICE_GLASS_MAX_BOROUGHS = 3;

/** What the glass reads of a pub: its kind, its borough and its cheapest pint with that row's read. */
export type PriceGlassVenue = Pick<Venue, "kind" | "cheapestPrice" | "primaryBorough"> & PricedPubLike;

/**
 * One pint the hunt names (lib/cheapestHunt.ts decides which), handed over by
 * app/page.tsx with the hunt's own source verb for its standing.
 */
export type PriceGlassPint = {
  pubName: string;
  priceGbp: number;
  /** Opens the pub on the map. */
  mapHref: Route;
  publisher: { label: string; url: string };
  /** ISO day the publisher's own row was read. */
  observedOn: string;
  /** "Listed by" or "Confirmed by" (`huntSourceVerb`). */
  sourceVerb: string;
};

function pence(value: number): number {
  return Math.round(value * 100) / 100;
}

function readDay(iso: string): string {
  const ms = Date.parse(iso.length === 10 ? `${iso}T12:00:00.000Z` : iso);
  return Number.isFinite(ms) ? formatObservedDate(new Date(ms)) : iso;
}

/**
 * When the prices under an average or a median were read: the oldest and the
 * newest read of the pubs' own cheapest pints, and a count of the pubs that
 * record no read day. Null when no pub records one.
 */
export function priceGlassReadRange(pubs: readonly PricedPubLike[]): string | null {
  const stats = pintFactStats([...pubs], "", "");
  if (!stats.oldestObservedAt || !stats.newestObservedAt) return null;
  const oldest = readDay(stats.oldestObservedAt);
  const newest = readDay(stats.newestObservedAt);
  const range =
    oldest === newest
      ? `From prices read on ${newest}.`
      : `From prices read between ${oldest} and ${newest}.`;
  if (stats.undatedCount === 0) return range;
  const undated = stats.undatedCount.toLocaleString("en-GB");
  return `${range} ${undated} of the ${stats.pubCount.toLocaleString("en-GB")} pubs ${
    stats.undatedCount === 1 ? "records" : "record"
  } no read day.`;
}

function huntSource(pint: PriceGlassPint): PriceGlassText[] {
  return [
    { text: `${pint.sourceVerb} ` },
    { text: pint.publisher.label, url: pint.publisher.url },
    { text: `, source read ${readDay(pint.observedOn)}.` },
  ];
}

function rangeSource(pubs: readonly PricedPubLike[]): PriceGlassText[] | null {
  const line = priceGlassReadRange(pubs);
  return line ? [{ text: line }] : null;
}

type BoroughMedian = { name: string; slug: string; medianGbp: number; pubs: PriceGlassVenue[] };

/**
 * Each borough's median cheapest pint over the cohort, where at least
 * `MIN_PRICED_VENUES` pubs back it. A pub with no recognised borough is left
 * out rather than guessed into one.
 */
export function boroughMedians(cohort: readonly PriceGlassVenue[]): BoroughMedian[] {
  const byBorough = new Map<string, { name: string; pubs: PriceGlassVenue[] }>();
  for (const pub of cohort) {
    const name = canonicalBorough(pub as Venue);
    if (!name) continue;
    const slug = slugifyBorough(name);
    const entry = byBorough.get(slug) ?? { name, pubs: [] };
    entry.pubs.push(pub);
    byBorough.set(slug, entry);
  }
  const out: BoroughMedian[] = [];
  for (const [slug, entry] of byBorough) {
    if (entry.pubs.length < MIN_PRICED_VENUES) continue;
    const value = median(entry.pubs.map((pub) => pub.cheapestPrice as number));
    if (value === null) continue;
    out.push({ name: entry.name, slug, medianGbp: pence(value), pubs: entry.pubs });
  }
  return out.sort((a, b) => a.medianGbp - b.medianGbp || a.name.localeCompare(b.name, "en-GB"));
}

/**
 * The boroughs that get a chip: the cheapest median and the dearest median,
 * then the boroughs with the most priced pubs until there are
 * `PRICE_GLASS_MAX_BOROUGHS`, each once, cheapest first. Both ends of the city
 * and the busiest middle of it, chosen by a rule rather than by hand.
 */
export function pickPriceGlassBoroughs(medians: readonly BoroughMedian[]): BoroughMedian[] {
  if (medians.length === 0) return [];
  const busiestFirst = [...medians].sort(
    (a, b) => b.pubs.length - a.pubs.length || a.name.localeCompare(b.name, "en-GB"),
  );
  const picked = new Map<string, BoroughMedian>();
  for (const row of [medians[0]!, medians[medians.length - 1]!, ...busiestFirst]) {
    if (picked.size >= PRICE_GLASS_MAX_BOROUGHS) break;
    picked.set(row.slug, row);
  }
  return [...picked.values()].sort(
    (a, b) => a.medianGbp - b.medianGbp || a.name.localeCompare(b.name, "en-GB"),
  );
}

function pubCountPhrase(count: number, borough: string): string {
  return `the ${count.toLocaleString("en-GB")} ${borough} ${count === 1 ? "pub" : "pubs"} in ${PUB_LIST_BASE} with a listed price`;
}

/**
 * Every pour the glass may show, or null when the data backs none. A figure
 * that cannot name its source is not poured.
 */
export function buildWildPriceGlass(input: {
  venues: readonly PriceGlassVenue[];
  /** London's cheapest pint, the hunt's London row. */
  cheapest: PriceGlassPint | null;
  /** London's dearest pint, the hunt's London dearest. */
  dearest: PriceGlassPint | null;
}): WildPriceGlass | null {
  const cohort = listedPriceCohort(input.venues);
  const pours: PriceGlassPour[] = [];

  const averages = pintPriceAverages(listedPriceCohortPrices(cohort));
  const londonSource = averages ? rangeSource(cohort) : null;
  if (averages && londonSource) {
    pours.push({
      id: "london",
      group: "london",
      chip: "Average",
      title: "London average",
      priceGbp: averages.averageGbp,
      what: [
        {
          text: `The average of each pub's cheapest listed pint, across ${averageBasePhrase(averages.sampleSize)}.`,
        },
      ],
      source: londonSource,
    });
  }

  const cheapest = input.cheapest;
  if (cheapest) {
    pours.push({
      id: "cheapest",
      group: "london",
      chip: "Cheapest",
      title: "London's cheapest",
      priceGbp: cheapest.priceGbp,
      what: [
        { text: "The cheapest listed pint in London, at " },
        { text: cheapest.pubName, href: cheapest.mapHref },
        { text: "." },
      ],
      source: huntSource(cheapest),
    });
  }

  for (const borough of pickPriceGlassBoroughs(boroughMedians(cohort))) {
    const source = rangeSource(borough.pubs);
    if (!source) continue;
    pours.push({
      id: `borough-${borough.slug}`,
      group: "borough",
      chip: borough.name,
      title: `${borough.name} median`,
      priceGbp: borough.medianGbp,
      what: [
        {
          text: `The median of each pub's cheapest listed pint, across ${pubCountPhrase(borough.pubs.length, borough.name)}.`,
        },
      ],
      source,
    });
  }

  const dearest = input.dearest;
  if (dearest) {
    pours.push({
      id: "dearest",
      group: "london",
      chip: "Dearest",
      title: "London's dearest",
      priceGbp: dearest.priceGbp,
      what: [
        { text: "London's dearest pint: the cheapest pint at " },
        { text: dearest.pubName, href: dearest.mapHref },
        { text: "." },
      ],
      source: huntSource(dearest),
    });
  }

  if (pours.length === 0) return null;
  return { pours, scaleMaxGbp: PRICE_GLASS_SCALE_MAX_GBP };
}
