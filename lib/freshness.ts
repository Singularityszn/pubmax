// Freshness spine — the machine-readable freshness registry, resolved against
// each artifact's real on-disk stamp so the app (and CI, and the owner) can see
// one honest answer to "how live is every data class?".
//
// The registry itself lives in data/freshness_registry.json (the single source
// of truth for cadence + staleness budgets). This module holds the PURE logic
// that turns a registry entry plus its artifact's observed timestamp into a
// status — no disk access, so it unit-tests on fixed Dates. The Node CLI mirror
// (scripts/check_freshness.mjs) re-implements the same tiny rules dependency-
// free, exactly the way validate-data mirrors the app's row rules.

export type FreshnessStampSpec =
  | { readonly kind: "field"; readonly pointer: string }
  | { readonly kind: "literal"; readonly value: string; readonly mirrors?: string }
  | null;

export type FreshnessClass = "cron" | "episodic" | "user-cadence" | "live" | "static";

export interface FreshnessDataset {
  readonly id: string;
  readonly label: string;
  readonly class: FreshnessClass;
  readonly artifact: string | null;
  readonly stamp: FreshnessStampSpec;
  readonly cadence: string;
  /** Hours the artifact may age before it is a breach. null = not budgeted. */
  readonly stalenessBudgetHours: number | null;
  readonly refreshWorkflow: string;
  readonly gate: string;
}

export interface FreshnessRegistry {
  readonly version: number;
  readonly datasets: readonly FreshnessDataset[];
}

/**
 * A dataset's health, kept deliberately coarse so the UI can label it directly:
 *  - live      — served per request; there is no disk artifact to age.
 *  - fresh     — within its staleness budget.
 *  - stale     — a budget breach (owner-visible; never a build break).
 *  - untracked — intentionally not budgeted (static / episodic / user-cadence).
 *  - unknown   — expected a stamp but couldn't resolve one (missing/broken file).
 */
export type FreshnessStatus = "live" | "fresh" | "stale" | "untracked" | "unknown";

export interface FreshnessResult {
  readonly id: string;
  readonly label: string;
  readonly class: FreshnessClass;
  readonly cadence: string;
  readonly refreshWorkflow: string;
  readonly gate: string;
  readonly artifact: string | null;
  readonly stalenessBudgetHours: number | null;
  /** ISO instant the artifact's data was observed/generated, when resolvable. */
  readonly observedAt: string | null;
  /** Whole-ish hours since observedAt (1dp), or null when there's no stamp. */
  readonly ageHours: number | null;
  readonly status: FreshnessStatus;
  /** Human note — why the status is what it is (esp. for unknown/untracked). */
  readonly detail: string;
}

/**
 * Resolve the observed timestamp for one dataset from its (already-parsed)
 * artifact JSON. Returns null when the dataset carries no stamp spec, or when
 * the spec points at something that isn't a parseable date. `artifactJson` may
 * be undefined when the file is missing/unreadable.
 */
export function resolveObservedAt(
  spec: FreshnessStampSpec,
  artifactJson: unknown,
): string | null {
  if (spec === null) return null;
  if (spec.kind === "literal") {
    return Number.isFinite(Date.parse(spec.value)) ? spec.value : null;
  }
  // kind === "field"
  if (typeof artifactJson !== "object" || artifactJson === null) return null;
  const value = (artifactJson as Record<string, unknown>)[spec.pointer];
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return null;
  return value;
}

/**
 * Pure evaluation of a single dataset. `observedAt` is the already-resolved
 * stamp (or null), `now` the reference instant. No disk, no clock.
 */
export function evaluateDataset(
  dataset: FreshnessDataset,
  observedAt: string | null,
  now: Date,
): FreshnessResult {
  const base = {
    id: dataset.id,
    label: dataset.label,
    class: dataset.class,
    cadence: dataset.cadence,
    refreshWorkflow: dataset.refreshWorkflow,
    gate: dataset.gate,
    artifact: dataset.artifact,
    stalenessBudgetHours: dataset.stalenessBudgetHours,
    observedAt,
  } as const;

  if (dataset.class === "live") {
    return { ...base, ageHours: null, status: "live", detail: "Served live per request." };
  }

  // A dataset that declares a stamp but couldn't produce one has a real
  // problem (missing/broken artifact) — surface it, never silently pass.
  if (dataset.stamp !== null && observedAt === null) {
    return {
      ...base,
      ageHours: null,
      status: "unknown",
      detail: "Expected a timestamp but none could be resolved from the artifact.",
    };
  }

  if (observedAt === null) {
    return {
      ...base,
      ageHours: null,
      status: "untracked",
      detail: "No stamp declared (static reference data).",
    };
  }

  const ageMs = now.getTime() - Date.parse(observedAt);
  const ageHours = Math.round((ageMs / 3_600_000) * 10) / 10;

  if (dataset.stalenessBudgetHours === null) {
    return {
      ...base,
      ageHours,
      status: "untracked",
      detail: "Intentionally not budgeted (episodic / user-cadence).",
    };
  }

  const stale = ageHours > dataset.stalenessBudgetHours;
  return {
    ...base,
    ageHours,
    status: stale ? "stale" : "fresh",
    detail: stale
      ? `Aged ${ageHours}h, over the ${dataset.stalenessBudgetHours}h budget.`
      : `Aged ${ageHours}h, within the ${dataset.stalenessBudgetHours}h budget.`,
  };
}

/**
 * Evaluate a whole registry. `stampFor` returns the resolved observedAt for a
 * dataset id (the caller wires it to disk reads; tests pass a plain map). Pure
 * given its inputs.
 */
export function evaluateRegistry(
  registry: FreshnessRegistry,
  stampFor: (dataset: FreshnessDataset) => string | null,
  now: Date,
): FreshnessResult[] {
  return registry.datasets.map((dataset) =>
    evaluateDataset(dataset, stampFor(dataset), now),
  );
}

/** True when any result is a hard breach (stale) or a broken artifact (unknown). */
export function hasBreach(results: readonly FreshnessResult[]): boolean {
  return results.some((r) => r.status === "stale" || r.status === "unknown");
}
