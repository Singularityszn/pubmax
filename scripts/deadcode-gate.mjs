#!/usr/bin/env node
// KNIP ON A BRANCH FAILS ONLY ON WHAT THE BRANCH INTRODUCED.
//
// `npx knip` and `npm run deadcode:all` still judge the whole tree. This
// wrapper is what `verify` runs: same knip, then subtract findings origin/main
// already has. On main, or when origin/main cannot be read, it is the full
// gate. Test seams (HEAD report, base report, ahead count) are env-only and
// unused by verify.

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  decideKnipGate,
  errorIssues,
  flattenKnipReport,
  isMainlineGate,
} from "./lib/knipDeadcodeGate.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KNIP_BIN = path.join(ROOT, "node_modules", "knip", "bin", "knip.js");
const BASE_REF = process.env.PUBMAX_KNIP_BASE_REF ?? "origin/main";

function readJsonFile(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

function runKnipJson(cwd, cacheLocation) {
  const args = [KNIP_BIN, "--reporter", "json", "--no-progress", "--no-exit-code"];
  if (cacheLocation) args.push("--cache-location", cacheLocation);
  const result = spawnSync(process.execPath, args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 20 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  const stdout = result.stdout ?? "";
  const start = stdout.indexOf("{");
  if (start === -1) {
    throw new Error(
      `knip produced no JSON (exit ${result.status}): ${(result.stderr ?? "").trim() || stdout.trim()}`,
    );
  }
  return JSON.parse(stdout.slice(start));
}

function aheadCount() {
  if (process.env.PUBMAX_KNIP_AHEAD !== undefined) {
    const parsed = Number.parseInt(process.env.PUBMAX_KNIP_AHEAD, 10);
    return Number.isInteger(parsed) ? parsed : 0;
  }
  try {
    const raw = execFileSync("git", ["rev-list", "--count", `${BASE_REF}..HEAD`], {
      cwd: ROOT,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
    const parsed = Number.parseInt(raw, 10);
    return Number.isInteger(parsed) ? parsed : 0;
  } catch {
    return 0;
  }
}

function headReport() {
  if (process.env.PUBMAX_KNIP_HEAD_REPORT) {
    return readJsonFile(process.env.PUBMAX_KNIP_HEAD_REPORT);
  }
  return runKnipJson(ROOT);
}

function baseReportFromWorktree() {
  try {
    execFileSync("git", ["rev-parse", "--verify", BASE_REF], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return { readable: false, report: null };
  }

  const tmp = mkdtempSync(path.join(tmpdir(), "pubmax-knip-base-"));
  let added = false;
  try {
    execFileSync("git", ["worktree", "add", "--detach", tmp, BASE_REF], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "pipe"],
    });
    added = true;
    const modules = path.join(tmp, "node_modules");
    if (!existsSync(modules)) symlinkSync(path.join(ROOT, "node_modules"), modules);
    const report = runKnipJson(tmp, path.join(tmp, ".knip-cache"));
    return { readable: true, report };
  } catch (error) {
    const message = error && error.message ? String(error.message).split("\n")[0] : String(error);
    console.error(`knip: could not analyse ${BASE_REF}: ${message}`);
    return { readable: false, report: null };
  } finally {
    if (added) {
      try {
        execFileSync("git", ["worktree", "remove", "--force", tmp], {
          cwd: ROOT,
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        rmSync(tmp, { recursive: true, force: true });
      }
    } else {
      rmSync(tmp, { recursive: true, force: true });
    }
  }
}

function readBase() {
  if (process.env.PUBMAX_KNIP_BASE_REPORT) {
    try {
      return { readable: true, report: readJsonFile(process.env.PUBMAX_KNIP_BASE_REPORT) };
    } catch {
      return { readable: false, report: null };
    }
  }
  return baseReportFromWorktree();
}

function formatFinding(issue) {
  const loc =
    issue.line != null ? `:${issue.line}${issue.col != null ? `:${issue.col}` : ""}` : "";
  if (issue.type === "files") return `  unused file  ${issue.file}`;
  return `  unused ${issue.type}  ${issue.name}  ${issue.file}${loc}`;
}

function printDecision(decision) {
  if (decision.owned.length > 0) {
    const where =
      decision.mode === "branch"
        ? "introduced on this branch"
        : "in the tree (full knip gate)";
    console.error(`knip: ${decision.owned.length} unused ${where}`);
    for (const issue of decision.owned) console.error(formatFinding(issue));
  }
  if (decision.inherited.length > 0) {
    console.error(
      `knip: ${decision.inherited.length} unused inherited from ${BASE_REF}; not this branch's to delete. ` +
        `npm run deadcode:all names the full tree.`,
    );
    for (const issue of decision.inherited) console.error(formatFinding(issue));
  }
  if (decision.mode === "base-unreadable") {
    console.error(
      `knip: could not read ${BASE_REF}, so every finding fails (the full-tree gate).`,
    );
  }
}

const ahead = aheadCount();
const headIssues = flattenKnipReport(headReport());

let baseIssues = [];
// No findings on HEAD means we never need the base report; treat it as readable so
// verify does not print the full-tree fallback line on a clean branch.
let baseReadable = true;
if (!isMainlineGate(ahead) && errorIssues(headIssues).length > 0) {
  const base = readBase();
  baseReadable = base.readable;
  baseIssues = base.readable ? flattenKnipReport(base.report) : [];
}

const decision = decideKnipGate({
  aheadCount: ahead,
  headIssues,
  baseIssues,
  baseReadable,
});
printDecision(decision);
process.exit(decision.exitCode);
