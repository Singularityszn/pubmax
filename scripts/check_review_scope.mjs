#!/usr/bin/env node

// Review-scope report for pull requests. This script is deliberately
// dependency-free so CI can run it before installing the application.
//
// It FAILS on two things: generated or skill-pack output in a human review,
// and a no-mistakes CI-step fix commit that touches committed bundled data or
// a known-flake spec another lane owns.
// The file count and the runtime-domain count are warnings, because a wide
// review is a judgement and a machine-written file in one is not. The single
// exception is a REGENERATED LANE, declared below: output the same diff can be
// shown to have produced.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

import { isBundledDataFile } from "./lib/committedBundledDataPaths.mjs";

export const REVIEW_SCOPE_HINTS = {
  generated:
    "Generated output in this diff has no declared lane. If its generator inputs are in the diff, add a lane to REGENERATED_LANES (scripts/check_review_scope.mjs); rule: docs/rules/scripts-ci-gates-and-audits.md#a-generated-lane-may-ride-the-review-that-produced-it-and-nothing-else-may",
  "skill-pack":
    "A skill pack in this diff sits outside the project skill root. Move it under .agents/skills/; rule: docs/rules/scripts-ci-gates-and-audits.md#a-generated-lane-may-ride-the-review-that-produced-it-and-nothing-else-may",
  "ci-data":
    "A no-mistakes(ci) commit in this branch changed committed bundled data. Builder churn is never part of a CI repair: rewrite the branch without those paths; rule: docs/rules/scripts-ci-gates-and-audits.md#the-no-mistakes-test-step-runs-npm-run-verify-as-its-own-command",
  "ci-flake":
    "A no-mistakes(ci) commit in this branch edited a known-flake spec in KNOWN_FLAKE_SPECS (scripts/check_review_scope.mjs). Re-run the check instead, and rewrite the branch without that edit; rule: docs/rules/scripts-ci-gates-and-audits.md#the-no-mistakes-test-step-runs-npm-run-verify-as-its-own-command",
};

export const MAX_REVIEW_FILES = 150;
export const MAX_RUNTIME_DOMAINS = 2;

const CATEGORY_ORDER = [
  "source",
  "migration",
  "generated",
  "regenerated",
  "evidence",
  "test",
  "config",
  "docs",
  "skill-pack",
  "other",
];

const SKILL_PACK_PATH = /(?:^|\/)skills(?:\/|$)/;
const PROJECT_SKILL_ROOT = /^(?:\.agents\/skills)(?:\/|$)/;
const GENERATED_PATHS = [
  /^(?:data|public\/data)\/generated(?:\/|$)/,
  /^public\/data\/venues_slim[^/]*\.json$/,
  /^public\/data\/cities\/[^/]+\/venues_slim[^/]*\.json$/,
  /^public\/data\/(?:uk_base|london_venues|london_desks|london_restaurants)\/(?!README\.md$).+/,
  /^public\/data\/pubmaxxing_seed_snapshot\.json$/,
  /^public\/data\/(?:heritage_listings|historic_pubs)\.json$/,
  /^data\/persona_drinks\.json$/,
  /^public\/vendor\/maplibre\//,
  /^(?:\.next|build|coverage|dist|out|playwright-report|test-results)(?:\/|$)/,
  /^(?:generated|__generated__)(?:\/|$)/,
  /(?:^|\/)__generated__(?:\/|$)/,
  /(?:^|\/)[^/]+\.generated\.[^/]+$/,
  /^types\/database\.ts$/,
];
/**
 * A GENERATED LANE MAY RIDE THE REVIEW THAT PRODUCED IT.
 *
 * Two gates used to forbid every generator change between them. A build that
 * rewrites a tracked file is refused (scripts/run-with-restored-next-env.mjs),
 * so a generator change has to carry its regenerated output; and every path
 * under a generated lane was forbidden here, so carrying that output failed
 * this check. PR #1461 regenerated 610 uk_base files and was merged red on
 * 4 September 2026 because there was no third answer.
 *
 * The third answer is EVIDENCE, not an exemption: output is permitted only
 * when the same diff also changes the generator that writes it or the source
 * input it is cut from, which is exactly the case where a reviewer can check
 * the output against something. A lane's permission covers that lane alone.
 * Output nobody in the diff produced stays forbidden. An added or modified
 * skill path outside `.agents/skills/` stays forbidden too; deleting one
 * does not. The human-review count leaves permitted output out because a
 * reviewer reads the generator, never 600 machine-written cells.
 *
 * A lane is declared here or it does not exist. Adding one means naming the
 * generator that writes it and the input it reads.
 */
export const REGENERATED_LANES = [
  {
    id: "uk_base",
    output: /^public\/data\/uk_base\/(?!README\.md$).+/,
    inputs: [
      /^scripts\/build_uk_base_shards\.mjs$/,
      /^scripts\/build_uk_place_index\.mjs$/,
      /^scripts\/build_uk_pub_search_index\.mjs$/,
      /^scripts\/lib\/ukBaseGrid\.mjs$/,
      /^data\/osm\/uk\/.+/,
      /^public\/data\/venues_slim\.json$/,
      /^public\/data\/cities\/[^/]+\/venues_slim\.json$/,
      /^data\/osm\/outer_london_osm_pubs\.json$/,
      /^data\/cities\/[^/]+\/osm_pubs\.json$/,
      /^lib\/outerLondonOwnership\.mjs$/,
      /^lib\/cityVenueId\.mjs$/,
      /^scripts\/build_city_slim_index\.mjs$/,
      /^scripts\/fetch_city_osm_pubs\.mjs$/,
    ],
  },
  {
    id: "venues_slim",
    output: /^public\/data\/venues_slim[^/]*\.json$/,
    inputs: [
      /^scripts\/build_slim_index\.mjs$/,
      /^scripts\/lib\/slimShards\.mjs$/,
      /^public\/data\/pint_prices_app_dataset\.json$/,
      /^public\/data\/venue_menu_enrichment\.json$/,
      /^data\/famous_venues\/[^/]+\.json$/,
    ],
  },
  {
    id: "city_venues_slim",
    output: /^public\/data\/cities\/[^/]+\/venues_slim[^/]*\.json$/,
    inputs: [
      /^scripts\/build_city_slim_index\.mjs$/,
      /^scripts\/fetch_city_osm_pubs\.mjs$/,
      /^scripts\/lib\/slimShards\.mjs$/,
      /^scripts\/lib\/parallelVenueDiscovery\.mjs$/,
      /^lib\/cityVenueId\.mjs$/,
      /^data\/cities\/[^/]+\/osm_pubs\.json$/,
      /^data\/cities\/[^/]+\/parallel_venues\.json$/,
    ],
  },
  {
    id: "london_venues",
    output: /^public\/data\/london_venues\/(?!README\.md$).+/,
    inputs: [
      /^scripts\/build_london_venue_shards\.mjs$/,
      /^scripts\/lib\/ukBaseGrid\.mjs$/,
      /^scripts\/lib\/londonRestaurantDrinks\.mjs$/,
      /^data\/osm\/uk\/uk_osm_venues_[a-z]+\.json$/,
      /^data\/london_restaurant_drinks\/(?:evidence|exclusions)\.json$/,
    ],
  },
  {
    id: "london_desks",
    output: /^public\/data\/london_desks\/(?!README\.md$).+/,
    inputs: [
      /^scripts\/build_london_desk_index\.mjs$/,
      /^scripts\/build_london_venue_shards\.mjs$/,
      /^data\/osm\/uk\/uk_osm_venues_[a-z]+\.json$/,
    ],
  },
  {
    id: "london_restaurants",
    output: /^public\/data\/london_restaurants\/(?!README\.md$).+/,
    inputs: [
      /^scripts\/build_london_restaurant_pack\.mjs$/,
      /^scripts\/lib\/boroughFromPoint\.mjs$/,
      /^lib\/londonBoroughPoint\.mjs$/,
      /^data\/london_boroughs_simplified\.json$/,
      /^public\/data\/london_venues\/(?!README\.md$).+/,
    ],
  },
  {
    id: "uk_pub_search",
    output: /^data\/generated\/uk_pub_search\.json$/,
    inputs: [
      /^scripts\/build_uk_pub_search_index\.mjs$/,
      /^data\/osm\/uk\/uk_osm_pubs\.json$/,
    ],
  },
  {
    id: "database_types",
    output: /^types\/database\.ts$/,
    inputs: [
      /^scripts\/db\/generate-database-types\.mjs$/,
      /^scripts\/db\/renderDatabaseTypes\.mjs$/,
      /^scripts\/db\/introspect-public-schema\.sql$/,
      /^scripts\/rls\/session-fixture\.sql$/,
      /^supabase\/migrations\/.+\.sql$/,
    ],
  },
];

const EVIDENCE_PATH = /^(?:docs\/(?:proof|reviews|evidence)|e2e-shots|screenshots)(?:\/|$)/;
const MIGRATION_PATH = /^supabase\/migrations(?:\/|$)/;
const TEST_PATH = /^(?:__tests__|e2e|tests)(?:\/|$)|(?:^|\/)(?:test|spec)\.[^/]+$/;
const CONFIG_PATH = /^(?:\.github|\.githooks|\.husky)(?:\/|$)|^(?:package\.json|package-lock\.json|tsconfig(?:\.[^/]+)?\.json|next\.config\.[^/]+|vitest\.config\.[^/]+|playwright\.config\.[^/]+|eslint\.config\.[^/]+)$/;
const SOURCE_ROOTS = new Set(["app", "components", "lib", "scripts", "supabase"]);
const NON_RUNTIME_SOURCE_PATHS = new Set(["scripts/check_review_scope.mjs"]);

/** Convert Git's path spelling into the one used by the report. */
export function normalizeReviewPath(value) {
  return String(value ?? "")
    .trim()
    .replaceAll("\\", "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

function isGeneratedPath(path) {
  return GENERATED_PATHS.some((pattern) => pattern.test(path));
}

function runtimeDomain(path, category) {
  if (category !== "source") return null;
  if (NON_RUNTIME_SOURCE_PATHS.has(path)) return null;
  const root = path.split("/", 1)[0];
  return SOURCE_ROOTS.has(root) ? root : null;
}

function isSkillPackLeak(path, status = "") {
  if (PROJECT_SKILL_ROOT.test(path)) return false;
  if (!SKILL_PACK_PATH.test(path)) return false;
  return !String(status).toUpperCase().startsWith("D");
}

/**
 * Classify one changed path. The category is the review lane; `domain` is
 * populated only for runtime source so evidence and migration files do not
 * inflate the runtime-domain warning.
 */
export function classifyReviewFile(value, status = "") {
  const path = normalizeReviewPath(value);
  let category = "other";

  if (isSkillPackLeak(path, status)) category = "skill-pack";
  else if (isGeneratedPath(path)) category = "generated";
  else if (MIGRATION_PATH.test(path)) category = "migration";
  else if (EVIDENCE_PATH.test(path)) category = "evidence";
  else if (SOURCE_ROOTS.has(path.split("/", 1)[0])) category = "source";
  else if (TEST_PATH.test(path)) category = "test";
  else if (CONFIG_PATH.test(path)) category = "config";
  else if (path.startsWith("docs/")) category = "docs";

  return { path, category, domain: runtimeDomain(path, category) };
}

/**
 * Which lanes the diff itself explains, by carrying the generator that writes
 * them or the input they are cut from. A lane nobody produced is absent, and
 * its output stays forbidden.
 */
export function explainedRegeneratedLanes(paths) {
  return REGENERATED_LANES.filter((lane) =>
    paths.some((path) => lane.inputs.some((input) => input.test(path))),
  );
}

function uniqueSorted(values) {
  return [...new Set(values)].sort();
}

function reviewChange(value) {
  if (value && typeof value === "object") {
    return {
      path: normalizeReviewPath(value.path),
      status: String(value.status ?? ""),
    };
  }
  return { path: normalizeReviewPath(value), status: "" };
}

function uniqueChanges(values) {
  const byPath = new Map();
  for (const value of values) {
    const change = reviewChange(value);
    if (!change.path) continue;
    const previous = byPath.get(change.path);
    const previousDeleted = (previous?.status ?? "").toUpperCase().startsWith("D");
    const changeDeleted = change.status.toUpperCase().startsWith("D");
    if (!previous || (previousDeleted && !changeDeleted)) {
      byPath.set(change.path, change);
    }
  }
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

/**
 * Build a deterministic report from changed paths. Large or mixed reviews
 * warn, but only generated and skill-pack paths make the report fail.
 */
export function summarizeReviewScope(values) {
  const changes = uniqueChanges(values);
  const paths = changes.map((change) => change.path);
  const explainedLanes = explainedRegeneratedLanes(paths);
  const classifications = changes.map((change) => {
    const item = classifyReviewFile(change.path, change.status);
    if (item.category !== "generated") return item;
    const lane = explainedLanes.find((candidate) => candidate.output.test(item.path));
    return lane ? { ...item, category: "regenerated", lane: lane.id } : item;
  });
  const categories = {};
  for (const item of classifications) {
    if (!categories[item.category]) categories[item.category] = [];
    categories[item.category].push(item.path);
  }

  const orderedCategories = {};
  for (const category of CATEGORY_ORDER) {
    if (categories[category]?.length) {
      orderedCategories[category] = categories[category];
    }
  }

  const categoryCounts = Object.fromEntries(
    Object.entries(orderedCategories).map(([category, files]) => [category, files.length]),
  );
  const domains = uniqueSorted(
    classifications.map((item) => item.domain).filter((domain) => domain !== null),
  );
  const warnings = [];
  if (domains.length > MAX_RUNTIME_DOMAINS) {
    warnings.push(
      `review spans ${domains.length} runtime domains (limit ${MAX_RUNTIME_DOMAINS})`,
    );
  }
  // A reviewer reads the generator, never the cells it wrote, so permitted
  // output is out of the count this warning is about.
  const reviewFileCount = classifications.filter(
    (item) => item.category !== "regenerated",
  ).length;
  if (reviewFileCount > MAX_REVIEW_FILES) {
    warnings.push(`review changes ${reviewFileCount} files (limit ${MAX_REVIEW_FILES})`);
  }

  const forbidden = classifications
    .filter((item) => item.category === "generated" || item.category === "skill-pack")
    .map(({ category, path }) => ({ category, path }));

  return {
    fileCount: paths.length,
    reviewFileCount,
    regeneratedLanes: explainedLanes
      .filter((lane) => classifications.some((item) => item.lane === lane.id))
      .map((lane) => lane.id),
    categories: orderedCategories,
    categoryCounts,
    domains,
    warnings,
    forbidden,
    ok: forbidden.length === 0,
  };
}

export function changedFilesFromGit(base, head, cwd) {
  const diffBase = /^0{40}$/.test(base)
    ? "4b825dc642cb6eb9a060e54bf8d69288fbee4904"
    : base;
  const output = execFileSync(
    "git",
    ["diff", "--name-status", "--diff-filter=ACMRD", diffBase, head],
    { cwd, encoding: "utf8" },
  );
  return output.split("\n").filter(Boolean).flatMap(parseNameStatus);
}

function parseNameStatus(line) {
  const fields = line.split("\t");
  const code = String(fields[0] ?? "").charAt(0).toUpperCase();
  if (!code) return [];
  const path = code === "R" || code === "C" ? fields[fields.length - 1] : fields[1];
  if (!path) return [];
  return [{ path, status: code }];
}

/**
 * A CI REPAIR NEVER COMMITS BUNDLED DATA OR ANOTHER LANE'S FLAKE.
 *
 * The no-mistakes CI step runs no repository command, so a CI repair that
 * runs a builder itself is outside the restore wrappers. On PR 1862 one such
 * repair committed 111 stamped public/data files, and CI repairs rewrote
 * e2e/map-surface-history.spec.ts on PRs 1862, 1870, 1880, 1909 and 1950. A
 * later revert hides a commit from the net diff, so this check reads every
 * CI-step commit, not the diff. Review and Document fixes on a data branch
 * may commit regenerated shards; only a CI repair may not. It runs only under
 * --ci-commits, which ci.yml passes for a pull request: a merged commit on
 * main cannot be rewritten, so a push there never reads the commit log.
 */
export const CI_FIX_COMMIT_SUBJECT = /^no-mistakes\(ci\):/;

/** Specs another lane owns that fail intermittently. A CI repair re-runs them, never edits them. */
export const KNOWN_FLAKE_SPECS = ["e2e/map-surface-history.spec.ts"];

/**
 * Bundled-data and known-flake paths that CI-step fix commits touched.
 * @param {{ sha: string, subject: string, paths: string[] }[]} commits
 */
export function ciFixChurn(commits) {
  return commits
    .filter((commit) => CI_FIX_COMMIT_SUBJECT.test(commit.subject))
    .flatMap((commit) =>
      commit.paths.map(normalizeReviewPath).flatMap((path) => {
        if (isBundledDataFile(path)) return [{ sha: commit.sha, path, category: "ci-data" }];
        if (KNOWN_FLAKE_SPECS.includes(path)) return [{ sha: commit.sha, path, category: "ci-flake" }];
        return [];
      }),
    );
}

export function commitsFromGit(base, head, cwd) {
  const output = execFileSync(
    "git",
    ["log", "--no-renames", "--format=%x1e%H%x1f%s", "--name-only", `${base}..${head}`],
    { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
  );
  return output.split("\x1e").filter(Boolean).map((record) => {
    const [header, ...lines] = record.split("\n");
    const [sha, subject = ""] = header.split("\x1f");
    return { sha, subject, paths: lines.filter(Boolean) };
  });
}

function usage() {
  return "Usage: node scripts/check_review_scope.mjs --base <sha> --head <sha> [--repo <path>] [--ci-commits]";
}

function parseArgs(argv) {
  const values = { ciCommits: false };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--ci-commits") {
      values.ciCommits = true;
      continue;
    }
    if (flag !== "--base" && flag !== "--head" && flag !== "--repo") {
      throw new Error(`unknown option: ${flag}\n${usage()}`);
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for ${flag}\n${usage()}`);
    }
    values[flag.slice(2)] = value;
    index += 1;
  }
  if (!values.base || !values.head) throw new Error(usage());
  return values;
}

export function runReviewScopeCli(argv = process.argv.slice(2), cwd = process.cwd()) {
  const args = parseArgs(argv);
  const files = changedFilesFromGit(args.base, args.head, args.repo ?? cwd);
  const scope = summarizeReviewScope(files);
  const ciChurn = args.ciCommits ? ciFixChurn(commitsFromGit(args.base, args.head, args.repo ?? cwd)) : [];
  const report = { ...scope, ciChurn, ok: scope.ok && ciChurn.length === 0 };
  console.log(JSON.stringify({ base: args.base, head: args.head, ...report }, null, 2));
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const report = runReviewScopeCli();
    if (!report.ok) {
      for (const [category, hint] of Object.entries(REVIEW_SCOPE_HINTS)) {
        if ([...report.forbidden, ...report.ciChurn].some((item) => item.category === category)) {
          console.error(hint);
        }
      }
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
