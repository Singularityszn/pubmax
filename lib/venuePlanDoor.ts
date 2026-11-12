import { freshestCommunityPrice, isWithinMaxAge, type CommunityPrice } from "@/lib/communityPrice";
import { LANDING_RECEIPT_LABEL } from "@/lib/landingHero";
import type { CrawlMode, SummaryDrop } from "@/lib/venues";

/**
 * THE VENUE SHEET'S DOORS: ONE CORAL, AND IT ASKS FOR WHAT THE PUB LACKS
 * (captain decision D4 (c), 11 Nov 2026, reversing the owner call of 16 Oct).
 *
 * The action card (components/map/inspector/VenueActionCard.tsx) is the sheet's
 * footer on a phone and the drawer's sticky top from 641px, so this table is
 * read at every width:
 *
 *   no drinker price from the last 30 days -> the coral is `Log what you paid`,
 *                                             and the plan door is a ghost in
 *                                             the card's action row
 *   a fresh drinker price                  -> the coral is the plan door
 *
 * A fresh drinker price is a priced, non-demo Pint Drop logged within 30 days,
 * or a price logged through the price form in any drink category within that
 * window (lib/communityPrice.ts). The report date decides freshness, never
 * the confirmation date or trust state. A listed, sourced or estimated figure
 * is a publisher's or ours, never a drinker's, so it does not count.
 * Until the reads answer, nothing counts, and the pub asks.
 *
 * THE PLAN DOOR FOLLOWS THE CRAWL, wherever it sits:
 *
 *   no crawl in progress  -> `Make it Stop 1`, which hands the pub to Plan
 *   a crawl in progress   -> `Plan stop` / `In plan`, which adds the pub to or
 *                            removes it from the crawl on the map
 *
 * A crawl is in progress when the map is building one and it holds at least one
 * stop. The built list is only read in build mode (lib/pubMap.ts,
 * `builtStopCountFor`), so a suggest-mode leftover is no crawl. There is no
 * latch: removing the last stop ends the crawl, and the door reads
 * `Make it Stop 1` again on the same render. The name keeps "phone" because
 * the rule was the phone's first.
 */

const MAKE_IT_STOP_1_LABEL = "Make it Stop 1";
const PLAN_STOP_LABEL = "Plan stop";
const IN_PLAN_LABEL = "In plan";

export type VenuePlanDoor =
  | { kind: "stop-1"; label: typeof MAKE_IT_STOP_1_LABEL }
  | {
      kind: "crawl";
      label: typeof PLAN_STOP_LABEL | typeof IN_PLAN_LABEL;
      inCrawl: boolean;
    };

export function crawlInProgress(input: { mode: CrawlMode; builtCount: number }): boolean {
  return input.mode === "build" && input.builtCount > 0;
}

/**
 * The one plan door a phone pub sheet shows, or null when the sheet shows none
 * (not a pub, or no crawl to add to and no Stop 1 acceptance on offer).
 */
export function phoneVenuePlanDoor(input: {
  isPub: boolean;
  mode: CrawlMode;
  builtIds: readonly string[];
  venueId: string;
  canAcceptStop1: boolean;
}): VenuePlanDoor | null {
  if (!input.isPub) return null;
  if (crawlInProgress({ mode: input.mode, builtCount: input.builtIds.length })) {
    const inCrawl = input.builtIds.includes(input.venueId);
    return { kind: "crawl", label: inCrawl ? IN_PLAN_LABEL : PLAN_STOP_LABEL, inCrawl };
  }
  return input.canAcceptStop1 ? { kind: "stop-1", label: MAKE_IT_STOP_1_LABEL } : null;
}

/** The coral door a pub without a fresh drinker price shows. One wording, everywhere. */
export const LOG_WHAT_YOU_PAID_LABEL = LANDING_RECEIPT_LABEL;

export function hasFreshDrinkerPrice(
  input: {
    drops: readonly Pick<SummaryDrop, "createdAt" | "priceGbp" | "provenance">[] | undefined;
    communityPrices: readonly CommunityPrice[] | undefined;
  },
  now: number = Date.now(),
): boolean {
  const freshDrop = input.drops?.some((drop) => {
    const submittedAt = Date.parse(drop.createdAt);
    return drop.provenance !== "demo"
      && typeof drop.priceGbp === "number" && Number.isFinite(drop.priceGbp) && drop.priceGbp > 0
      && submittedAt <= now && isWithinMaxAge({ submittedAt }, now);
  });
  if (freshDrop) return true;
  const price = freshestCommunityPrice(input.communityPrices);
  return price !== null && price.submittedAt <= now && isWithinMaxAge(price, now);
}

export type VenueSheetDoors = {
  /** True when the coral is `Log what you paid` and the plan door is a ghost. */
  logFirst: boolean;
  planDoor: VenuePlanDoor | null;
};

/** The card's coral and its plan door, as the table above decides them. */
export function venueSheetDoors(
  input: Parameters<typeof phoneVenuePlanDoor>[0] & { freshDrinkerPrice: boolean },
): VenueSheetDoors {
  return {
    logFirst: input.isPub && !input.freshDrinkerPrice,
    planDoor: phoneVenuePlanDoor(input),
  };
}
