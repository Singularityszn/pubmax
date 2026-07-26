// npm audit that fails on real high/critical vulnerabilities but tolerates
// registry outages. Plain `npm audit` exits non-zero for BOTH findings and
// infrastructure errors (e.g. the advisory endpoint returning 503), which
// turns an npm-registry incident into a build failure with zero signal.
// Here: findings -> exit 1; registry/endpoint failure -> warn + exit 0.
//
// A finding may additionally be WAIVED, but only under the narrow terms in
// WAIVED_ADVISORIES below: one named advisory, dev dependencies only, and
// only while a second `npm audit --omit=dev` run proves production is clean.
// Anything else - a new advisory, a new severity, the same advisory reaching a
// production dependency - still fails the gate.
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const AUDIT_LEVELS = ["high", "critical"];

// Advisories knowingly tolerated, keyed by GitHub advisory URL.
//
// GHSA-mh99-v99m-4gvg (brace-expansion, high, DoS via unbounded expansion):
//   Chain: eslint 9 + eslint-config-next's eslint-plugin-{react,import,jsx-a11y}
//   -> minimatch@3 -> brace-expansion@1.1.16. All dev dependencies; the app
//   never ships brace-expansion, and the only inputs are our own lint globs.
//   There is no honest fix available today:
//   - The advisory is patched ONLY in brace-expansion 5.0.8. There is no
//     backport to the 1.x / 2.x / 3.x maintenance lines, and minimatch's 3.x
//     head (3.1.5) still depends on brace-expansion ^1.1.7.
//   - Upgrading to eslint 10 (whose own chain is clean) is blocked upstream:
//     eslint-plugin-react/-import/-jsx-a11y all peer-cap at eslint ^9, and
//     eslint 10 in fact crashes eslint-plugin-react with
//     "TypeError: contextOrFilename.getFilename is not a function".
//   - An `overrides: { minimatch: "^10" }` entry reports zero vulnerabilities
//     but is a FALSE green: minimatch 10's CJS build exports named bindings
//     with no callable default, so the plugins' `require('minimatch')(...)`
//     call sites throw. Proven: with that override,
//     `jsx-a11y/label-has-associated-control` throws inside
//     mayContainChildComponent.js. Repo lint only stays green because those
//     paths are not exercised.
//   - `overrides: { "brace-expansion": "^5.0.8" }` breaks minimatch@3 the same
//     way (v1 exports a callable default, v5 exports a named `expand`).
//   Every chain that CAN reach a patched version already does (see the lockfile:
//   brace-expansion 5.0.8 under the minimatch@10 chains, tar 7.5.22).
//   REVISIT AND REMOVE THIS ENTRY when either lands:
//   (a) a brace-expansion backport for the 1.x line, or
//   (b) an eslint-10-compatible eslint-plugin-react/-import/-jsx-a11y set
//       (then upgrade eslint to 10 and drop this waiver).
//   Re-checked: 2026-07-26.
export const WAIVED_ADVISORIES = new Map([
  ["https://github.com/advisories/GHSA-mh99-v99m-4gvg", "high"],
]);

function runAudit(extraArgs = []) {
  const result = spawnSync("npm", ["audit", "--json", "--audit-level=high", ...extraArgs], {
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
  return { result, stdout, report };
}

function hasVulnerabilities(report) {
  return Boolean(report && report.metadata && report.metadata.vulnerabilities);
}

// `via` holds either advisory objects (the root cause) or the names of other
// vulnerable packages. Walk the names to reach every advisory behind an entry.
function collectAdvisories(name, vulnerabilities, seen = new Set()) {
  if (seen.has(name)) return [];
  seen.add(name);
  const entry = vulnerabilities[name];
  if (!entry) return [];
  const advisories = [];
  for (const via of entry.via ?? []) {
    if (typeof via === "string") {
      advisories.push(...collectAdvisories(via, vulnerabilities, seen));
    } else if (via && via.url) {
      advisories.push(via);
    }
  }
  return advisories;
}

// Split a report's high/critical entries into the ones every advisory behind
// them is waived for, and the ones that must still fail the gate.
export function classifyFindings(report, waived = WAIVED_ADVISORIES) {
  const vulnerabilities = report?.vulnerabilities ?? {};
  const waivedNames = [];
  const unwaivedNames = [];
  for (const [name, entry] of Object.entries(vulnerabilities)) {
    if (!AUDIT_LEVELS.includes(entry.severity)) continue;
    const advisories = collectAdvisories(name, vulnerabilities);
    const fullyWaived =
      advisories.length > 0 && advisories.every((a) => waived.get(a.url) === a.severity);
    (fullyWaived ? waivedNames : unwaivedNames).push(name);
  }
  return { waived: waivedNames, unwaived: unwaivedNames };
}

function main() {
  const { result, stdout, report } = runAudit();

  if (hasVulnerabilities(report)) {
    const counts = report.metadata.vulnerabilities;
    const flagged = AUDIT_LEVELS.reduce((n, level) => n + (counts[level] ?? 0), 0);

    if (flagged === 0) {
      console.log("[resilient-audit] no high/critical vulnerabilities.");
      return 0;
    }

    const { waived, unwaived } = classifyFindings(report);

    if (unwaived.length > 0) {
      console.error(
        `[resilient-audit] ${unwaived.length} unwaived high/critical vulnerabilities: ${unwaived.join(", ")}`,
      );
      process.stdout.write(stdout);
      return 1;
    }

    // Everything flagged is waived — but a waiver only covers dev dependencies.
    // Re-audit production-only and fail if the same advisory reaches shipped code.
    const prod = runAudit(["--omit=dev"]);
    if (!hasVulnerabilities(prod.report)) {
      console.error(
        "[resilient-audit] cannot confirm the waived advisories are dev-only (production audit unavailable) — failing closed.",
      );
      process.stdout.write(stdout);
      return 1;
    }
    const prodCounts = prod.report.metadata.vulnerabilities;
    const prodFlagged = AUDIT_LEVELS.reduce((n, level) => n + (prodCounts[level] ?? 0), 0);
    if (prodFlagged > 0) {
      console.error(
        `[resilient-audit] ${prodFlagged} high/critical vulnerabilities in PRODUCTION dependencies — waivers are dev-only.`,
      );
      process.stdout.write(prod.stdout);
      return 1;
    }

    console.log(
      `[resilient-audit] no unwaived high/critical vulnerabilities. Waived (dev-only, see WAIVED_ADVISORIES): ${waived.join(", ")}`,
    );
    return 0;
  }

  // No parseable report: npm itself failed (registry outage, ENOAUDIT, proxy).
  // The audit is advisory infrastructure — do not fail the build on its absence.
  const stderr = (result.stderr ?? "").slice(0, 2000);
  console.warn("[resilient-audit] audit unavailable (registry/endpoint error) — skipping as advisory.");
  if (stderr) console.warn(stderr);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exit(main());
}
