#!/usr/bin/env node
/*
 * perf-ab.mjs - the interleaved A/B behind a red Performance budget run.
 *
 * WHAT QUESTION IT ANSWERS. A budgeted route went past its ceiling. Two things
 * can put it there: this branch made the route slower, or this box is slower
 * than the box that set the ceiling. A breach table cannot tell them apart, and
 * on 11 September 2026 four runs produced four different failing route sets on
 * branches whose diffs cannot touch a route. So the job measures the MERGE BASE
 * of the same branch, on the same machine, in the same job, on the breached
 * routes alone, and prints the comparison.
 *
 * WHAT IT IS NOT. It is not a gate and it never becomes one. The ceilings stay
 * the law, the breach list still fails the build, and nothing here reads, moves
 * or excuses a ceiling. This script exits 0 whatever it finds, because the
 * verdict on the branch belongs to e2e/performance-budget.spec.ts alone.
 *
 * WHEN IT COSTS ANYTHING. Only on a red sweep. The sweep writes its breach list
 * to test-results/perf-budget-breaches.json ONLY when it has one, and with no
 * list this script stops before it creates a worktree or starts a build, so a
 * green run pays nothing at all.
 *
 * HOW THE SECOND BUILD IS MADE. A detached git worktree at the merge base, its
 * own package install, and the same environment playwright.config.ts builds the
 * branch with, read from that file rather than copied
 * (scripts/print-e2e-server-env.ts). Two builds made with two environments are
 * two different products.
 *
 * USAGE
 *   node scripts/perf-ab.mjs [--base-ref origin/main] [--branch-port 3500]
 *                            [--base-port 3501] [--report <file>]
 */

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

// Mirrors PERF_AB_BREACH_FILE in lib/performanceAbEvidence.ts, which a plain
// Node script cannot import. __tests__/performanceAbEvidence.test.ts holds the
// two together rather than trusting them to stay in step.
const BREACH_FILE = "test-results/perf-budget-breaches.json";

const REPO_ROOT = process.cwd();

function parseArgs(argv) {
  const args = {
    baseRef: process.env.BUDGET_BASE_BRANCH
      ? `origin/${process.env.BUDGET_BASE_BRANCH}`
      : "origin/main",
    branchPort: 3500,
    basePort: 3501,
    report: "test-results/perf-budget-ab.txt",
  };
  for (let index = 2; index < argv.length; index += 1) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (flag === "--base-ref" && value) {
      args.baseRef = value;
      index += 1;
    } else if (flag === "--branch-port" && value) {
      args.branchPort = Number(value);
      index += 1;
    } else if (flag === "--base-port" && value) {
      args.basePort = Number(value);
      index += 1;
    } else if (flag === "--report" && value) {
      args.report = value;
      index += 1;
    }
  }
  return args;
}

function say(message) {
  console.log(`[perf-ab] ${message}`);
}

function git(args, options = {}) {
  return execFileSync("git", args, {
    encoding: "utf8",
    cwd: options.cwd ?? REPO_ROOT,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function run(command, args, options = {}) {
  const child = spawn(command, args, {
    cwd: options.cwd ?? REPO_ROOT,
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: "inherit",
  });
  return new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`${command} ${args.join(" ")} exited ${code}`)),
    );
  });
}

/** The environment playwright.config.ts builds and serves the branch with. */
function e2eServerEnv() {
  const printed = execFileSync("npx", ["tsx", "scripts/print-e2e-server-env.ts"], {
    encoding: "utf8",
    cwd: REPO_ROOT,
  });
  return JSON.parse(printed);
}

async function waitForServer(origin, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(origin, { redirect: "manual" });
      if (response.status > 0) return true;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  return false;
}

function startServer({ cwd, port, env }) {
  const child = spawn("npm", ["run", "start", "--", "--port", String(port)], {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "ignore", "inherit"],
  });
  return child;
}

async function main() {
  const args = parseArgs(process.argv);

  if (!existsSync(path.join(REPO_ROOT, BREACH_FILE))) {
    say("the sweep left no breach list, so there is nothing to explain. Nothing was built.");
    return;
  }
  const handover = JSON.parse(readFileSync(path.join(REPO_ROOT, BREACH_FILE), "utf8"));
  if (!Array.isArray(handover.breaches) || handover.breaches.length === 0) {
    say("the breach list is empty. Nothing was built.");
    return;
  }

  const branchDistDir = process.env.PW_NEXT_DIST_DIR ?? ".next-e2e";
  if (!existsSync(path.join(REPO_ROOT, branchDistDir, "BUILD_ID"))) {
    say(
      `the branch build is not on disk at ${branchDistDir}, so there is nothing to compare ` +
        "against. The A/B runs in the same job as the sweep for exactly this reason.",
    );
    return;
  }

  const mergeBase = git(["merge-base", args.baseRef, "HEAD"]);
  say(
    `${handover.breaches.length} breached metric(s), measured again against merge base ` +
      `${mergeBase.slice(0, 9)}`,
  );

  const serverEnv = e2eServerEnv();
  const baseDistDir = ".next-perf-ab-base";
  const worktree = mkdtempSync(path.join(tmpdir(), "pubmax-perf-ab-"));
  const servers = [];

  try {
    git(["worktree", "add", "--detach", worktree, mergeBase]);

    // THE BASE TREE INSTALLS ITS OWN PACKAGES, AND A SYMLINK IS NOT A SHORTCUT
    // HERE. Borrowing this checkout's node_modules through a symlink is what a
    // first version did, and Turbopack refuses it outright: "Symlink
    // [project]/node_modules is invalid, it points out of the filesystem root".
    // It is also the honest thing: the base is built against the packages its
    // own lockfile names, and a build made against the wrong dependency tree is
    // not the base's build. The install is cached on the runner and only ever
    // paid on a red sweep.
    say("installing the merge base's own packages");
    await run("npm", ["ci", "--prefer-offline", "--no-audit", "--fund=false"], {
      cwd: worktree,
    });

    say("building the merge base with the same environment the branch was built with");
    await run("npm", ["run", "build"], {
      cwd: worktree,
      env: { ...serverEnv, NEXT_DIST_DIR: baseDistDir },
    });

    const branchOrigin = `http://localhost:${args.branchPort}`;
    const baseOrigin = `http://localhost:${args.basePort}`;
    servers.push(
      startServer({
        cwd: REPO_ROOT,
        port: args.branchPort,
        env: { ...serverEnv, NEXT_DIST_DIR: branchDistDir },
      }),
    );
    servers.push(
      startServer({
        cwd: worktree,
        port: args.basePort,
        env: { ...serverEnv, NEXT_DIST_DIR: baseDistDir },
      }),
    );

    const answered = await Promise.all([
      waitForServer(branchOrigin, 180_000),
      waitForServer(baseOrigin, 180_000),
    ]);
    if (answered.some((up) => !up)) {
      say("one arm never answered, so there is no comparison to make");
      return;
    }

    // THE BREACH LIST IS COPIED OUT OF test-results FIRST. Playwright clears
    // that directory at the START of a run, so the sweep's own handover would
    // be deleted by the very run that needs to read it.
    const handoverCopy = path.join(worktree, "perf-budget-breaches.json");
    copyFileSync(path.join(REPO_ROOT, BREACH_FILE), handoverCopy);

    // PW_SKIP_WEBSERVER=1: both arms are already serving, and Playwright
    // starting its own would build the branch a second time and measure it on
    // a third port.
    await run(
      "npx",
      [
        "playwright",
        "test",
        "e2e/performance-budget-ab.spec.ts",
        "--project=chromium",
        "--workers=1",
      ],
      {
        env: {
          PW_SKIP_WEBSERVER: "1",
          PUBMAX_PERF_AB: "1",
          PUBMAX_PERF_AB_BRANCH_URL: branchOrigin,
          PUBMAX_PERF_AB_BASE_URL: baseOrigin,
          PUBMAX_PERF_AB_BREACHES: handoverCopy,
          PUBMAX_PERF_AB_REPORT: args.report,
        },
      },
    );
  } finally {
    for (const server of servers) server.kill("SIGTERM");
    try {
      git(["worktree", "remove", "--force", worktree]);
    } catch {
      rmSync(worktree, { recursive: true, force: true });
    }
  }
}

// EVIDENCE NEVER CHANGES A VERDICT. The sweep already decided whether this job
// is red; an A/B that could not run says so and leaves that decision alone.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    say(`could not gather the evidence: ${error.message}`);
    process.exit(0);
  });
