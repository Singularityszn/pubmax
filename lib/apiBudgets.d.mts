export declare const API_BUDGET_METRICS: readonly ["p50Ms", "p95Ms"];

export type ApiBudgetMetric = (typeof API_BUDGET_METRICS)[number];

export type ApiJsonFieldType = "array" | "object" | "string" | "number" | "boolean";

export declare const API_BUDGET_METRIC_LABELS: Record<ApiBudgetMetric, string>;

export type ApiRouteBudget = {
  path: string;
  why: string;
  requiredJsonFields: Readonly<Record<string, ApiJsonFieldType>>;
  sampleCount?: number;
  sampleNote?: string;
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

export declare const API_BUDGETS: ApiBudgets;

export type ApiRouteMeasurement = Record<ApiBudgetMetric, number>;

export type ApiBudgetBreach = {
  path: string;
  metric: ApiBudgetMetric;
  measured: number;
  budget: number;
  overBy: number;
};

export declare function percentile(
  samples: readonly number[],
  fraction: number,
): number;

export declare function findApiBudgetBreaches(
  budgets: readonly ApiRouteBudget[],
  measured: ReadonlyMap<string, ApiRouteMeasurement>,
): ApiBudgetBreach[];

export declare function formatApiBreachTable(
  breaches: readonly ApiBudgetBreach[],
): string;

export declare function formatApiMeasurementTable(
  budgets: readonly ApiRouteBudget[],
  measured: ReadonlyMap<string, ApiRouteMeasurement>,
): string;
