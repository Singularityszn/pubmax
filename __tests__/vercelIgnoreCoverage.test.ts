import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, it, expect } from "vitest";

/**
 * A DEPLOY UPLOADS THE WORKING TREE, NOT THE COMMIT.
 *
 * `vercel deploy` from a CLI uploads the directory it runs in, gitignored
 * files included, so .gitignore protects nothing from an upload and every
 * large local artifact ships unless `.vercelignore` names it. Measured on
 * this worktree, the unlisted directories came to hundreds of megabytes of
 * agent tooling, native shells and harvest output, none of which `next build`
 * reads.
 *
 * The rule this fence holds: a top-level directory over 5 MB is either a
 * DEPLOY INPUT named below with the reason it is one, or it is listed in
 * `.vercelignore`. There is no third answer, because the third answer is how
 * the upload grows without anybody noticing.
 */
const SIZE_FLOOR_BYTES = 5 * 1024 * 1024;

/** Top-level directories the build or the runtime genuinely reads. */
const DEPLOY_INPUTS: Record<string, string> = {
  node_modules: "installed by Vercel; never part of the upload it inspects",
  app: "the Next.js App Router tree",
  components: "imported by the app tree",
  lib: "imported by the app tree",
  public: "served static assets, including every data pack",
  data: "read by the prebuild pack builders and the freshness registry",
  scripts: "the prebuild pack builders",
  types: "TypeScript declarations the build compiles against",
  supabase: "migrations read by validate-data at build",
  perf: "budgets read by the build-time checks",
};

function ignoredPrefixes(): string[] {
  const source = readFileSync(join(process.cwd(), ".vercelignore"), "utf8");
  return source
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
    .map((line) => line.replace(/^\/+/, "").replace(/\/+$/, ""));
}

function isIgnored(name: string, patterns: readonly string[]): boolean {
  return patterns.some((pattern) => {
    if (pattern === name) return true;
    if (pattern.endsWith("*")) return name.startsWith(pattern.slice(0, -1));
    return false;
  });
}

function directoryBytes(dir: string, budget = { seen: 0 }): number {
  let total = 0;
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return 0;
  }
  for (const entry of entries) {
    if (budget.seen > 200_000) break;
    budget.seen += 1;
    const full = join(dir, entry);
    let stat;
    try {
      stat = statSync(full);
    } catch {
      continue;
    }
    if (stat.isSymbolicLink()) continue;
    total += stat.isDirectory() ? directoryBytes(full, budget) : stat.size;
  }
  return total;
}

describe(".vercelignore covers what a deploy would otherwise upload", () => {
  it("lists the directories the audit found open", () => {
    const patterns = ignoredPrefixes();
    for (const name of [
      ".next",
      "data-harvest",
      ".opencode",
      ".cursor",
      ".agents",
      ".gnhf",
      "skills",
      ".firecrawl",
      ".tmp-evidence",
      "e2e-shots",
    ]) {
      expect({ name, listed: isIgnored(name, patterns) }).toEqual({
        name,
        listed: true,
      });
    }
  });

  it("no top-level directory over 5 MB is both unlisted and not a deploy input", () => {
    const patterns = ignoredPrefixes();
    const offenders: Record<string, string> = {};
    for (const entry of readdirSync(process.cwd())) {
      if (entry === ".git") continue;
      const full = join(process.cwd(), entry);
      let stat;
      try {
        stat = statSync(full);
      } catch {
        continue;
      }
      if (!stat.isDirectory()) continue;
      if (entry in DEPLOY_INPUTS) continue;
      if (isIgnored(entry, patterns)) continue;
      const bytes = directoryBytes(full);
      if (bytes > SIZE_FLOOR_BYTES) {
        offenders[entry] = `${Math.round(bytes / 1024 / 1024)} MB`;
      }
    }
    expect(offenders).toEqual({});
  });

  it("keeps the deploy-input list honest: each row is a directory that exists", () => {
    const missing = Object.keys(DEPLOY_INPUTS).filter((name) => {
      try {
        return !statSync(join(process.cwd(), name)).isDirectory();
      } catch {
        return true;
      }
    });
    expect(missing).toEqual([]);
  });
});
