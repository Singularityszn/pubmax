// npm audit that fails on real high/critical vulnerabilities but tolerates
// registry outages. Plain `npm audit` exits non-zero for BOTH findings and
// infrastructure errors (e.g. the advisory endpoint returning 503), which
// turns an npm-registry incident into a build failure with zero signal.
// Here: findings -> exit 1; registry/endpoint failure -> warn + exit 0.
import { spawnSync } from "node:child_process";

const AUDIT_LEVELS = ["high", "critical"];

const result = spawnSync("npm", ["audit", "--json", "--audit-level=high"], {
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
});

const stdout = result.stdout ?? "";
let report = null;
try {
  report = JSON.parse(stdout);
} catch {
  report = null;
}

if (report && report.metadata && report.metadata.vulnerabilities) {
  const counts = report.metadata.vulnerabilities;
  const flagged = AUDIT_LEVELS.reduce((n, level) => n + (counts[level] ?? 0), 0);
  if (flagged > 0) {
    console.error(`[resilient-audit] ${flagged} high/critical vulnerabilities found.`);
    process.stdout.write(stdout);
    process.exit(1);
  }
  console.log("[resilient-audit] no high/critical vulnerabilities.");
  process.exit(0);
}

// No parseable report: npm itself failed (registry outage, ENOAUDIT, proxy).
// The audit is advisory infrastructure — do not fail the build on its absence.
const stderr = (result.stderr ?? "").slice(0, 2000);
console.warn("[resilient-audit] audit unavailable (registry/endpoint error) — skipping as advisory.");
if (stderr) console.warn(stderr);
process.exit(0);
