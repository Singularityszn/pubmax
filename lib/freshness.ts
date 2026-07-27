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
  | { readonly kind: "literal"; readonly value: string; readonly consumedBy?: string }
  | null;

export type FreshnessClass =
  | "cron"
  | "episodic"
  | "user-cadence"
  | "live"
  | "static"
  | "snapshot";

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
 * What the caller found where a dataset's artifact was meant to be. Carrying the
 * outcome (rather than just the parsed JSON, or undefined) is what lets an
 * unresolvable stamp say WHY it is unresolvable: "the file is not in this
 * deployment" and "the file is here but carries no generatedAt" are different
 * defects with different owners, and an audit that cannot tell them apart cannot
 * be acted on. `absent` means the dataset declares no artifact path at all.
 */
export type ArtifactRead =
  | { readonly kind: "absent" }
  | { readonly kind: "missing"; readonly path: string }
  | { readonly kind: "unreadable"; readonly path: string; readonly error: string }
  | { readonly kind: "ok"; readonly path: string; readonly json: unknown };

/** A resolved stamp, or null plus the reason nothing could be resolved. */
export interface StampResolution {
  readonly observedAt: string | null;
  /** Null when observedAt resolved, or when the dataset declares no stamp. */
  readonly reason: string | null;
}

/**
 * Resolve the observed timestamp for one dataset from what the caller read off
 * disk, reporting the reason when it cannot. A dataset with no stamp spec
 * resolves to null with no reason: that is "nothing was promised", not a defect.
 */
export function resolveStamp(spec: FreshnessStampSpec, read: ArtifactRead): StampResolution {
  if (spec === null) return { observedAt: null, reason: null };

  if (spec.kind === "literal") {
    if (Number.isFinite(Date.parse(spec.value))) return { observedAt: spec.value, reason: null };
    return {
      observedAt: null,
      reason: `The registry's literal stamp "${spec.value}" is not a parseable date.`,
    };
  }

  // kind === "field": the stamp lives in the artifact, so the read decides.
  switch (read.kind) {
    case "absent":
      return {
        observedAt: null,
        reason: `The registry declares a "${spec.pointer}" stamp but no artifact to read it from.`,
      };
    case "missing":
      return {
        observedAt: null,
        reason: `Artifact ${read.path} is not present at runtime, so its age cannot be measured.`,
      };
    case "unreadable":
      return {
        observedAt: null,
        reason: `Artifact ${read.path} could not be parsed: ${read.error}`,
      };
    case "ok": {
      const json = read.json;
      const value =
        typeof json === "object" && json !== null
          ? (json as Record<string, unknown>)[spec.pointer]
          : undefined;
      if (typeof value === "string" && Number.isFinite(Date.parse(value))) {
        return { observedAt: value, reason: null };
      }
      return {
        observedAt: null,
        reason: `Artifact ${read.path} carries no parseable "${spec.pointer}" field.`,
      };
    }
  }
}

/**
 * Resolve the observed timestamp from an (already-parsed) artifact JSON, with no
 * reason attached. The thin form for callers that hold the JSON and nothing
 * else, chiefly lib/dataFreshness.ts reading a literal stamp. Prefer
 * `resolveStamp` anywhere the answer might be reported to a human.
 */
export function resolveObservedAt(
  spec: FreshnessStampSpec,
  artifactJson: unknown,
): string | null {
  const read: ArtifactRead =
    artifactJson === undefined ? { kind: "absent" } : { kind: "ok", path: "", json: artifactJson };
  return resolveStamp(spec, read).observedAt;
}

/**
 * Pure evaluation of a single dataset. `observedAt` is the already-resolved
 * stamp (or null), `now` the reference instant. No disk, no clock.
 *
 * `unresolvedReason` is the per-feed explanation from `resolveStamp`; pass it
 * whenever one exists so an "unknown" says which artifact failed and how,
 * instead of the same unactionable sentence for every feed at once.
 */
export function evaluateDataset(
  dataset: FreshnessDataset,
  observedAt: string | null,
  now: Date,
  unresolvedReason: string | null = null,
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
  // problem (missing/broken artifact) — surface it, never silently pass. This
  // is NOT the same finding as "stale": the data may be perfectly current and
  // the audit simply unable to see it, so callers must report the two apart.
  if (dataset.stamp !== null && observedAt === null) {
    return {
      ...base,
      ageHours: null,
      status: "unknown",
      detail:
        unresolvedReason ?? "Expected a timestamp but none could be resolved from the artifact.",
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
 * Evaluate a whole registry. `stampFor` returns the resolution for a dataset
 * (the caller wires it to disk reads; tests pass a plain map). Pure given its
 * inputs.
 */
export function evaluateRegistry(
  registry: FreshnessRegistry,
  stampFor: (dataset: FreshnessDataset) => StampResolution,
  now: Date,
): FreshnessResult[] {
  return registry.datasets.map((dataset) => {
    const { observedAt, reason } = stampFor(dataset);
    return evaluateDataset(dataset, observedAt, now, reason);
  });
}

/**
 * The two findings this spine can make, kept apart on purpose. A stale feed
 * means the DATA is old and a refresh job owes us a run; an unresolved feed
 * means the AUDIT cannot see the data at all and says nothing about its age.
 * Reporting them as one number is how eleven blind spots hid two real breaches.
 */
export function staleFeeds(results: readonly FreshnessResult[]): FreshnessResult[] {
  return results.filter((r) => r.status === "stale");
}

/** Feeds that promised a stamp and could not produce one. Never "fresh". */
export function unresolvedFeeds(results: readonly FreshnessResult[]): FreshnessResult[] {
  return results.filter((r) => r.status === "unknown");
}

/** True when any result is a hard breach (stale) or a broken artifact (unknown). */
export function hasBreach(results: readonly FreshnessResult[]): boolean {
  return results.some((r) => r.status === "stale" || r.status === "unknown");
}
