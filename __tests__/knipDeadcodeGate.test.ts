import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
  decideKnipGate,
  flattenKnipReport,
  issueKey,
} from "../scripts/lib/knipDeadcodeGate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function writeReport(name: string, report: unknown) {
  const directory = mkdtempSync(path.join(tmpdir(), "pubmax-knip-gate-"));
  const file = path.join(directory, name);
  writeFileSync(file, JSON.stringify(report));
  return file;
}

function runGate(env: Record<string, string>) {
  return spawnSync(process.execPath, [path.join(ROOT, "scripts", "deadcode-gate.mjs")], {
    cwd: ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
  });
}

describe("knip deadcode gate policy", () => {
  it("treats a finding already on origin/main as inherited, and a new one as owned", () => {
    const head = flattenKnipReport({
      issues: [
        {
          file: "lib/a.ts",
          exports: [{ name: "leftOverFromMain" }, { name: "addedOnBranch" }],
        },
      ],
    });
    const base = flattenKnipReport({
      issues: [
        {
          file: "lib/a.ts",
          exports: [{ name: "leftOverFromMain" }],
        },
      ],
    });

    expect(head.map(issueKey).sort()).toEqual([
      "exports\0lib/a.ts\0addedOnBranch",
      "exports\0lib/a.ts\0leftOverFromMain",
    ]);

    const decision = decideKnipGate({
      aheadCount: 2,
      headIssues: head,
      baseIssues: base,
      baseReadable: true,
    });

    expect(decision.mode).toBe("branch");
    expect(decision.owned.map(issueKey)).toEqual(["exports\0lib/a.ts\0addedOnBranch"]);
    expect(decision.inherited.map(issueKey)).toEqual([
      "exports\0lib/a.ts\0leftOverFromMain",
    ]);
    expect(decision.exitCode).toBe(1);
  });

  it("passes a branch whose only findings already exist on origin/main", () => {
    const inherited = flattenKnipReport({
      issues: [{ file: "lib/a.ts", exports: [{ name: "leftOverFromMain" }] }],
    });
    const decision = decideKnipGate({
      aheadCount: 4,
      headIssues: inherited,
      baseIssues: inherited,
      baseReadable: true,
    });
    expect(decision.owned).toEqual([]);
    expect(decision.exitCode).toBe(0);
  });

  it("on main, every error finding fails, even if a base report lists it", () => {
    const findings = flattenKnipReport({
      issues: [{ file: "lib/a.ts", exports: [{ name: "alreadyThere" }] }],
    });
    const decision = decideKnipGate({
      aheadCount: 0,
      headIssues: findings,
      baseIssues: findings,
      baseReadable: true,
    });
    expect(decision.mode).toBe("main");
    expect(decision.owned.map(issueKey)).toEqual(["exports\0lib/a.ts\0alreadyThere"]);
    expect(decision.inherited).toEqual([]);
    expect(decision.exitCode).toBe(1);
  });

  it("fails every error finding when origin/main cannot be read, rather than passing quietly", () => {
    const findings = flattenKnipReport({
      issues: [{ file: "lib/a.ts", exports: [{ name: "maybeInherited" }] }],
    });
    const decision = decideKnipGate({
      aheadCount: 3,
      headIssues: findings,
      baseIssues: findings,
      baseReadable: false,
    });
    expect(decision.mode).toBe("base-unreadable");
    expect(decision.owned.map(issueKey)).toEqual(["exports\0lib/a.ts\0maybeInherited"]);
    expect(decision.exitCode).toBe(1);
  });

  it("does not fail on duplicate exports, matching knip.config.ts warn", () => {
    const findings = flattenKnipReport({
      issues: [
        {
          file: "lib/a.ts",
          duplicates: [[{ name: "dup" }, { name: "dup" }]],
        },
      ],
    });
    expect(findings).toEqual([
      { type: "duplicates", file: "lib/a.ts", name: "dup,dup" },
    ]);
    const decision = decideKnipGate({
      aheadCount: 1,
      headIssues: findings,
      baseIssues: [],
      baseReadable: true,
    });
    expect(decision.owned).toEqual([]);
    expect(decision.exitCode).toBe(0);
  });

  it("keys an unused file by its path so a new unused file on a branch still fails", () => {
    const head = flattenKnipReport({
      issues: [{ file: "lib/orphan.ts", files: [{ name: "lib/orphan.ts" }] }],
    });
    expect(head.map(issueKey)).toEqual(["files\0lib/orphan.ts\0lib/orphan.ts"]);
    const decision = decideKnipGate({
      aheadCount: 1,
      headIssues: head,
      baseIssues: [],
      baseReadable: true,
    });
    expect(decision.owned).toHaveLength(1);
    expect(decision.exitCode).toBe(1);
  });
});

describe("the deadcode-gate CLI", () => {
  it("exits 1 on a branch finding that origin/main does not have", () => {
    const head = writeReport("head.json", {
      issues: [{ file: "lib/a.ts", exports: [{ name: "addedOnBranch" }] }],
    });
    const base = writeReport("base.json", { issues: [] });
    const result = runGate({
      PUBMAX_KNIP_HEAD_REPORT: head,
      PUBMAX_KNIP_BASE_REPORT: base,
      PUBMAX_KNIP_AHEAD: "2",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("addedOnBranch");
    expect(result.stderr).toContain("lib/a.ts");
  });

  it("exits 0 on a branch whose findings already sit on origin/main, and names them inherited", () => {
    const report = {
      issues: [{ file: "lib/a.ts", exports: [{ name: "leftOverFromMain" }] }],
    };
    const head = writeReport("head.json", report);
    const base = writeReport("base.json", report);
    const result = runGate({
      PUBMAX_KNIP_HEAD_REPORT: head,
      PUBMAX_KNIP_BASE_REPORT: base,
      PUBMAX_KNIP_AHEAD: "2",
    });
    expect(result.status).toBe(0);
    expect(result.stderr).toContain("leftOverFromMain");
    expect(result.stderr).toMatch(/inherited/i);
    expect(result.stderr).toContain("deadcode:all");
  });

  it("on main (ahead 0) fails the full tree even when a base report is supplied", () => {
    const report = {
      issues: [{ file: "lib/a.ts", exports: [{ name: "alreadyThere" }] }],
    };
    const result = runGate({
      PUBMAX_KNIP_HEAD_REPORT: writeReport("head.json", report),
      PUBMAX_KNIP_BASE_REPORT: writeReport("base.json", report),
      PUBMAX_KNIP_AHEAD: "0",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("alreadyThere");
  });
});

