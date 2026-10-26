#!/usr/bin/env node
/**
 * Entry point for `npm run verify:no-mistakes:changed`, the local no-mistakes
 * Test step.
 *
 * THE FULL SUITE RUNS ONCE, IN GITHUB CI. Owner decision, 16 October 2026: the
 * local pipeline ran the whole unit suite through `npm run coverage`, about 40
 * minutes on an 8 GB MacBook Air, and the CI unit shards then ran it again on
 * the same head. This command runs only the checks the diff against the
 * merge-base with origin/main can reach:
 *
 *   - ESLint on the changed files it lints.
 *   - A scoped typecheck: the changed TypeScript files and their DIRECT
 *     importers, through a generated tsconfig that extends the root one. A
 *     full native tsc peaks near 4.5 GB, which an 8 GB laptop cannot spare.
 *   - `vitest related --run --maxWorkers=2` over the changed files, plus every
 *     test file that names a changed file by its repo path (a fence reads a
 *     doc or a config by path, which no import graph can see). It fails on any
 *     failing test it runs.
 *   - The whole-tree gates only `npm run verify` runs and no workflow does
 *     (deadcode, the install-script allowlist, the dependency audit), and the
 *     input-scoped gates
 *     (test:rls, validate-data, db:types:check, gate:e2e-skips, chatgpt-map)
 *     when their inputs change.
 *
 * It runs the full `npm run verify` instead when the change touches a shared
 * foundation (FOUNDATIONS below), deletes a source module, or edits a module
 * more than FULL_SUITE_FAN_IN tracked modules import directly, or when
 * PUBMAX_VERIFY_FULL=1 is set. A missing origin/main also runs the full bar,
 * because there is nothing to scope against.
 *
 * Rule: docs/rules/scripts-ci-gates-and-audits.md#the-no-mistakes-test-step-runs-change-scoped-checks-and-ci-runs-the-full-suite
 * Fence: __tests__/verifyChanged.test.ts, __tests__/noMistakesTestCommand.test.ts
 */
import { spawnSync, execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { POSTGRES_BACKED_SUITES } from "./rls/postgresSuites.mjs";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * A module imported directly by more than this many tracked modules is a hub:
 * a change to it reaches most of the suite anyway, so it runs the full bar.
 * Measured 16 October 2026: 37 lib/ modules sit above 40 (lib/supabase.ts at
 * 414, lib/venues.ts at 310), out of 1,115 lib/ modules anything imports.
 */
export const FULL_SUITE_FAN_IN = 40;

/** Paths every test, every compile or every lint reads, so a change runs the full bar. */
export const FOUNDATIONS = Object.freeze([
  /^package(?:-lock)?\.json$/,
  /^vitest\.(?:config|setup)\.[cm]?[jt]s$/,
  /^tsconfig[^/]*\.json$/,
  /^eslint\.config\.[cm]?js$/,
  /^next\.config\.[cm]?[jt]s$/,
  /^__tests__\/helpers\//,
  // The gate's own plan: a change to it proves itself on the whole suite.
  /^scripts\/verify-changed\.(?:mjs|d\.mts)$/,
  /^scripts\/run-with-restored-bundled-data\.mjs$/,
]);

const SOURCE = /\.(?:[cm]?[jt]s|tsx|jsx)$/;
const LINTED = /\.(?:[cm]?[jt]s|tsx|jsx)$/;
const TYPESCRIPT = /\.(?:m?ts|tsx)$/;
// The root tsconfig excludes these trees (e2e has its own Playwright config),
// and its globs never enter a dot directory such as .agents/.
const NOT_TYPECHECKED = /^(?:e2e|skills|node_modules)\/|(?:^|\/)\./;
const TEST_FILE = /^__tests__\/.+\.test\.tsx?$/;

const RLS_INPUTS = [/^supabase\//, /^scripts\/rls\//];
const DATA_INPUTS = [/^data\//, /^public\/data\//, /^scripts\/(?:pre)?validate-data\.mjs$/];
// Every input scripts/db/generate-database-types.mjs reads.
const DB_TYPES_INPUTS = [
  /^supabase\//,
  /^types\/database\.ts$/,
  /^scripts\/db\//,
  /^scripts\/rls\/session-fixture\.sql$/,
  /^scripts\/qa\/migration-apply-list\.mjs$/,
];
const E2E_SKIP_INPUTS = [/^e2e\//, /^scripts\/assert-no-conditional-e2e-skips\.mjs$/];
const CHATGPT_MAP_INPUTS = [/^scripts\/chatgpt-map\//];

const matchesAny = (patterns, path) => patterns.some((pattern) => pattern.test(path));

/**
 * @typedef {{ path: string, status: "A" | "M" | "D" }} ChangedFile
 */

const SPECIFIER =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*|\bvi\.mock\s*\(\s*)["']([^"'\n]+)["']/g;
const EXTENSIONS = ["", ".ts", ".tsx", ".mts", ".mjs", ".js", ".cjs", "/index.ts", "/index.tsx", "/index.mjs", "/index.js"];

/**
 * Direct importers of every tracked module: `@/` and relative specifiers,
 * static and dynamic imports, require and vi.mock. A bare package name is
 * not a tracked file and is dropped.
 * @param {string[]} files repo-relative tracked source files
 * @param {(path: string) => string} readText
 * @returns {Map<string, Set<string>>}
 */
export function importGraph(files, readText) {
  const tracked = new Set(files);
  const resolveSpecifier = (from, specifier) => {
    let base;
    if (specifier.startsWith("@/")) base = specifier.slice(2);
    else if (specifier.startsWith(".")) base = posix.normalize(posix.join(posix.dirname(from), specifier));
    else return null;
    for (const extension of EXTENSIONS) if (tracked.has(base + extension)) return base + extension;
    // `./x.js` written for a TypeScript source.
    const stem = base.replace(/\.m?js$/, "");
    for (const extension of [".ts", ".tsx", ".mts"]) if (tracked.has(stem + extension)) return stem + extension;
    return null;
  };

  const importers = new Map();
  for (const file of files) {
    let text;
    try {
      text = readText(file);
    } catch {
      continue;
    }
    for (const [, specifier] of text.matchAll(SPECIFIER)) {
      const target = resolveSpecifier(file, specifier);
      if (!target || target === file) continue;
      if (!importers.has(target)) importers.set(target, new Set());
      importers.get(target).add(file);
    }
  }
  return importers;
}

/**
 * Why this change runs the full `npm run verify`, or null when it can be scoped.
 * @param {ChangedFile[]} changed
 * @param {Map<string, Set<string>>} importers
 * @param {Record<string, string | undefined>} [env]
 */
export function fullSuiteReason(changed, importers, env = {}) {
  if (env.PUBMAX_VERIFY_FULL === "1") return "PUBMAX_VERIFY_FULL=1 is set";
  for (const { path, status } of changed) {
    if (matchesAny(FOUNDATIONS, path)) return `${path} is a shared foundation`;
    if (status === "D" && SOURCE.test(path) && !TEST_FILE.test(path)) return `${path} was deleted, so its importers cannot be scoped`;
    const fan = importers.get(path)?.size ?? 0;
    if (fan > FULL_SUITE_FAN_IN) {
      return `${path} is imported directly by ${fan} modules (more than ${FULL_SUITE_FAN_IN})`;
    }
  }
  return null;
}

/**
 * @param {{
 *   changed: ChangedFile[],
 *   importers: Map<string, Set<string>>,
 *   testFiles: string[],
 *   readText: (path: string) => string,
 *   env?: Record<string, string | undefined>,
 * }} input
 */
export function planChecks({ changed, importers, testFiles, readText, env = {} }) {
  const present = changed.filter((file) => file.status !== "D").map((file) => file.path);
  const paths = changed.map((file) => file.path);
  const touches = (patterns) => paths.some((path) => matchesAny(patterns, path));
  const sorted = (values) => [...new Set(values)].sort();
  const postgres = new Set(POSTGRES_BACKED_SUITES);

  // A .d.mts sidecar and its .mjs are one module in two files, and importers
  // name the .mjs, so a changed declaration reaches the module's importers.
  const importersOf = (path) => [
    ...(importers.get(path) ?? []),
    ...(path.endsWith(".d.mts") ? (importers.get(path.replace(/\.d\.mts$/, ".mjs")) ?? []) : []),
  ];
  const typecheck = present
    .flatMap((path) => [path, ...importersOf(path)])
    .filter((path) => TYPESCRIPT.test(path) && !NOT_TYPECHECKED.test(path));

  const named = testFiles.filter((test) => {
    let text;
    try {
      text = readText(test);
    } catch {
      return false;
    }
    // Deleted paths too: a fence that reads a deleted doc must fail here.
    return paths.some((path) => path !== test && text.includes(path));
  });
  const deleted = new Set(paths.filter((path) => !present.includes(path)));

  // A PostgreSQL suite anywhere upstream of the change needs the cluster run.
  const reached = new Set();
  const queue = [...present];
  while (queue.length > 0) {
    for (const importer of importersOf(queue.pop())) {
      if (!reached.has(importer)) {
        reached.add(importer);
        queue.push(importer);
      }
    }
  }

  return {
    full: fullSuiteReason(changed, importers, env),
    lint: sorted(present.filter((path) => LINTED.test(path))),
    typecheck: sorted(typecheck),
    tests: sorted([...present, ...named].filter((path) => !postgres.has(path) && !deleted.has(path))),
    rls:
      touches(RLS_INPUTS) ||
      paths.some((path) => postgres.has(path)) ||
      [...reached].some((path) => postgres.has(path)),
    validateData: touches(DATA_INPUTS),
    dbTypes: touches(DB_TYPES_INPUTS),
    e2eSkips: touches(E2E_SKIP_INPUTS),
    chatgptMap: touches(CHATGPT_MAP_INPUTS),
  };
}

const TSCONFIG_DIR = "node_modules/.cache/verify-changed";

/**
 * The commands a plan runs, in order.
 * @param {ReturnType<typeof planChecks>} plan
 * @returns {{ label: string, command: string, args: string[], env?: Record<string, string> }[]}
 */
export function checkSteps(plan) {
  if (plan.full) return [{ label: "full merge bar", command: "npm", args: ["run", "verify"] }];

  const steps = [];
  if (plan.lint.length > 0) {
    steps.push({
      label: "eslint (changed files)",
      command: "node_modules/.bin/eslint",
      args: ["--no-warn-ignored", ...plan.lint],
    });
  }
  if (plan.typecheck.length > 0) {
    steps.push({ label: "route types", command: "node_modules/.bin/next", args: ["typegen"] });
    steps.push({
      label: "typecheck (changed files and direct importers)",
      command: "node",
      args: ["node_modules/@typescript/native/lib/tsc.js", "--noEmit", "-p", `${TSCONFIG_DIR}/tsconfig.json`],
    });
  }
  if (plan.tests.length > 0) {
    steps.push({
      label: "unit tests (related)",
      command: "node_modules/.bin/vitest",
      args: [
        "related",
        "--run",
        "--maxWorkers=2",
        "--passWithNoTests",
        ...POSTGRES_BACKED_SUITES.flatMap((suite) => ["--exclude", suite]),
        ...plan.tests,
      ],
    });
  }
  if (plan.rls) steps.push({ label: "test:rls", command: "npm", args: ["run", "test:rls"] });
  if (plan.validateData) steps.push({ label: "validate-data", command: "npm", args: ["run", "validate-data"] });
  if (plan.dbTypes) steps.push({ label: "db:types:check", command: "npm", args: ["run", "db:types:check"] });
  if (plan.e2eSkips) steps.push({ label: "gate:e2e-skips", command: "npm", args: ["run", "gate:e2e-skips"] });
  if (plan.chatgptMap) steps.push({ label: "test:chatgpt-map", command: "npm", args: ["run", "test:chatgpt-map"] });
  steps.push({ label: "deadcode", command: "npm", args: ["run", "deadcode"] });
  // No workflow runs the advisory audit, and a new advisory needs no diff.
  steps.push({ label: "dependency audit", command: "node", args: ["scripts/resilient-audit.mjs"] });
  steps.push({
    label: "install-script allowlist",
    command: "node",
    args: ["scripts/ci/install-script-allowlist.mjs", "--check"],
  });
  return steps;
}

/** The tsconfig the scoped typecheck reads: the root one, narrowed to these files and the ambient types. */
function writeScopedTsconfig(files) {
  const git = (...args) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  const ambient = git("ls-files", "next-env.d.ts", "types/*.d.ts").split("\n").filter(Boolean);
  // next typegen writes these; validator.ts is left out because it imports every route.
  const routeTypes = [".next/types/routes.d.ts", ".next/types/link.d.ts", ".next/types/cache-life.d.ts", ".next/types/root-params.d.ts"];
  const dir = join(REPO_ROOT, TSCONFIG_DIR);
  mkdirSync(dir, { recursive: true });
  const config = {
    extends: join(REPO_ROOT, "tsconfig.json"),
    // The full program reaches @types/geojson through a map dependency, so a
    // narrowed one names it, or GeoJSON.* reads as an unknown namespace.
    compilerOptions: { incremental: false, types: ["node", "geojson"] },
    include: [],
    files: [...ambient, ...routeTypes, ...files].map((file) => join(REPO_ROOT, file)),
  };
  writeFileSync(join(dir, "tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`);
}

function changedSince(base) {
  const git = (...args) => execFileSync("git", args, { cwd: REPO_ROOT, encoding: "utf8" });
  const changed = new Map();
  for (const line of git("diff", "--name-status", "--no-renames", base).split("\n").filter(Boolean)) {
    const [status, path] = line.split("\t");
    changed.set(path, { path, status: status === "D" ? "D" : status === "A" ? "A" : "M" });
  }
  for (const path of git("ls-files", "--others", "--exclude-standard").split("\n").filter(Boolean)) {
    changed.set(path, { path, status: "A" });
  }
  return [...changed.values()].sort((a, b) => a.path.localeCompare(b.path));
}

function mergeBase(env) {
  if (env.PUBMAX_VERIFY_BASE) return env.PUBMAX_VERIFY_BASE;
  try {
    return execFileSync("git", ["merge-base", "HEAD", "origin/main"], { cwd: REPO_ROOT, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

/** The command as a log line, with the PostgreSQL excludes folded into a count. */
function shown(step) {
  const words = [];
  let excludes = 0;
  for (let i = 0; i < step.args.length; i += 1) {
    if (step.args[i] === "--exclude") {
      excludes += 1;
      i += 1;
    } else words.push(step.args[i]);
  }
  const folded = excludes > 0 ? [`--exclude <${excludes} PostgreSQL suites>`] : [];
  return [step.command, ...folded, ...words].join(" ");
}

function run(step) {
  console.log(`\n[verify:changed] ▶ ${step.label}: ${shown(step)}`);
  const started = Date.now();
  const result = spawnSync(step.command, step.args, {
    cwd: REPO_ROOT,
    stdio: "inherit",
    env: { ...process.env, ...step.env },
  });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;
  console.log(`[verify:changed] ${ok ? "✔" : "✘"} ${step.label} (${seconds}s)`);
  return ok;
}

function main() {
  const base = mergeBase(process.env);
  if (!base) {
    console.log("[verify:changed] No merge-base with origin/main, so the full merge bar runs.");
    process.exit(run(checkSteps({ full: "no merge-base" })[0]) ? 0 : 1);
  }

  const changed = changedSince(base);
  const sources = execFileSync("git", ["ls-files", "-co", "--exclude-standard"], { cwd: REPO_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((path) => SOURCE.test(path) && !path.startsWith("node_modules/"));
  const readText = (path) => readFileSync(join(REPO_ROOT, path), "utf8");
  const plan = planChecks({
    changed,
    importers: importGraph(sources, readText),
    testFiles: sources.filter((path) => TEST_FILE.test(path)),
    readText,
    env: process.env,
  });

  console.log(`[verify:changed] ${changed.length} changed file(s) since ${base.slice(0, 12)}.`);
  if (plan.full) {
    console.log(`[verify:changed] Full merge bar: ${plan.full}.`);
  } else {
    console.log(
      `[verify:changed] Scoped: lint ${plan.lint.length}, typecheck ${plan.typecheck.length}, related sources ${plan.tests.length}.`,
    );
    if (plan.typecheck.length > 0) writeScopedTsconfig(plan.typecheck);
  }

  const failed = checkSteps(plan).filter((step) => !run(step)).map((step) => step.label);
  if (failed.length > 0) {
    console.error(`\n[verify:changed] FAILED: ${failed.join(", ")}`);
    process.exit(1);
  }
  console.log("\n[verify:changed] All change-scoped checks passed. The full suite runs in GitHub CI.");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
