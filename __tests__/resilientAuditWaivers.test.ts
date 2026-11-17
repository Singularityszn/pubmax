import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// The audit gate may waive named advisories (see WAIVED_ADVISORIES in the
// script). These tests pin the blast radius of that mechanism: a waiver
// covers exactly the advisory named, and a finding that mixes a waived
// advisory with anything else still fails. Generic classification uses a local
// map. CLI cases exercise the approved exception and its production audit.

// @ts-expect-error - plain .mjs build script, no type declarations
import { classifyFindings } from "../scripts/resilient-audit.mjs";

const WAIVED_URL = "https://github.com/advisories/GHSA-xxxx-waived-zzzz";
const OTHER_URL = "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz";
const PICOMATCH_URL = "https://github.com/advisories/GHSA-fc5q-39xc-vjpf";

const EXAMPLE_WAIVERS = new Map([[WAIVED_URL, "high"]]);

function advisory(url: string, severity = "high") {
  return { source: 1, name: "pkg", dependency: "pkg", title: "t", url, severity };
}

function auditReport(url?: string, severity = "high") {
  return JSON.stringify({
    vulnerabilities: url ? { picomatch: { name: "picomatch", severity, via: [advisory(url, severity)] } } : {},
    metadata: { vulnerabilities: { high: url && severity === "high" ? 1 : 0, critical: url && severity === "critical" ? 1 : 0 } },
  });
}

function runGate(full: string, production: string, now = "2026-11-23T23:59:59.999Z") {
  const folder = mkdtempSync(join(tmpdir(), "pubmax-audit-waiver-"));
  try {
    writeFileSync(join(folder, "clock.mjs"), "Date.now = () => Number(process.env.AUDIT_NOW);\n");
    writeFileSync(join(folder, "npm"), `#!/usr/bin/env node
const raw = process.argv.includes("--omit=dev") ? process.env.AUDIT_PRODUCTION : process.env.AUDIT_FULL;
process.stdout.write(raw);
try {
  const counts = JSON.parse(raw).metadata.vulnerabilities;
  process.exit(counts.high || counts.critical ? 1 : 0);
} catch { process.exit(1); }
`, { mode: 0o755 });
    return spawnSync(process.execPath, ["--import", join(folder, "clock.mjs"), "scripts/resilient-audit.mjs"], {
      cwd: process.cwd(), encoding: "utf8",
      env: { ...process.env, PATH: `${folder}:${process.env.PATH}`, AUDIT_NOW: String(Date.parse(now)), AUDIT_FULL: full, AUDIT_PRODUCTION: production },
    });
  } finally { rmSync(folder, { recursive: true, force: true }); }
}

describe("resilient-audit waivers", () => {
  it("permits the approved development advisory only when production is clean", () => {
    expect(runGate(auditReport(PICOMATCH_URL), auditReport()).status).toBe(0);
  });

  it.each(["2026-11-24T00:00:00.000Z", "2026-11-25T00:00:00.000Z"])("expires the exception at %s", (now) => {
    expect(runGate(auditReport(PICOMATCH_URL), auditReport(), now).status).toBe(1);
  });

  it.each([
    ["production exposure", auditReport(PICOMATCH_URL), auditReport(PICOMATCH_URL)],
    ["another advisory", auditReport(OTHER_URL), auditReport()],
    ["changed severity", auditReport(PICOMATCH_URL, "critical"), auditReport()],
    ["unavailable production evidence", auditReport(PICOMATCH_URL), "registry unavailable"],
    ["unavailable full evidence", "registry unavailable", auditReport()],
  ])("fails closed for %s", (_label, full, production) => {
    expect(runGate(full, production).status).toBe(1);
  });

  it("waives a finding whose only advisory is waived", () => {
    const report = {
      vulnerabilities: {
        "brace-expansion": { name: "brace-expansion", severity: "high", via: [advisory(WAIVED_URL)] },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS)).toEqual({
      waived: ["brace-expansion"],
      unwaived: [],
    });
  });

  it("waives transitive findings by walking `via` package names to their root advisory", () => {
    const report = {
      vulnerabilities: {
        "brace-expansion": { name: "brace-expansion", severity: "high", via: [advisory(WAIVED_URL)] },
        minimatch: { name: "minimatch", severity: "high", via: ["brace-expansion"] },
        eslint: { name: "eslint", severity: "high", via: ["minimatch"] },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS).unwaived).toEqual([]);
    expect(classifyFindings(report, EXAMPLE_WAIVERS).waived).toEqual([
      "brace-expansion",
      "minimatch",
      "eslint",
    ]);
  });

  it("fails an unrelated advisory", () => {
    const report = {
      vulnerabilities: {
        other: { name: "other", severity: "critical", via: [advisory(OTHER_URL)] },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS).unwaived).toEqual(["other"]);
  });

  it("fails a waived advisory when its severity changes", () => {
    const report = {
      vulnerabilities: {
        "brace-expansion": {
          name: "brace-expansion",
          severity: "critical",
          via: [advisory(WAIVED_URL, "critical")],
        },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS).unwaived).toEqual(["brace-expansion"]);
  });

  it("fails a finding that mixes a waived advisory with an unwaived one", () => {
    const report = {
      vulnerabilities: {
        "brace-expansion": { name: "brace-expansion", severity: "high", via: [advisory(WAIVED_URL)] },
        mixed: { name: "mixed", severity: "high", via: ["brace-expansion", advisory(OTHER_URL)] },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS).unwaived).toEqual(["mixed"]);
  });

  it("never waives a finding with no resolvable advisory", () => {
    const report = {
      vulnerabilities: {
        orphan: { name: "orphan", severity: "high", via: ["missing-package"] },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS).unwaived).toEqual(["orphan"]);
  });

  it("survives a cyclic `via` graph", () => {
    const report = {
      vulnerabilities: {
        a: { name: "a", severity: "high", via: ["b"] },
        b: { name: "b", severity: "high", via: ["a", advisory(WAIVED_URL)] },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS).unwaived).toEqual([]);
  });

  it("ignores findings below the high/critical gate level", () => {
    const report = {
      vulnerabilities: {
        moderate: { name: "moderate", severity: "moderate", via: [advisory(OTHER_URL)] },
      },
    };
    expect(classifyFindings(report, EXAMPLE_WAIVERS)).toEqual({ waived: [], unwaived: [] });
  });
});
