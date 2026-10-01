import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const REPOSITORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaces: string[] = [];

type AuditFixture = { report?: unknown; stderr?: string; exitCode: number };
type Receipt = { cwd: string; args: string[] };

function auditReport(packageName?: string, severity: "high" | "critical" | "moderate" = "high"): AuditFixture {
  return {
    exitCode: packageName && severity !== "moderate" ? 1 : 0,
    report: {
      auditReportVersion: 2,
      vulnerabilities: packageName ? {
        [packageName]: {
          name: packageName,
          severity,
          isDirect: true,
          via: [{
            source: 12345,
            name: packageName,
            dependency: packageName,
            title: "Fixture advisory",
            url: "https://github.com/advisories/GHSA-xxxx-yyyy-zzzz",
            severity,
            range: "*",
          }],
          effects: [],
          range: "*",
          nodes: [`node_modules/${packageName}`],
          fixAvailable: false,
        },
      } : {},
      metadata: {
        vulnerabilities: {
          info: 0,
          low: 0,
          moderate: packageName && severity === "moderate" ? 1 : 0,
          high: packageName && severity === "high" ? 1 : 0,
          critical: packageName && severity === "critical" ? 1 : 0,
          total: packageName ? 1 : 0,
        },
      },
    },
  };
}

const outage: AuditFixture = {
  report: { error: { code: "E503", summary: "Fixture registry unavailable" } },
  stderr: "Fixture registry unavailable",
  exitCode: 1,
};

function runAudit(rootReport: AuditFixture, nestedReport: AuditFixture) {
  const workspace = realpathSync(mkdtempSync(path.join(tmpdir(), "pubmax-audit-packages-")));
  workspaces.push(workspace);
  const scripts = path.join(workspace, "scripts");
  const nested = path.join(scripts, "chatgpt-map");
  const bin = path.join(workspace, "fixture-bin");
  mkdirSync(nested, { recursive: true });
  mkdirSync(bin);
  copyFileSync(path.join(REPOSITORY, "scripts", "resilient-audit.mjs"), path.join(scripts, "resilient-audit.mjs"));
  for (const [directory, name] of [[workspace, "pubmaxx"], [nested, "pubmaxx-public-map-mcp"]]) {
    writeFileSync(path.join(directory, "package.json"), JSON.stringify({ name, version: "0.1.0", private: true }));
    writeFileSync(path.join(directory, "package-lock.json"), JSON.stringify({ name, version: "0.1.0", lockfileVersion: 3, requires: true, packages: { "": { name, version: "0.1.0" } } }));
  }
  const fixtures = path.join(workspace, "audit-fixtures.json");
  const receiptsPath = path.join(workspace, "npm-receipts.jsonl");
  writeFileSync(fixtures, JSON.stringify({ ".": rootReport, "scripts/chatgpt-map": nestedReport }));
  writeFileSync(receiptsPath, "");
  const fixtureProgram = path.join(bin, "fake-npm.mjs");
  writeFileSync(fixtureProgram, `import { appendFileSync, readFileSync } from "node:fs";
import path from "node:path";
const relative = path.relative(process.env.PUBMAX_AUDIT_FIXTURE_ROOT, process.cwd()).split(path.sep).join("/") || ".";
appendFileSync(process.env.PUBMAX_AUDIT_FIXTURE_RECEIPTS, JSON.stringify({ cwd: relative, args: process.argv.slice(2) }) + "\\n");
const fixture = JSON.parse(readFileSync(process.env.PUBMAX_AUDIT_FIXTURES, "utf8"))[relative];
if (!fixture) throw new Error("Unexpected npm working directory: " + relative);
if (fixture.report !== undefined) process.stdout.write(JSON.stringify(fixture.report));
if (fixture.stderr) process.stderr.write(fixture.stderr);
process.exit(fixture.exitCode);
`);
  const fakeNpm = path.join(bin, "npm");
  const quotedNode = `'${process.execPath.replaceAll("'", "'\\''")}'`;
  writeFileSync(fakeNpm, `#!/bin/sh\nexec ${quotedNode} "$PUBMAX_AUDIT_FIXTURE_PROGRAM" "$@"\n`);
  chmodSync(fakeNpm, 0o755);

  const result = spawnSync(process.execPath, [path.join(scripts, "resilient-audit.mjs")], {
    cwd: workspace,
    encoding: "utf8",
    timeout: 20_000,
    env: {
      PATH: `${bin}${path.delimiter}${process.env.PATH ?? ""}`,
      PUBMAX_AUDIT_FIXTURE_ROOT: workspace,
      PUBMAX_AUDIT_FIXTURE_RECEIPTS: receiptsPath,
      PUBMAX_AUDIT_FIXTURES: fixtures,
      PUBMAX_AUDIT_FIXTURE_PROGRAM: fixtureProgram,
    },
  });
  expect(result.error).toBeUndefined();
  expect(result.signal).toBeNull();
  const receipts: Receipt[] = readFileSync(receiptsPath, "utf8").trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
  return { result, receipts, output: `${result.stdout}${result.stderr}` };
}

function expectBothPackages(receipts: Receipt[]): void {
  const args = ["audit", "--json", "--audit-level=high"];
  expect([...receipts].sort((left, right) => left.cwd.localeCompare(right.cwd))).toEqual([
    { cwd: ".", args },
    { cwd: "scripts/chatgpt-map", args },
  ]);
}

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

describe("resilient audit package process boundary", () => {
  it("checks both package locks and passes when both valid reports are clean", () => {
    const { result, receipts } = runAudit(auditReport(), auditReport());
    expect(result.status).toBe(0);
    expectBothPackages(receipts);
  });

  it("fails a nested high finding even when the root package is clean", () => {
    const { result, receipts, output } = runAudit(auditReport(), auditReport("mcp-fixture-high"));
    expect(result.status).toBe(1);
    expect(output).toContain("mcp-fixture-high");
    expectBothPackages(receipts);
  });

  it("preserves a root high failure while still checking the nested package", () => {
    const { result, receipts, output } = runAudit(auditReport("root-fixture-high"), auditReport());
    expect(result.status).toBe(1);
    expect(output).toContain("root-fixture-high");
    expectBothPackages(receipts);
  });

  it("does not let root registry outage hide a concrete nested critical finding", () => {
    const { result, receipts, output } = runAudit(outage, auditReport("mcp-fixture-critical", "critical"));
    expect(result.status).toBe(1);
    expect(output).toContain("mcp-fixture-critical");
    expectBothPackages(receipts);
  });

  it("retains primary registry outage tolerance independently for each package", () => {
    const { result, receipts, output } = runAudit(auditReport(), outage);
    expect(result.status).toBe(0);
    expect(output).toContain("Fixture registry unavailable");
    expectBothPackages(receipts);
  });

  it("keeps the same high severity threshold for both packages", () => {
    const { result, receipts } = runAudit(auditReport("root-fixture-moderate", "moderate"), auditReport("mcp-fixture-moderate", "moderate"));
    expect(result.status).toBe(0);
    expectBothPackages(receipts);
  });
});
