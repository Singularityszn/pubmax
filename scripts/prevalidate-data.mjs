#!/usr/bin/env node

// Runs the bundled-data builders before validate-data. A git checkout already
// carries the committed shards; rebuilding them during `npm run verify` rewrites
// tracked files when the builder output has moved ahead of what is checked in.
// The no-mistakes Test step sets PUBMAX_VERIFY_COMMITTED_DATA=1 so validation
// reads the committed artifacts and the Push step does not pick up generator churn.

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
