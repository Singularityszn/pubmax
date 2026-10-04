#!/usr/bin/env node

import { spawnSync } from "node:child_process";

import {
  restoreCommittedBundledData,
  untrackedBundledData,
} from "./lib/committedBundledDataPaths.mjs";

const [, , command, ...args] = process.argv;

if (!command) {
  console.error("Usage: node scripts/run-with-restored-bundled-data.mjs <command> [args...]");
  process.exit(2);
}

const executable = process.platform === "win32" && command === "npm" ? "npm.cmd" : command;

const untrackedBefore = untrackedBundledData();

let result;
try {
  result = spawnSync(executable, args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
} finally {
  if (!restoreCommittedBundledData(process.cwd(), { untrackedBefore })) {
    console.error("Failed to restore committed bundled data from HEAD.");
    process.exit(1);
  }
}

if (result.error) {
  console.error(result.error.message);
  process.exit(1);
}
if (result.signal) {
  console.error(`Wrapped command ended with ${result.signal}.`);
  process.exit(1);
}
process.exit(result.status ?? 1);
