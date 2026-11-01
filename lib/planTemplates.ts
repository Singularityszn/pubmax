// Sort My Night P1 — occasion templates. Pre-shaped plan titles + concierge
// seed queries so crews start from a job ("watch the match") instead of a blank
// form. Pure data; PlanComposer applies them into draft fields.

import { londonDayKey } from "@/lib/pintContributions";

export type PlanTemplate = {
  id: string;
  label: string;
  title: string;
  /** Prefills the concierge "Suggest a crawl" box. */
  conciergeQuery: string;
  blurb: string;
};

export const PLAN_TEMPLATES: readonly PlanTemplate[] = [
  {
    id: "watch-the-match",
    label: "Watch the match",
    title: "Match night",
    conciergeQuery: "pubs screening live sport tonight in Clapham",
    blurb: "Screens and a pint before kick-off.",
  },
  {
    id: "leaving-do",
    label: "Leaving do",
    title: "Leaving do",
    conciergeQuery: "lively pubs in Canary Wharf for a leaving do of 8",
    blurb: "A short, sociable loop for the send-off.",
  },
  {
    id: "birthday-ten",
    label: "Birthday for 10",
    title: "Birthday round",
    conciergeQuery: "roomy pubs in Clapham good for a birthday of about 10",
    blurb: "Space for the group without a booking war.",
  },
  {
    id: "quiz-night",
    label: "Quiz night",
    title: "Quiz night",
    conciergeQuery: "pub quiz tonight in Chiswick",
    blurb: "Quiz listings with start times.",
  },
  {
    id: "cheap-round",
    label: "Cheap round",
    title: "Cheap round tonight",
    conciergeQuery: "deal nights and cheap pints tonight in Victoria",
    blurb: "Deal days and honest pint prices.",
  },
  {
    id: "client-dinner",
    label: "Client dinner",
    title: "Client dinner",
    conciergeQuery: "quieter gastropubs in Canary Wharf good for a client dinner",
    blurb: "Calmer rooms, proper food, easy exit.",
  },
] as const;

// THE CHRISTMAS CRAWL IS SEASONAL, AND IT IS THE CREW'S CHRISTMAS, NEVER THE
// PUB'S. Its words ask for roomy pubs and cheap pints, which the generator
// reads (budget, group size, area). Nothing in it says a pub has a Christmas
// event, decorations or a menu, because we hold no such fact for any pub, and
// the generator still answers only from the venue record it always reads.
const CHRISTMAS_CRAWL_TEMPLATE: PlanTemplate = {
  id: "christmas-crawl",
  label: "Christmas crawl",
  title: "Christmas crawl",
  conciergeQuery: "roomy pubs with cheap pints in Victoria for 8, a Christmas crawl",
  blurb: "Cheap listed pints for the group. Ring ahead for a big table.",
};

/** The Christmas crawl's window, as London calendar days (month-day), both ends kept. */
const CHRISTMAS_CRAWL_FIRST_DAY = "11-15";
const CHRISTMAS_CRAWL_LAST_DAY = "12-24";

/**
 * True from 15 November to 24 December, both days kept, on the London
 * calendar, every year. A reader abroad gets London's date, because the pubs
 * are in London. An unreadable instant is out of season.
 */
export function christmasCrawlInSeason(now: Date): boolean {
  const day = londonDayKey(now).slice(5);
  return day.length === 5 && day >= CHRISTMAS_CRAWL_FIRST_DAY && day <= CHRISTMAS_CRAWL_LAST_DAY;
}

/** The templates on offer: the Christmas crawl leads in its window, and is absent outside it. */
export function planTemplatesFor(christmasInSeason: boolean): readonly PlanTemplate[] {
  return christmasInSeason ? [CHRISTMAS_CRAWL_TEMPLATE, ...PLAN_TEMPLATES] : PLAN_TEMPLATES;
}

export function planTemplateById(id: string): PlanTemplate | null {
  return PLAN_TEMPLATES.find((t) => t.id === id) ?? null;
}
