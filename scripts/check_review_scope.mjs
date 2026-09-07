#!/usr/bin/env node

// Review-scope report for pull requests. This script is deliberately
// dependency-free so CI can run it before installing the application.
//
// It FAILS on one thing: generated or skill-pack output in a human review.
// The file count and the runtime-domain count are warnings, because a wide
// review is a judgement and a machine-written file in one is not. The single
// exception is a REGENERATED LANE, declared below: output the same diff can be
// shown to have produced.

import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

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
const GENERATED_PATHS = [
  /^(?:data|public\/data)\/generated(?:\/|$)/,
  /^public\/data\/venues_slim[^/]*\.json$/,
  /^public\/data\/cities\/[^/]+\/venues_slim[^/]*\.json$/,
  /^public\/data\/(?:uk_base|london_venues|london_desks)\/(?!README\.md$).+/,
  /^public\/data\/pubmaxxing_seed_snapshot\.json$/,
  /^public\/data\/(?:heritage_listings|historic_pubs)\.json$/,
  /^data\/persona_drinks\.json$/,
  /^public\/vendor\/maplibre\//,
  /^(?:\.next|build|coverage|dist|out|playwright-report|test-results)(?:\/|$)/,
  /^(?:generated|__generated__)(?:\/|$)/,
  /(?:^|\/)__generated__(?:\/|$)/,
  /(?:^|\/)[^/]+\.generated\.[^/]+$/,
  /^next-env\.d\.ts$/,
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
 * Output nobody in the diff produced stays forbidden, as does every skill
 * pack, and the human-review count leaves permitted output out because a
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
    ],
  },
];

const EVIDENCE_PATH = /^(?:docs\/(?:proof|reviews|evidence)|e2e-shots|screenshots)(?:\/|$)/;
const MIGRATION_PATH = /^supabase\/migrations(?:\/|$)/;
const TEST_PATH = /^(?:__tests__|e2e|tests)(?:\/|$)|(?:^|\/)(?:test|spec)\.[^/]+$/;
const CONFIG_PATH = /^(?:\.github|\.githooks|\.husky)(?:\/|$)|^(?:package\.json|package-lock\.json|tsconfig(?:\.[^/]+)?\.json|next\.config\.[^/]+|vitest\.config\.[^/]+|playwright\.config\.[^/]+|eslint\.config\.[^/]+)$/;
const SOURCE_ROOTS = new Set(["app", "components", "lib", "scripts", "supabase"]);
const NON_RUNTIME_SOURCE_PATHS = new Set(["scripts/check_review_scope.mjs", "scripts/check_review_scope.d.mts"]);

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

/**
 * Classify one changed path. The category is the review lane; `domain` is
 * populated only for runtime source so evidence and migration files do not
 * inflate the runtime-domain warning.
 */
export function classifyReviewFile(value) {
  const path = normalizeReviewPath(value);
  let category = "other";

  if (SKILL_PACK_PATH.test(path)) category = "skill-pack";
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

/**
 * Build a deterministic report from changed paths. Large or mixed reviews
 * warn, but only generated and skill-pack paths make the report fail.
 */
export function summarizeReviewScope(values, unexplainedGeneratedPaths = []) {
  const unexplained = new Set(unexplainedGeneratedPaths.map(normalizeReviewPath));
  const paths = uniqueSorted(values.map(normalizeReviewPath).filter(Boolean));
  const explainedLanes = explainedRegeneratedLanes(paths);
  const classifications = paths.map((path) => {
    const item = classifyReviewFile(path);
    if (item.category !== "generated" || unexplained.has(path)) return item;
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
    ["diff", "--name-only", "-z", "--no-renames", "--diff-filter=ACMRDT", diffBase, head, "--"],
    { cwd, encoding: "utf8" },
  );
  return output.split("\0").filter(Boolean);
}

/** Include branch commits and local changes in one review, including untracked files. */
export function localChangesFromGit(cwd) {
  let base;
  try {
    base = execFileSync("git", ["merge-base", "origin/main", "HEAD"], {
      cwd, encoding: "utf8", stdio: "pipe",
    }).trim();
  } catch {
    throw new Error("Local review needs origin/main and shared history. Fetch the base, or use --base <sha> --head <sha>.");
  }
  const pathsFromGit = (args) => execFileSync("git", args, {
    cwd, encoding: "utf8",
  }).split("\0").filter(Boolean);
  const diffPaths = (...args) => pathsFromGit([
    "diff", "--name-only", "-z", "--no-renames", "--diff-filter=ACMRDT", ...args, "--",
  ]);
  const committed = diffPaths(base, "HEAD");
  const index = diffPaths("--cached", base);
  const worktree = diffPaths(base);
  const untracked = pathsFromGit(["ls-files", "--others", "--exclude-standard", "-z"]);

  // Each snapshot is compared with the same base. Later edits cannot cancel
  // an earlier snapshot's paths or supply its missing generator provenance.
  // Committed generator changes remain visible in later index/worktree diffs.
  const snapshots = [committed, index, [...worktree, ...untracked]];
  const unexplainedGeneratedPaths = uniqueSorted(snapshots.flatMap((paths) => {
    const lanes = explainedRegeneratedLanes(paths);
    return paths.filter((path) => isGeneratedPath(path)
      && !lanes.some((lane) => lane.output.test(path)));
  }));
  return { base, files: uniqueSorted(snapshots.flat()), unexplainedGeneratedPaths };
}

function usage() {
  return "Usage: node scripts/check_review_scope.mjs (--local | --base <sha> --head <sha>) [--repo <path>]";
}

function parseArgs(argv) {
  const values = {};
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--local") {
      values.local = true;
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
  if (values.local ? (values.base || values.head) : (!values.base || !values.head)) {
    throw new Error(usage());
  }
  return values;
}

export function runReviewScopeCli(argv = process.argv.slice(2), cwd = process.cwd()) {
  const args = parseArgs(argv);
  const repo = args.repo ?? cwd;
  const changes = args.local
    ? localChangesFromGit(repo)
    : { base: args.base, files: changedFilesFromGit(args.base, args.head, repo) };
  const report = summarizeReviewScope(changes.files, changes.unexplainedGeneratedPaths);
  console.log(JSON.stringify({ base: changes.base, head: args.local ? "working-tree" : args.head, ...report }, null, 2));
  return report;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const report = runReviewScopeCli();
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 2;
  }
}
