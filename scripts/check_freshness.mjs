// Freshness check — validates every registered artifact's observed/generated
// stamp against its declared staleness budget (data/freshness_registry.json).
//
// Two entry points:
//   • CLI (node scripts/check_freshness.mjs) — prints a table and exits NON-ZERO
//     on any breach (stale) or broken artifact (unknown). This is the owner /
//     ad-hoc gate — a cadence breach here is a real "the data went stale" signal.
//   • evaluateFreshness({ now, rootDir }) — imported by scripts/validate-data.mjs
//     to surface breaches as a WARN without ever failing the build. Cadence is
//     owner-visibility, not a build-break: a late daily cron must never block a
//     code merge, so validate-data only warns. The dedicated CLI is where a
//     non-zero exit lives.
//
// Plain Node ESM, dependency-free — it re-implements the same tiny resolve/
// evaluate rules as lib/freshness.ts (kept in lockstep), exactly the way
// validate-data mirrors the app's row rules into a scratch-copyable script.

import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(__dirname, "..");

// Mirror of lib/freshness.ts SNAPSHOT_AFTER_DAYS: past this a POINT-IN-TIME
// feed is named for the day it was collected instead of being called fresh. It
// renames only what would otherwise read "fresh", so no budget and no gate
// moves.
const SNAPSHOT_AFTER_DAYS = 30;
const SNAPSHOT_AFTER_HOURS = SNAPSHOT_AFTER_DAYS * 24;

// Mirror of lib/freshness.ts classNamesSnapshots: an `episodic` feed is
// collected by hand on a chosen day and a `user-cadence` feed grows only as
// drinkers arrive, so both describe the last observation in them rather than
// tonight. A cron or live feed is refreshed FOR us, so an old one is a budget
// question and never a change of vocabulary.
const SNAPSHOT_NAMED_CLASSES = new Set(["episodic", "user-cadence"]);

// Stale rows that warn in the CLI but never fail the dedicated freshness gate.
// area_news is hand-refreshed editorial texture; a late cron must not block verify.
// google_places_content is a paid manual push whose copied fields stay shown
// under their own dates, so an overdue refresh is a visible mark, not a red build.
const ADVISORY_STALE_IDS = new Set(["area_news", "google_places_content"]);

function isParseableDate(value) {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

// Mirror of lib/storeBackend.ts isMissingTableSchema: same PostgREST/Postgres
// schema-miss signals, checked against a raw response/error body here instead
// of a Supabase client error object.
function looksLikeMissingTableSchema(text, table) {
  return new RegExp(
    `Could not find the table 'public\\.(${table})'|relation "public\\.(${table})" does not exist|schema cache`,
    "i",
  ).test(text ?? "");
}

// WHERE EACH DURABLE FEED'S STAMP ACTUALLY LIVES.
//
// Most cron feeds stamp `feed_freshness` (migration 0047), but two keep their
// stamp in the table they serve, and reading the wrong one is how a healthy
// feed reported stale: the weather cron writes weather_snapshots, while
// public/data/weather/latest.json is a read-only fallback on Vercel that can
// only ever age. Mirror of lib/freshnessStoreOverlay.ts.
const DURABLE_FEED_SOURCES = {
  whats_on: {
    table: "whats_on_listing_generations",
    column: "generated_at",
    // The OLDEST lane dates the combined feed: one stale lane is a stale feed.
    query: "select=generated_at&order=generated_at.asc&limit=1",
    migration: "0119",
  },
  weather: {
    table: "weather_snapshots",
    column: "generated_at",
    // One batch is one write, so the newest batch is the feed's observation.
    query: "select=generated_at&order=generated_at.desc&limit=1",
    migration: "0047",
  },
};

// Mirror of lib/freshnessStoreOverlay.ts readDurableFeedStamp, dependency-free:
// a raw PostgREST fetch, gated on the same two env vars lib/supabase.ts
// requires. Never throws - every outcome is one of the four StoreRead kinds
// mirrored below.
async function readDurableFeedStamp(feedKey) {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { kind: "unconfigured" };

  const source = DURABLE_FEED_SOURCES[feedKey] ?? {
    table: "feed_freshness",
    column: "observed_at",
    query: `feed=eq.${encodeURIComponent(feedKey)}&select=observed_at&limit=1`,
    migration: "0047",
  };
  const { table, column, query, migration } = source;
  const endpoint = `${url.replace(/\/+$/, "")}/rest/v1/${table}?${query}`;
  try {
    const response = await fetch(endpoint, {
      headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json" },
    });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      if (looksLikeMissingTableSchema(body, table)) {
        return {
          kind: "unreachable",
          error: `durable table missing (apply migration ${migration}): ${response.status} ${body}`.trim(),
        };
      }
      return { kind: "unreachable", error: `${response.status} ${response.statusText}: ${body}`.trim() };
    }
    const rows = await response.json();
    const observedAt =
      Array.isArray(rows) && rows.length > 0 ? rows[0]?.[column] : undefined;
    if (!observedAt) return { kind: "empty" };
    return { kind: "ok", observedAt };
  } catch (err) {
    return { kind: "unreachable", error: err instanceof Error ? err.message : String(err) };
  }
}

// Mirror of lib/freshness.ts resolveStoreStamp.
function resolveStoreStamp(spec, read) {
  if (!spec || spec.kind !== "store") return { observedAt: null, reason: null };
  if (read.kind === "unconfigured") {
    return {
      observedAt: null,
      reason: `Durable store for "${spec.feedKey}" is unmeasurable without credentials in this runtime.`,
    };
  }
  if (read.kind === "unreachable") {
    return {
      observedAt: null,
      reason: `Durable store for "${spec.feedKey}" could not be queried: ${read.error}`,
    };
  }
  if (read.kind === "empty") {
    return {
      observedAt: null,
      reason: `Durable store holds no stamp yet for "${spec.feedKey}" (the writing cron has not succeeded).`,
    };
  }
  if (isParseableDate(read.observedAt)) return { observedAt: read.observedAt, reason: null };
  return {
    observedAt: null,
    reason: `Durable store for "${spec.feedKey}" carries an unparseable observedAt.`,
  };
}

// Mirror of lib/freshness.ts resolveStamp: resolves the stamp, and says why when
// it cannot. "The file is not there" and "the file has no generatedAt" are
// different defects, so they get different sentences here too.
function resolveStamp(spec, read) {
  if (spec === null || spec === undefined) return { observedAt: null, reason: null };
  if (spec.kind === "literal") {
    if (isParseableDate(spec.value)) return { observedAt: spec.value, reason: null };
    return {
      observedAt: null,
      reason: `The registry's literal stamp "${spec.value}" is not a parseable date.`,
    };
  }
  if (spec.kind !== "field") return { observedAt: null, reason: null };

  if (read.kind === "absent") {
    return {
      observedAt: null,
      reason: `The registry declares a "${spec.pointer}" stamp but no artifact to read it from.`,
    };
  }
  if (read.kind === "missing") {
    return {
      observedAt: null,
      reason: `Artifact ${read.path} is not present at runtime, so its age cannot be measured.`,
    };
  }
  if (read.kind === "unreadable") {
    return { observedAt: null, reason: `Artifact ${read.path} could not be parsed: ${read.error}` };
  }
  const value =
    typeof read.json === "object" && read.json !== null ? read.json[spec.pointer] : undefined;
  if (isParseableDate(value)) return { observedAt: value, reason: null };
  return {
    observedAt: null,
    reason: `Artifact ${read.path} carries no parseable "${spec.pointer}" field.`,
  };
}

// Mirror of lib/freshness.ts evaluateDataset.
function evaluateDataset(dataset, observedAt, now, unresolvedReason = null) {
  const base = {
    id: dataset.id,
    label: dataset.label,
    class: dataset.class,
    cadence: dataset.cadence,
    refreshWorkflow: dataset.refreshWorkflow,
    gate: dataset.gate,
    artifact: dataset.artifact ?? null,
    stalenessBudgetHours: dataset.stalenessBudgetHours ?? null,
    observedAt,
  };

  // Mirror of lib/freshness.ts: a live lane this spine holds no observation of
  // is `unmeasured`, never a health claim. Neither fresh nor stale, so the gate
  // below is untouched.
  if (dataset.class === "live") {
    if (observedAt === null) {
      return {
        ...base,
        ageHours: null,
        status: "unmeasured",
        detail:
          unresolvedReason ??
          "Served live per request, and this spine holds no observation of it. Only a probe can call it healthy.",
      };
    }
    return { ...base, ageHours: null, status: "live", detail: "Served live per request, and observed." };
  }
  const packUnmeasurable = dataset.pack === true && unresolvedReason !== null;
  if ((dataset.stamp || packUnmeasurable) && observedAt === null) {
    return {
      ...base,
      ageHours: null,
      status: "unknown",
      detail: unresolvedReason ?? "Expected a timestamp but none could be resolved from the artifact.",
    };
  }
  const ageHoursOf = (stamp) => Math.round(((now.getTime() - Date.parse(stamp)) / 3_600_000) * 10) / 10;

  // Mirror of lib/freshness.ts: a closed lane is asked before every answer
  // that implies a run, and after the unresolved-stamp branch, which still
  // owns "the artifact that ships has gone missing". Never a breach.
  if (dataset.retired === true) {
    return {
      ...base,
      ageHours: observedAt === null ? null : ageHoursOf(observedAt),
      status: "retired",
      detail:
        "Retired: no producer for this lane exists in this tree, so no refresh is owed " +
        "and none can be run. See refreshWorkflow and gate for what closed it.",
    };
  }

  if (observedAt === null) {
    return { ...base, ageHours: null, status: "untracked", detail: "No stamp declared (static reference data)." };
  }

  const ageHours = ageHoursOf(observedAt);

  if (base.stalenessBudgetHours === null) {
    // Mirror of lib/freshness.ts: a lane DECLARED a snapshot and given no
    // budget is one nothing may lawfully advance, so it reports the day it was
    // collected rather than being merged with unstamped static reference data.
    // A snapshot-class lane that KEEPS a budget can still be re-collected and
    // keeps its stale finding.
    if (base.class === "snapshot") {
      return {
        ...base,
        ageHours,
        status: "snapshot",
        detail:
          `Aged ${ageHours}h. A declared snapshot with no staleness budget: it reports ` +
          "the day it was collected, and no refresh is owed.",
      };
    }
    return { ...base, ageHours, status: "untracked", detail: "Intentionally not budgeted (episodic / user-cadence)." };
  }
  if (ageHours > base.stalenessBudgetHours) {
    return {
      ...base,
      ageHours,
      status: "stale",
      detail: `Aged ${ageHours}h, over the ${base.stalenessBudgetHours}h budget.`,
    };
  }
  // Mirror of lib/freshness.ts: inside the budget, a point-in-time feed past
  // the snapshot threshold is NAMED for its collection day rather than reported
  // as a current reading. Never a breach, so the gate below is untouched.
  if (SNAPSHOT_NAMED_CLASSES.has(base.class) && ageHours > SNAPSHOT_AFTER_HOURS) {
    return {
      ...base,
      ageHours,
      status: "snapshot",
      detail:
        `Aged ${ageHours}h, within the ${base.stalenessBudgetHours}h budget but over ` +
        `${SNAPSHOT_AFTER_DAYS} days old: a snapshot of its collection day, not a current reading.`,
    };
  }
  return {
    ...base,
    ageHours,
    status: "fresh",
    detail: `Aged ${ageHours}h, within the ${base.stalenessBudgetHours}h budget.`,
  };
}

// Mirror of lib/freshnessArtifact.ts: report WHAT was found, not just the JSON.
function readArtifact(rootDir, relPath) {
  if (!relPath) return { kind: "absent" };
  const abs = join(rootDir, relPath);
  if (!existsSync(abs)) return { kind: "missing", path: relPath };
  try {
    return { kind: "ok", path: relPath, json: JSON.parse(readFileSync(abs, "utf8")) };
  } catch (err) {
    return { kind: "unreadable", path: relPath, error: err instanceof Error ? err.message : String(err) };
  }
}

// Mirror of lib/freshness.ts packArtifactReason: a declared row pack that is
// absent, unreadable or empty is unmeasurable, never fresh.
function packArtifactReason(read) {
  if (read.kind === "absent") {
    return "The registry declares a row pack but no artifact to read it from.";
  }
  if (read.kind === "missing") {
    return `Artifact ${read.path} is not present at runtime, so its rows cannot be counted.`;
  }
  if (read.kind === "unreadable") {
    return `Artifact ${read.path} could not be parsed: ${read.error}`;
  }
  if (!Array.isArray(read.json)) return `Artifact ${read.path} does not hold a row array.`;
  if (read.json.length === 0) return `Artifact ${read.path} is empty (0 rows).`;
  return null;
}

export function loadRegistry(rootDir = DEFAULT_ROOT) {
  const path = join(rootDir, "data", "freshness_registry.json");
  return JSON.parse(readFileSync(path, "utf8"));
}

/**
 * Evaluate the whole registry against disk. Returns { results, breached }.
 * `now` and `rootDir` are injectable for tests.
 */
export async function evaluateFreshness({ now = new Date(), rootDir = DEFAULT_ROOT, registry } = {}) {
  const reg = registry ?? loadRegistry(rootDir);
  const results = await Promise.all(
    (reg.datasets ?? []).map(async (dataset) => {
      const spec = dataset.stamp ?? null;
      // Store-kind datasets have no committed artifact at all — their age comes
      // only from the durable store's real four-way read (unconfigured /
      // unreachable / empty / ok), dependency-free via a raw PostgREST fetch.
      if (spec?.kind === "store") {
        const read = await readDurableFeedStamp(spec.feedKey);
        const { observedAt, reason } = resolveStoreStamp(spec, read);
        return evaluateDataset(dataset, observedAt, now, reason);
      }
      // Mirror of lib/freshnessArtifact.ts resolveDatasetStamp: only a field stamp
      // lives inside the artifact, so only a field stamp opens one — plus a
      // declared row pack, whose rows are the finding whatever dates it.
      const opensArtifact =
        Boolean(dataset.artifact) && (spec?.kind === "field" || dataset.pack === true);
      const artifactRead = opensArtifact
        ? readArtifact(rootDir, dataset.artifact)
        : { kind: "absent" };
      if (dataset.pack === true) {
        const packReason = packArtifactReason(artifactRead);
        if (packReason) return evaluateDataset(dataset, null, now, packReason);
      }
      const { observedAt, reason } = resolveStamp(
        spec,
        spec?.kind === "field" ? artifactRead : { kind: "absent" },
      );
      return evaluateDataset(dataset, observedAt, now, reason);
    }),
  );
  const breached = results.some((r) => r.status === "stale" || r.status === "unknown");
  return { results, breached };
}

export function freshnessGateFailed(results, { requireStore = false } = {}) {
  const stale = results.filter((r) => r.status === "stale");
  const hardStale = stale.filter((r) => !ADVISORY_STALE_IDS.has(r.id));
  const unknown = results.filter((r) => r.status === "unknown");
  const unmeasurableHere = unknown.filter((r) =>
    /unmeasurable without credentials/.test(r.detail ?? ""),
  );
  return (
    hardStale.length > 0 ||
    (requireStore ? unknown.length > 0 : unknown.length > unmeasurableHere.length)
  );
}

// Re-exported so validate-data can format identically.
export function formatFreshnessTable(results) {
  const rows = results.map((r) => ({
    status: r.status.toUpperCase(),
    id: r.id,
    age: r.ageHours === null ? "—" : `${r.ageHours}h`,
    budget: r.stalenessBudgetHours === null ? "—" : `${r.stalenessBudgetHours}h`,
    cadence: r.cadence,
  }));
  const widths = {
    status: Math.max(6, ...rows.map((r) => r.status.length)),
    id: Math.max(2, ...rows.map((r) => r.id.length)),
    age: Math.max(3, ...rows.map((r) => r.age.length)),
    budget: Math.max(6, ...rows.map((r) => r.budget.length)),
  };
  const pad = (s, w) => String(s).padEnd(w);
  const lines = rows.map(
    (r) => `  ${pad(r.status, widths.status)}  ${pad(r.id, widths.id)}  ${pad(r.age, widths.age)} / ${pad(r.budget, widths.budget)}  ${r.cadence}`,
  );
  return lines.join("\n");
}

async function main() {
  const artifactOnly = process.argv.includes("--artifacts-only");
  // A STORE THIS RUNTIME HAS NO CREDENTIALS FOR IS NOT A FINDING ABOUT THE
  // DATA. The tree runs keyless by design, so a local `npm run verify` cannot
  // reach the cron plane's tables; reporting that as a breach would make the
  // gate red on every developer machine and be switched off within a week,
  // which is how a gate stops being a gate. It is still never read as fresh:
  // the row prints under UNRESOLVED with its own reason either way. Pass
  // --require-store on a credentialed run (the production freshness gate) to
  // make an unmeasurable store fatal again.
  const requireStore = process.argv.includes("--require-store");
  const registry = loadRegistry(DEFAULT_ROOT);
  const selectedRegistry = artifactOnly
    ? {
        ...registry,
        datasets: (registry.datasets ?? []).filter((dataset) => dataset.stamp?.kind !== "store"),
      }
    : registry;
  const { results } = await evaluateFreshness({ registry: selectedRegistry });
  console.log("Freshness registry check (data/freshness_registry.json)\n");
  if (artifactOnly) console.log("Scope: candidate artifact-backed feeds. Production store feeds use their own gate.\n");
  console.log(formatFreshnessTable(results));
  const stale = results.filter((r) => r.status === "stale");
  const hardStale = stale.filter((r) => !ADVISORY_STALE_IDS.has(r.id));
  const advisoryStale = stale.filter((r) => ADVISORY_STALE_IDS.has(r.id));
  const unknown = results.filter((r) => r.status === "unknown");
  const unmeasured = results.filter((r) => r.status === "unmeasured");
  const retired = results.filter((r) => r.status === "retired");
  const unmeasurableHere = unknown.filter((r) => /unmeasurable without credentials/.test(r.detail ?? ""));
  const failed = freshnessGateFailed(results, { requireStore });
  console.log("");
  if (stale.length || unknown.length) {
    // Two findings, reported apart. Stale means the data is old; unresolved means
    // the age could not be measured and says nothing about the data itself.
    if (hardStale.length) {
      console.log("  STALE (the data is over budget):");
      for (const r of hardStale) console.log(`    ✗ ${r.id}: ${r.detail}`);
    }
    if (advisoryStale.length) {
      console.log("  STALE (advisory only — does not fail this check):");
      for (const r of advisoryStale) console.log(`    ⚠ ${r.id}: ${r.detail}`);
    }
    if (unknown.length) {
      console.log("  UNRESOLVED (the age could not be determined):");
      for (const r of unknown) console.log(`    ? ${r.id}: ${r.detail}`);
    }
    printUnmeasured(unmeasured);
    printRetired(retired);
    if (failed) {
      console.log(
        `\nFRESHNESS CHECK FAILED: ${hardStale.length} stale, ${unknown.length} unresolved of ${results.length} datasets.`,
      );
      process.exit(1);
    }
    const qualifiers = [];
    if (advisoryStale.length) {
      qualifiers.push(`${advisoryStale.length} advisory stale dataset(s) (${advisoryStale.map((r) => r.id).join(", ")})`);
    }
    if (unmeasurableHere.length) {
      qualifiers.push(
        `${unmeasurableHere.length} store feed(s) this runtime cannot measure. ` +
          "They are NOT reported fresh. Run with --require-store where credentials exist",
      );
    }
    console.log(`\nFRESHNESS CHECK PASSED with ${qualifiers.join(" and ")}.`);
    return;
  }
  printUnmeasured(unmeasured);
  printRetired(retired);
  console.log(
    `FRESHNESS CHECK PASSED: ${results.length} datasets within budget (or live/untracked/snapshot), ` +
      `${unmeasured.length} unmeasured, ${retired.length} retired.`,
  );
}

/**
 * A THIRD finding, printed apart from stale and unresolved and failing nothing.
 * A lane nothing observed owes no refresh; the point is that it may not read as
 * healthy while nobody has looked.
 */
function printUnmeasured(unmeasured) {
  if (!unmeasured.length) return;
  console.log("  UNMEASURED (served live; this spine holds no observation):");
  for (const r of unmeasured) console.log(`    · ${r.id}: ${r.detail}`);
  console.log("");
}

/**
 * A FOURTH finding, printed apart from all three above and failing nothing. A
 * closed lane has no producer, so it is neither late nor unmeasured: it is
 * shut, and the point of printing it is that a reader stops waiting for it.
 */
function printRetired(retired) {
  if (!retired.length) return;
  console.log("  RETIRED (closed lane; nothing in this tree can advance it):");
  for (const r of retired) console.log(`    – ${r.id}: ${r.cadence}`);
  console.log("");
}

// Run as a CLI only when invoked directly, not when imported by validate-data.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error("Freshness check crashed:", err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
