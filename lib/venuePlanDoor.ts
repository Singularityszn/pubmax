import type { CrawlMode } from "@/lib/venues";

/**
 * THE PHONE PUB SHEET HAS ONE PLAN DOOR, AND IT FOLLOWS THE CRAWL (owner
 * decision, option C, 16 Oct 2026).
 *
 * A phone sheet used to offer up to three plan controls at once: the peek's
 * painted `Plan stop`, a `Make it Stop 1` ghost and, in build mode, a `Crawl`
 * ghost, two of them calling the same toggle. Now the peek carries ONE coral
 * door and this table is the whole of what it says:
 *
 *   no crawl in progress  -> `Make it Stop 1`, which hands the pub to Plan
 *   a crawl in progress   -> `Plan stop` / `In plan`, which adds the pub to or
 *                            removes it from the crawl on the map
 *
 * A crawl is in progress when the map is building one and it holds at least one
 * stop. The built list is only read in build mode (lib/pubMap.ts,
 * `builtStopCountFor`), so a suggest-mode leftover is no crawl. There is no
 * latch: removing the last stop ends the crawl, and the door reads
 * `Make it Stop 1` again on the same render.
 *
 * Desktop is untouched: its sheet has no peek, and its command bar keeps the
 * Stop 1 and Crawl ghosts (components/map/inspector/VenueStickyBar.tsx).
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
