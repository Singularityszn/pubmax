#!/usr/bin/env node
// A budget is a ratchet, and this is the pawl.
//
// docs/PERFORMANCE_BUDGETS.md states the law: a ceiling comes DOWN whenever the
// measured figure has been comfortably below it, and goes UP only deliberately,
// in the commit that needs it, with the reason and a measured figure. Until now
// the second half was enforced by whoever happened to read the diff.
//
// The trap it exists to close is specific. When the gate fails, the fastest way
// to make the red go away is to raise the ceiling, and #1314 is the record of a
// gate failing on unchanged code and pushing an author toward exactly that move.
// So a raise is not forbidden here - forbidding it would make the law a lie the
// first time a route legitimately needs room - it is made impossible to do
// QUIETLY. A raise needs a `ceilingRaises` record on the route naming the
// metric, the figure it came from, the measured figure it goes to, and why.
// The record is checked against the base branch's actual ceiling, so it cannot
// be written from memory, and it stays in the file afterwards.
//
// Removing a route is a raise with no ceiling at all: an unmeasured route reads
// as a pass and never fails again. So that is refused too.
//
// Usage: node scripts/check-budget-ratchet.mjs [baseRef]

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const BUDGET_FILE = "perf/route-budgets.json";
const METRICS = ["serverRenderMs", "jsDecodedKB", "requests", "lcpMs"];
const baseRef = process.argv[2] ?? process.env.PUBMAX_BUDGET_BASE_REF ?? "origin/main";

function readBase() {
  try {
    const raw = execFileSync("git", ["show", `${baseRef}:${BUDGET_FILE}`], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return JSON.parse(raw);
  } catch (error) {
    // A base we cannot read is not a pass and it is not a failure either: it is
    // a check that did not run, and it says so rather than going quiet.
    console.log(
      `[budget-ratchet] could not read ${BUDGET_FILE} at ${baseRef}, so nothing was compared.\n` +
        `  ${(error && error.message ? String(error.message) : String(error)).split("\n")[0]}`,
    );
    return null;
  }
}

function routesByPath(budgets) {
  const map = new Map();
  for (const route of budgets.routes ?? []) map.set(route.path, route);
  return map;
}

/** Every raise this route declares, keyed by metric. */
function declaredRaises(route) {
  const map = new Map();
  for (const raise of route.ceilingRaises ?? []) map.set(raise.metric, raise);
  return map;
}

function checkRoute(path, before, after, failures, accepted) {
  const declared = declaredRaises(after);
  for (const metric of METRICS) {
    const from = before[metric];
    const to = after[metric];
    if (typeof from !== "number" || typeof to !== "number") continue;
    if (to <= from) continue;

    const raise = declared.get(metric);
    if (!raise) {
      failures.push(
        `${path} ${metric}: ceiling raised from ${from} to ${to} with no record. ` +
          `A budget raised to make a red build green is not a budget ` +
          `(docs/PERFORMANCE_BUDGETS.md). Fix the route, or add a ceilingRaises ` +
          `entry naming the metric, from, to, measured and why.`,
      );
      continue;
    }
    if (raise.from !== from) {
      failures.push(
        `${path} ${metric}: the ceilingRaises record says it came from ${raise.from}, ` +
          `but ${baseRef} has ${from}. A record written from memory is not evidence.`,
      );
    }
    if (raise.to !== to) {
      failures.push(
        `${path} ${metric}: the ceilingRaises record goes to ${raise.to}, ` +
          `but the file says ${to}.`,
      );
    }
    if (typeof raise.measured !== "number" || !Number.isFinite(raise.measured)) {
      failures.push(
        `${path} ${metric}: the ceilingRaises record carries no measured figure. ` +
          `The law asks for a figure measured rather than guessed.`,
      );
    }
    if (typeof raise.why !== "string" || raise.why.trim().length < 20) {
      failures.push(
        `${path} ${metric}: the ceilingRaises record carries no reason worth reading.`,
      );
      continue;
    }
    // A documented raise still gets said out loud. A raise that passes in
    // silence is half the problem this check exists for: the point is that
    // nobody can take a ceiling up without a reader noticing.
    accepted.push(
      `${path} ${metric}: ${from} to ${to}, measured ${raise.measured}. ${raise.why}`,
    );
  }

  const beforePin = before.pinReady?.targetMs;
  const afterPin = after.pinReady?.targetMs;
  if (typeof beforePin === "number" && typeof afterPin === "number" && afterPin > beforePin) {
    failures.push(
      `${path} pinReady.targetMs: raised from ${beforePin} to ${afterPin}. ` +
        `The /map pin-ready target comes down at each sweep, never up.`,
    );
  }
}

function main() {
  const base = readBase();
  if (!base) process.exit(0);
  const head = JSON.parse(readFileSync(BUDGET_FILE, "utf8"));

  const before = routesByPath(base);
  const after = routesByPath(head);
  const failures = [];
  const notes = [];
  const accepted = [];

  for (const [path, beforeRoute] of before) {
    const afterRoute = after.get(path);
    if (!afterRoute) {
      failures.push(
        `${path}: removed from the budget file. An unmeasured route reads as a ` +
          `pass and never fails again, so removing one needs its own argument.`,
      );
      continue;
    }
    if (beforeRoute.readySelector !== afterRoute.readySelector) {
      notes.push(
        `${path}: readySelector changed from "${beforeRoute.readySelector}" to ` +
          `"${afterRoute.readySelector}". That changes where counting stops, so its ` +
          `figures are not comparable to the ones before it.`,
      );
    }
    checkRoute(path, beforeRoute, afterRoute, failures, accepted);
  }

  const added = [...after.keys()].filter((path) => !before.has(path));
  if (added.length > 0) notes.push(`${added.length} route(s) newly budgeted: ${added.join(", ")}`);

  if (notes.length > 0) {
    console.log(`[budget-ratchet] notes:\n${notes.map((note) => `  - ${note}`).join("\n")}`);
  }

  if (accepted.length > 0) {
    console.log(
      `\n[budget-ratchet] ${accepted.length} ceiling(s) went UP with a record, which is ` +
        `allowed and is meant to be read:\n${accepted.map((entry) => `  - ${entry}`).join("\n")}\n`,
    );
  }

  if (failures.length > 0) {
    console.error(
      `\n[budget-ratchet] a ceiling went the wrong way against ${baseRef}:\n` +
        `${failures.map((failure) => `  - ${failure}`).join("\n")}\n`,
    );
    process.exit(1);
  }
  console.log(`[budget-ratchet] no ceiling was raised against ${baseRef}.`);
}

main();
