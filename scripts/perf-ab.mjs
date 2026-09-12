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
 *   node scripts/perf-ab.mjs
 *
 * It takes no options. One instrument wired into one job needs one set of
 * values, and a flag nobody passes is surface that looks supported and does
 * nothing. The base branch arrives the one way the job already names it,
 * BUDGET_BASE_BRANCH.
 */

import { execFileSync, spawn } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";

// Mirrors PERF_AB_BREACH_FILE in lib/performanceAbEvidence.ts, which a plain
// Node script cannot import. __tests__/performanceAbEvidence.test.ts holds the
// two together rather than trusting them to stay in step.
const BREACH_FILE = "test-results/perf-budget-breaches.json";

const REPO_ROOT = process.cwd();

const BASE_REF = process.env.BUDGET_BASE_BRANCH
  ? `origin/${process.env.BUDGET_BASE_BRANCH}`
  : "origin/main";
const BRANCH_PORT = 3500;
const BASE_PORT = 3501;
const REPORT_FILE = "test-results/perf-budget-ab.txt";

// THE JOB'S CLOCK, AS THE JOB ITSELF KNOWS IT. The Performance budget job
// records its start and passes its own `timeout-minutes` here, so the install,
// the build and the measuring are all bounded by what is LEFT of that wall
// rather than by a share of it that the sweep may already have spent. Outside
// the job neither is set: nothing is racing a wall then, so nothing is bounded
// and the A/B takes as long as it takes.
const JOB_WALL_MS = Number(process.env.PUBMAX_PERF_AB_JOB_WALL_MS) || 0;
const JOB_STARTED_MS = Number(process.env.PUBMAX_PERF_AB_JOB_STARTED_MS) || Date.now();

/** What is left of the job's wall, or null when no wall was handed over. */
function wallRemainingMs() {
  if (JOB_WALL_MS <= 0) return null;
  return JOB_WALL_MS - (Date.now() - JOB_STARTED_MS);
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
  // A SUBPROCESS UPSTREAM OF A DEADLINE MUST BE BOUNDED OR THE DEADLINE IS
  // DECORATIVE. A hung install or build eats the job's wall on its own and the
  // step that uploads the evidence never runs. Killed, it reports what it was
  // and the run ends with no A/B, which still exits 0: the verdict on this
  // branch belongs to the sweep either way.
  const timeoutMs = options.timeoutMs ?? 0;
  return new Promise((resolve, reject) => {
    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            child.kill("SIGKILL");
            reject(
              new Error(
                `${command} ${args.join(" ")} outlasted the ${Math.round(timeoutMs / 60_000)} ` +
                  "minute(s) left on the job's wall",
              ),
            );
          }, timeoutMs)
        : null;
    const done = () => {
      if (timer) clearTimeout(timer);
    };
    child.on("error", (error) => {
      done();
      reject(error);
    });
    child.on("exit", (code) => {
      done();
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}`));
    });
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

/** Whether ANYTHING answers that origin right now. */
async function originAnswers(origin) {
  try {
    const response = await fetch(origin, { redirect: "manual" });
    return response.status > 0;
  } catch {
    return false;
  }
}

// AN ARM IS THE SERVER THIS SCRIPT STARTED, OR IT IS NOT AN ARM. A listener
// this run did not spawn - a leftover `next start` from an interrupted run, or
// a hand-started server on the same port - answers the origin just as happily,
// and the report would then read BRANCH SLOWER off somebody else's build. So
// the wait fails when the arm's own process has exited.
async function waitForServer(origin, child, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null) return false;
    if (await originAnswers(origin)) return true;
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
  if (!existsSync(path.join(REPO_ROOT, BREACH_FILE))) {
    say("the sweep left no breach list, so there is nothing to explain. Nothing was built.");
    return;
  }
  const handoverText = readFileSync(path.join(REPO_ROOT, BREACH_FILE), "utf8");
  const handover = JSON.parse(handoverText);
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

  const mergeBase = git(["merge-base", BASE_REF, "HEAD"]);

  // BOTH ARMS THE SAME COMMIT IS A COMPARISON OF NOTHING. On a push to main the
  // merge base IS this head, so the second build would be the branch build under
  // another name and any run-to-run noise past the band would print BRANCH
  // SLOWER against a build that IS the base. Stopping here is also what keeps
  // the install, the build and the doubled measurement off that run's wall.
  if (mergeBase === git(["rev-parse", "HEAD"])) {
    say(
      `the merge base against ${BASE_REF} IS this head, so both arms would be the same ` +
        "commit. There is no branch to compare and nothing was built.",
    );
    return;
  }

  // A WALL ALREADY SPENT BUYS NOTHING. The sweep and this job's own build come
  // first, and on the slow box this instrument exists for they are what
  // overruns: starting an install and a second build with no wall left only
  // costs the run the upload step that carries the evidence.
  const remaining = wallRemainingMs();
  if (remaining !== null && remaining <= 0) {
    say(
      "the job's wall is already spent, so there is no room to build the merge base and still " +
        "hand the evidence over. Nothing was built.",
    );
    return;
  }

  // FAIL CLOSED ON A PORT SOMEONE ELSE HOLDS, before the worktree, the install
  // and the build. A second server on this port would be measured and labelled
  // as this branch, which is the silent mislabelling the instrument exists to
  // remove.
  for (const port of [BRANCH_PORT, BASE_PORT]) {
    if (await originAnswers(`http://localhost:${port}`)) {
      say(
        `something already answers on port ${port}, so this run would measure a server it did ` +
          "not start. Stop that process and run again. Nothing was built.",
      );
      return;
    }
  }

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
      timeoutMs: wallRemainingMs() ?? 0,
    });

    say("building the merge base with the same environment the branch was built with");
    await run("npm", ["run", "build"], {
      cwd: worktree,
      env: { ...serverEnv, NEXT_DIST_DIR: baseDistDir },
      timeoutMs: wallRemainingMs() ?? 0,
    });

    const branchOrigin = `http://localhost:${BRANCH_PORT}`;
    const baseOrigin = `http://localhost:${BASE_PORT}`;
    const branchServer = startServer({
      cwd: REPO_ROOT,
      port: BRANCH_PORT,
      env: { ...serverEnv, NEXT_DIST_DIR: branchDistDir },
    });
    const baseServer = startServer({
      cwd: worktree,
      port: BASE_PORT,
      env: { ...serverEnv, NEXT_DIST_DIR: baseDistDir },
    });
    servers.push(branchServer, baseServer);

    const answered = await Promise.all([
      waitForServer(branchOrigin, branchServer, 180_000),
      waitForServer(baseOrigin, baseServer, 180_000),
    ]);
    if (answered.some((up) => !up)) {
      say("one arm never answered on its own process, so there is no comparison to make");
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
          PUBMAX_PERF_AB_REPORT: REPORT_FILE,
          PUBMAX_PERF_AB_JOB_STARTED_MS: String(JOB_STARTED_MS),
          PUBMAX_PERF_AB_JOB_WALL_MS: String(JOB_WALL_MS),
        },
      },
    );
  } finally {
    for (const server of servers) server.kill("SIGTERM");

    // THE BREACH LIST IS PUT BACK BEFORE ANYTHING UPLOADS IT. The A/B's own
    // Playwright run cleared test-results/ at its start, and the sweep's
    // handover went with it, so without this the job uploads an artifact with
    // no breach list beside the comparison - on exactly the red run the
    // artifact exists for.
    mkdirSync(path.join(REPO_ROOT, path.dirname(BREACH_FILE)), { recursive: true });
    writeFileSync(path.join(REPO_ROOT, BREACH_FILE), handoverText);

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
