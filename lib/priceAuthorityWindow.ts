import { DAY_MS } from "@/lib/dayMs";

/**
 * How old a price may be and still be presented to a drinker as authoritative.
 * 30 days is a pub's realistic price-change horizon.
 *
 * This is deliberately NOT a dataset's staleness budget. The two answer
 * different questions and the freshness registry owns the other one:
 *
 *   • This window is about the PRICE a drinker reads. Past it, a figure stops
 *     speaking for tonight: a community price leaves the map, and a bundled
 *     dataset price is presented as an estimate rather than a current price.
 *   • `stalenessBudgetHours` in data/freshness_registry.json is an outer-bound
 *     NEGLECT ceiling, so a genuinely abandoned feed alarms the release gate
 *     (see #797). An episodic feed re-collected by hand may sit well past this
 *     window without anybody having neglected it.
 *
 * Merging them makes one number serve two owners, so tightening what a drinker
 * is told would turn the release gate red, and relaxing the gate would quietly
 * let an old price read as current.
 *
 * This module imports one leaf constant so every price surface can read the
 * window without pulling a price lane's whole module in behind it.
 */
export const PRICE_AUTHORITY_MAX_AGE_MS = 30 * DAY_MS;

/** The same window in days, for surfaces that count in days. */
export const PRICE_AUTHORITY_MAX_AGE_DAYS =
  PRICE_AUTHORITY_MAX_AGE_MS / DAY_MS;
