#!/usr/bin/env node
/**
 * Semgrep CE SAST: registry rules, fail only on ERROR (high/critical) findings.
 */
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const semgrep = process.env.SEMGREP_BIN ?? "semgrep";

const caBundle = process.env.REQUESTS_CA_BUNDLE ?? process.env.SSL_CERT_FILE ?? "/etc/ssl/cert.pem";

const args = [
  "scan",
  "--config",
  "p/default",
  "--metrics",
  "off",
  "--severity",
  "ERROR",
  "--exclude",
  "node_modules",
  "--exclude",
  ".next",
  "--exclude",
  "public/data",
  "--exclude",
  "uk_base/public/data",
  "--json",
  "app",
  "lib",
  "components",
  "scripts",
  "proxy.ts",
  "next.config.mjs",
];

const result = spawnSync(semgrep, args, {
  cwd: repoRoot,
  encoding: "utf8",
  env: {
    ...process.env,
    REQUESTS_CA_BUNDLE: caBundle,
    SSL_CERT_FILE: caBundle,
    SEMGREP_SEND_METRICS: "off",
  },
});

if (result.error) {
  console.error(`semgrep failed to start: ${result.error.message}`);
  process.exit(1);
}

const stderr = result.stderr ?? "";
if (stderr) {
  process.stderr.write(stderr);
}

let payload;
try {
  payload = JSON.parse(result.stdout ?? "{}");
} catch {
  console.error("semgrep returned invalid JSON");
  if (result.stdout) {
    process.stdout.write(result.stdout);
  }
  process.exit(result.status === null ? 1 : result.status ?? 1);
}

const errors = (payload.results ?? []).filter((finding) => {
  const severity = finding.extra?.severity ?? finding.severity;
  return severity === "ERROR";
});

if (errors.length === 0) {
  console.log("semgrep: no ERROR-severity findings");
  process.exit(0);
}

console.error(`semgrep: ${errors.length} ERROR-severity finding(s):`);
for (const finding of errors.slice(0, 20)) {
  const loc = finding.path;
  const line = finding.start?.line ?? "?";
  const rule = finding.check_id ?? finding.extra?.metadata?.short_id ?? "unknown";
  console.error(`  ${loc}:${line} ${rule}`);
}
if (errors.length > 20) {
  console.error(`  … and ${errors.length - 20} more`);
}
process.exit(1);
