#!/usr/bin/env node

// Runs the bundled-data builders before validate-data. A git checkout already
// carries the committed shards. `npm run verify` and the no-mistakes Test step
// set PUBMAX_VERIFY_COMMITTED_DATA=1 to validate those artifacts without rebuilding.
// This prevents generator changes from silently replacing the data under review.

import { spawnSync } from "node:child_process";

const npmCmd = process.platform === "win32" ? "npm.cmd" : "npm";

function runBuild(script) {
  const result = spawnSync(npmCmd, ["run", script], {
    stdio: "inherit",
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

if (process.env.PUBMAX_VERIFY_COMMITTED_DATA === "1") {
  console.log(
    "SKIP prevalidate-data: PUBMAX_VERIFY_COMMITTED_DATA=1 (validate committed bundled data)",
  );
  process.exit(0);
}

for (const script of [
  "build:slim",
  "build:city-slim",
  "build:pubmaxxing-seed",
  "build:uk-base",
]) {
  runBuild(script);
}
