// Honest data-freshness helpers (Wave S3, tightened by the SEO integrity
// cleanup). The fact layer must stamp every derived stat with WHEN the
// underlying prices were collected — never a fabricated "live" timestamp and
// never a build artifact dressed up as a collection date.
//
// Two distinct signals, deliberately kept apart:
//   • PINT_DATASET_OBSERVED_AT — the dataset's real collection date. Drives
//     every dataset-wide "collected" stamp and the JSON-LD dates. One pub's
//     listed price is dated by its own row's `scraped_at_values`
//     (`answerEvidenceFor` in lib/landingHero.ts), never by this, because a
//     re-collection re-dates only the rows its source still states.
//   • The bundled file's mtime says only "this file was last written" (builds,
//     re-exports), never when prices were collected; app/sitemap.ts derives its
//     `lastModified` from that mtime with its own local helper.
//
// Pure formatters live in lib/dataFreshnessFormat.ts. This module re-exports
// them for compatibility. Formatter-only callers import that leaf directly
// to avoid loading the registry.

import freshnessRegistry from "@/data/freshness_registry.json";
import { resolveObservedAt, type FreshnessRegistry } from "@/lib/freshness";
import { PRICE_AUTHORITY_MAX_AGE_DAYS } from "@/lib/priceAuthorityWindow";
import { formatObservedDate, formatSnapshotFrom } from "@/lib/dataFreshnessFormat";

export { formatMonthYear, formatObservedDate, formatObservedDayShort, formatSnapshotFrom, isoDate, SNAPSHOT_CAPTION_PREFIX } from "@/lib/dataFreshnessFormat";

/** The bundled London pint-price dataset every borough/index page reads. */
export const PINT_DATASET_FILE = "pint_prices_app_dataset.json";

/** Registry id of the bundled pint-price dataset entry (the stamp we read). */
const PINT_DATASET_REGISTRY_ID = "pint_prices";

const registry = freshnessRegistry as unknown as FreshnessRegistry;

function stalenessBudgetDays(id: string): number {
  const hours = registry.datasets.find((dataset) => dataset.id === id)?.stalenessBudgetHours;
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0) {
    throw new Error(
      `data/freshness_registry.json: '${id}' is missing a positive staleness budget`,
    );
  }
  return hours / 24;
}

/**
 * The bundled dataset's NEGLECT ceiling, straight off the freshness registry:
 * how long the bundle may go un-re-collected before the release gate alarms
 * (scripts/check_freshness.mjs, run by the freshness job in CI).
 *
 * It must never decide what a drinker is told about a price. That question is
 * PINT_DATASET_PRESENTATION_BUDGET_DAYS below, and it is a tighter, separately
 * owned window. Pointing a surface at this constant makes tightening the
 * drinker-facing claim turn the release gate red as a side effect.
 */
export const PINT_DATASET_STALENESS_BUDGET_DAYS = stalenessBudgetDays(
  PINT_DATASET_REGISTRY_ID,
);

/**
 * How old a bundled dataset price may be and still read to a drinker as a
 * current price. Past it the menu presents the figure as an estimate, dated
 * with when it was last seen.
 *
 * This is the shared price-authority window, NOT the registry budget above.
 * The registry budget is a neglect ceiling that decides when the release gate
 * alarms about nobody re-collecting the bundle; this decides what a drinker is
 * told about a figure. One number cannot answer both: the bundle is collected
 * by hand and episodically, so it sits past the drinker-facing window long
 * before anybody has neglected it.
 */
export const PINT_DATASET_PRESENTATION_BUDGET_DAYS =
  PRICE_AUTHORITY_MAX_AGE_DAYS;

/**
 * Resolve the pint dataset's collection stamp from the freshness registry —
 * the single source of truth for WHEN the bundled prices were collected. The
 * registry entry (data/freshness_registry.json → `pint_prices`) carries the
 * literal stamp; this is a build-time import (webpack inlines the JSON), so
 * both server and client bundles get the same value with no disk access at
 * runtime. Fails loud at module load if the entry is missing or unparseable —
 * a broken registry is a build break, never a silently wrong "collected" date.
 *
 * The stamp is stored date-only, anchored at NOON UTC, so no timezone
 * conversion can move the day: the raw 23:10 UTC scrape instant (recorded in
 * data/README.md) is already 4 July in Europe/London, which would make the
 * visible stamp ("4 July 2026") disagree with the JSON-LD ISO date
 * (2026-07-03). Noon UTC renders as 3 July in London (BST or GMT) and slices
 * to 2026-07-03 in ISO — one day, everywhere; a drift test pins the constant
 * to the registry value and a regression test pins the two representations
 * together. The stamp is updated by the export pipeline when the dataset is
 * re-collected (scripts/export_app_dataset_json.py --collected-at), never by
 * hand-editing this file.
 */
function resolvePintDatasetObservedAt(): Date {
  const entry = registry.datasets.find((d) => d.id === PINT_DATASET_REGISTRY_ID);
  const observedAt = entry ? resolveObservedAt(entry.stamp, undefined) : null;
  if (observedAt === null) {
    throw new Error(
      `data/freshness_registry.json: '${PINT_DATASET_REGISTRY_ID}' is missing a resolvable literal stamp — ` +
        "the pint dataset's collection date cannot be sourced. This registry entry is the single source of truth.",
    );
  }
  return new Date(observedAt);
}

/**
 * The calendar day the bundled dataset's prices were collected, derived at
 * build time from the freshness registry (see resolvePintDatasetObservedAt).
 * Drives every user-facing "collected" stamp and the JSON-LD dates. Keep this
 * export name stable — every consumer reads through it.
 */
export const PINT_DATASET_OBSERVED_AT = resolvePintDatasetObservedAt();

/** The bundled pint-price baseline's own snapshot caption. */
export function formatPintDatasetSnapshot(): string {
  return formatSnapshotFrom(PINT_DATASET_OBSERVED_AT);
}

/**
 * The collection date inside a sentence. This stays separate from the caption
 * so callers do not need to change its wording or case.
 */
export function formatPintDatasetAsOf(): string {
  return `with records from ${formatObservedDate(PINT_DATASET_OBSERVED_AT)}`;
}
