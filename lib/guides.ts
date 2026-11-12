// The /guides page: pub of the week, short guides and London's famous pubs.
// Pure selectors over data we already store. Nothing here ranks, scores or
// invents a pick: the pub of the week is a fixed rotation through the cited
// historic list, the guides are the hand-written crawl routes, and the famous
// pubs are the cited historic pubs with a stated age, oldest first.

import type { Route } from "next";

import { curatedCrawlMapHref, type CuratedCrawl } from "@/lib/curatedCrawls";
import { DAY_MS } from "@/lib/dayMs";
import type { HistoricPub } from "@/lib/historic";
import { filterAndSortHistoric } from "@/lib/historicFilter";
import { londonDayKey } from "@/lib/londonHour";

export const GUIDES_PATH = "/guides" as const;

export const GUIDES_TITLE = "Pub of the week, guides and famous pubs";

const SHORT_GUIDE_LIMIT = 6;
const FAMOUS_PUB_LIMIT = 10;

/** A step that is coprime with the list length visits every pub once per lap. */
const ROTATION_STEP_START = 37;

export type PubOfTheWeek = {
  pub: HistoricPub & { venueId: string };
  /** The citation of the sentence the hook is. A pub without one is passed over. */
  sourceHref: string;
  /** Monday of the London week the pick belongs to, as YYYY-MM-DD. */
  weekStartsOn: string;
};

export type ShortGuide = {
  id: string;
  name: string;
  blurb: string;
  stops: number;
  href: Route;
};

function isOpenAndOnTheMap(pub: HistoricPub): pub is HistoricPub & { venueId: string } {
  return typeof pub.venueId === "string" && pub.venueId.length > 0 && !pub.venueStatus;
}

/**
 * Words that say a hook describes a pub that has stopped pouring. "A former
 * warehouse" is a building's past, not a closed pub, so "former" counts only
 * in front of a pub word.
 */
const GONE_PUB_RE = /\bformer(?:ly)?\s+(?:\w+\s+)?(?:pub|public house|tavern|inn)\b|\b(?:closed|demolished)\b/i;

/**
 * The cited fact a pub's hook is lifted from, when that fact is prose worth a
 * week: a Wikipedia sentence or our own cited line. A Wikidata description
 * ("building in United Kingdom") is a label, not a story, so it never leads.
 */
function storyFact(pub: HistoricPub): { sourceRef: string } | null {
  const hook = pub.hook.trim();
  if (!hook || GONE_PUB_RE.test(hook)) return null;
  const fact = pub.facts.find(
    (candidate) => candidate.fact.trim() === hook && candidate.source !== "wikidata",
  );
  return fact?.sourceRef ? { sourceRef: fact.sourceRef } : null;
}

function greatestCommonDivisor(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) [x, y] = [y, x % y];
  return x;
}

/**
 * London calendar days since 1 January 1970. The day is read on the London
 * wall clock, so the week turns at London midnight in winter and in summer.
 */
function londonDayNumber(now: Date): number {
  return Math.round(Date.parse(`${londonDayKey(now)}T00:00:00.000Z`) / DAY_MS);
}

/**
 * The London week, counted from the week of 1 January 1970. Weeks start on
 * Monday. 1 January 1970 was a Thursday, so the three days before it close out
 * week 0.
 */
export function londonWeekNumber(now: Date): number {
  return Math.floor((londonDayNumber(now) + 3) / 7);
}

function londonWeekStartKey(week: number): string {
  return new Date((week * 7 - 3) * DAY_MS).toISOString().slice(0, 10);
}

/**
 * This week's pub: one open historic pub that is on the map and whose hook is
 * a cited sentence. The list is ordered by slug, then walked with a fixed
 * step, so the pick is the same for every reader all week, changes each
 * Monday, and reaches every pub before it repeats one.
 */
export function pickPubOfTheWeek(pubs: readonly HistoricPub[], now: Date): PubOfTheWeek | null {
  const eligible = pubs
    .filter(isOpenAndOnTheMap)
    .flatMap((pub) => {
      const fact = storyFact(pub);
      return fact ? [{ pub, sourceHref: fact.sourceRef }] : [];
    })
    .sort((a, b) => (a.pub.slug < b.pub.slug ? -1 : a.pub.slug > b.pub.slug ? 1 : 0));
  if (eligible.length === 0) return null;

  let step = ROTATION_STEP_START;
  while (greatestCommonDivisor(step, eligible.length) !== 1) step += 1;

  const week = londonWeekNumber(now);
  const index = (((week * step) % eligible.length) + eligible.length) % eligible.length;
  const entry = eligible[index];
  if (!entry) return null;
  return {
    ...entry,
    weekStartsOn: londonWeekStartKey(week),
  };
}

/** "9 November", for the Monday a week starts on. */
export function weekStartLabel(weekStartsOn: string): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${weekStartsOn}T12:00:00.000Z`));
}

/**
 * London's famous pubs: open historic pubs on the map whose cited record
 * states their age and tells their story in a sentence, oldest first.
 */
export function londonFamousPubs(
  pubs: HistoricPub[],
  limit: number = FAMOUS_PUB_LIMIT,
): Array<HistoricPub & { venueId: string }> {
  return filterAndSortHistoric(pubs, {
    borough: null,
    listedOnly: false,
    hasDate: true,
    sort: "oldest",
  })
    .filter(isOpenAndOnTheMap)
    .filter((pub) => storyFact(pub) !== null)
    .slice(0, limit);
}

/** The first hand-written crawl routes, in the order they were written. */
export function shortGuides(
  crawls: readonly CuratedCrawl[],
  limit: number = SHORT_GUIDE_LIMIT,
): ShortGuide[] {
  return crawls
    .filter((crawl) => crawl.venueIds.length > 0 && crawl.blurb.trim().length > 0)
    .slice(0, limit)
    .map((crawl) => ({
      id: crawl.id,
      name: crawl.name,
      blurb: crawl.blurb,
      stops: crawl.venueIds.length,
      href: curatedCrawlMapHref(crawl),
    }));
}

/** A pub's map door, the one the historic pages use. */
export function guidePubMapHref(venueId: string): Route {
  return `/map?sel=${encodeURIComponent(venueId)}` as Route;
}

/** A historic pub's own page. */
export function guidePubStoryHref(slug: string): Route {
  return `/historic/${encodeURIComponent(slug)}` as Route;
}
