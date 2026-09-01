// What a hot READ is allowed to make a reader wait for.
//
// perf/route-budgets.json holds what a PAGE costs; this is the same discipline
// one layer down, for the public GETs the map, Today and Out spend on arrival.
// A page can hold every byte budget it has and still feel slow because the read
// behind it took a second.
//
// Pure and data-only, exactly like lib/performanceBudgets.ts: the probing lives
// in scripts/probe-api-budgets.mjs so the rules are unit-testable without a
// network. docs/PERFORMANCE_BUDGETS.md owns the rule for changing a number, and
// it is the same rule: down is free, up is a decision.

import budgetsJson from "../perf/api-budgets.json" with { type: "json" };

/** The two percentiles a read is judged on. */
export const API_BUDGET_METRICS = ["p50Ms", "p95Ms"] as const;

export type ApiBudgetMetric = (typeof API_BUDGET_METRICS)[number];

export const API_BUDGET_METRIC_LABELS: Record<ApiBudgetMetric, string> = {
  p50Ms: "p50 (ms)",
  p95Ms: "p95 (ms)",
};

export type ApiRouteBudget = {
  /** The path probed, exactly as a surface would request it. */
  path: string;
  /** Why this read is on the list, in one sentence. */
  why: string;
  /** What the seed sweep measured, kept so a later ratchet has its baseline. */
  seedP50Ms: number;
  seedP95Ms: number;
} & Record<ApiBudgetMetric, number>;

export type ApiBudgetMethod = {
  samples: number;
  warmupSamples: number;
  measure: string;
  target: string;
  countedUpTo: string;
};

export type ApiBudgets = {
  note: string;
  method: ApiBudgetMethod;
  routes: ApiRouteBudget[];
};

export const API_BUDGETS = budgetsJson as ApiBudgets;

export type ApiRouteMeasurement = Record<ApiBudgetMetric, number>;

export type ApiBudgetBreach = {
  path: string;
  metric: ApiBudgetMetric;
  measured: number;
  budget: number;
  overBy: number;
};

/**
 * The percentile of a sample set, nearest-rank. Exported because a probe and a
 * test must agree on what "p95 of twelve samples" means: with 12 samples that
 * is the 12th, so one slow answer in twelve is a breach rather than a rounding
 * argument.
 */
export function percentile(samples: readonly number[], fraction: number): number {
  if (samples.length === 0) return Number.NaN;
  const sorted = [...samples].sort((a, b) => a - b);
  const rank = Math.ceil(fraction * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/**
 * Every metric a probe put past its ceiling. A route with no measurement is NOT
 * a pass, for the reason the page budgets give: a budget nothing checked is not
 * a budget.
 */
export function findApiBudgetBreaches(
  budgets: readonly ApiRouteBudget[],
  measured: ReadonlyMap<string, ApiRouteMeasurement>,
): ApiBudgetBreach[] {
  const breaches: ApiBudgetBreach[] = [];
  for (const route of budgets) {
    const measurement = measured.get(route.path);
    for (const metric of API_BUDGET_METRICS) {
      const budget = route[metric];
      if (!measurement) {
        breaches.push({
          path: route.path,
          metric,
          measured: Number.NaN,
          budget,
          overBy: Number.NaN,
        });
        continue;
      }
      const value = measurement[metric];
      if (value <= budget) continue;
      breaches.push({
        path: route.path,
        metric,
        measured: value,
        budget,
        overBy: Math.round(((value - budget) / budget) * 100),
      });
    }
  }
  return breaches;
}

function pad(value: string, width: number): string {
  return value.length >= width ? value : value + " ".repeat(width - value.length);
}

function figure(value: number): string {
  return Number.isFinite(value) ? String(Math.round(value)) : "not measured";
}

function table(header: string[], rows: string[][]): string {
  const widths = header.map((cell, column) =>
    Math.max(cell.length, ...rows.map((row) => row[column].length)),
  );
  const line = (cells: string[]) =>
    cells.map((cell, column) => pad(cell, widths[column])).join("  ").trimEnd();
  return [
    line(header),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map(line),
  ].join("\n");
}

/** The over-budget table a failing probe prints. Empty string when nothing broke. */
export function formatApiBreachTable(breaches: readonly ApiBudgetBreach[]): string {
  if (breaches.length === 0) return "";
  return table(
    ["route", "metric", "measured", "budget", "over by"],
    breaches.map((breach) => [
      breach.path,
      API_BUDGET_METRIC_LABELS[breach.metric],
      figure(breach.measured),
      figure(breach.budget),
      Number.isFinite(breach.overBy) ? `+${breach.overBy}%` : "-",
    ]),
  );
}

/** The full table a green probe prints, so the numbers are in the log either way. */
export function formatApiMeasurementTable(
  budgets: readonly ApiRouteBudget[],
  measured: ReadonlyMap<string, ApiRouteMeasurement>,
): string {
  const rows: string[][] = [];
  for (const route of budgets) {
    const measurement = measured.get(route.path);
    for (const metric of API_BUDGET_METRICS) {
      rows.push([
        route.path,
        API_BUDGET_METRIC_LABELS[metric],
        figure(measurement ? measurement[metric] : Number.NaN),
        figure(route[metric]),
      ]);
    }
  }
  return table(["route", "metric", "measured", "budget"], rows);
}
