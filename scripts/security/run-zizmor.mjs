#!/usr/bin/env node
/**
 * Run zizmor on .github/workflows and fail only on high-or-critical findings.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const zizmor = process.env.ZIZMOR_BIN ?? "zizmor";

const result = spawnSync(
  zizmor,
  ["--offline", "--min-severity", "high", ".github/workflows"],
  {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  },
);

const stdout = result.stdout ?? "";
const stderr = result.stderr ?? "";
process.stdout.write(stdout);
process.stderr.write(stderr);

if (result.error) {
  console.error(`zizmor failed to start: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status === null ? 1 : result.status);
