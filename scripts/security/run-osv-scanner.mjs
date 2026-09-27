#!/usr/bin/env node
/**
 * Scan package-lock.json with osv-scanner; fail only on High/Critical (CVSS >= 7).
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const lockfile = path.join(repoRoot, "package-lock.json");
const osvScanner = process.env.OSV_SCANNER_BIN ?? "osv-scanner";

const result = spawnSync(
  osvScanner,
  ["scan", "--lockfile", lockfile, "--format", "json"],
  { cwd: repoRoot, encoding: "utf8" },
);

if (result.error) {
  console.error(`osv-scanner failed to start: ${result.error.message}`);
  process.exit(1);
}

if (result.status !== 0 && !result.stdout) {
  process.stderr.write(result.stderr ?? "");
  process.exit(result.status ?? 1);
}

let payload;
try {
  payload = JSON.parse(result.stdout);
} catch {
  console.error("osv-scanner returned invalid JSON");
  process.stderr.write(result.stderr ?? "");
  process.exit(1);
}

const failing = [];

for (const entry of payload.results ?? []) {
  for (const pkg of entry.packages ?? []) {
    for (const group of pkg.groups ?? []) {
      const score = Number.parseFloat(group.max_severity ?? "0");
      if (score >= 7) {
        failing.push({
          package: pkg.package?.name,
          version: pkg.package?.version,
          ids: group.ids,
          max_severity: group.max_severity,
        });
      }
    }
  }
}

if (failing.length === 0) {
  const status = result.status ?? 1;
  if (status !== 0 && status !== 1) {
    process.stderr.write(result.stderr ?? "");
    process.exit(status);
  }
  if (status === 1 && (payload.results ?? []).length === 0) {
    console.error("osv-scanner: exit 1 but no scan results in JSON");
    process.stderr.write(result.stderr ?? "");
    process.exit(1);
  }
  console.log("osv-scanner: no High or Critical vulnerabilities in package-lock.json");
  process.exit(0);
}

console.error("osv-scanner: High or Critical vulnerabilities:");
for (const row of failing) {
  console.error(
    `  ${row.package}@${row.version} (max CVSS ${row.max_severity}): ${row.ids?.join(", ")}`,
  );
}
process.exit(1);
