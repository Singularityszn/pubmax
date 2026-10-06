import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join } from "node:path";

import { describe, expect, it } from "vitest";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = process.cwd();

/**
 * The one-x product spellings, as whole words. The word boundaries are load
 * bearing: identifiers that merely start with the old spelling (`PubMaxingShell`,
 * `PubMaxingNotablePubs/0.1`) are deliberately out of scope, because this fence
 * is about prose the reader sees, not about renaming code.
 */
const MISSPELLING = /\bPub[Mm]axing\b/;

const SCAN_DIRS = ["docs", "app", "components", "lib", "scripts"] as const;

/** Files at the repo root that carry product prose and so are fenced too. */
const SCAN_ROOT_FILES = ["CONTEXT.md"] as const;

/**
 * Only text a human writes is read. Without this the walk slurps every
 * screenshot under `docs/proof/` into a UTF-8 string, which is about 0.9 GB of
 * PNG per run for no possible hit.
 */
const TEXT_EXTENSIONS = new Set([
  ".md",
  ".mdx",
  ".txt",
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".html",
  ".css",
  ".scss",
  ".yml",
  ".yaml",
  ".sql",
  ".sh",
]);

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  ".next-prod",
  ".git",
  // Ignored scratch: other suites create and delete temp trees here mid-walk.
  "test-results",
]);

/** Lines that intentionally retain one-x spellings (not product prose). */
function lineIsExplicitlyAllowed(relativePath: string, line: string): boolean {
  if (relativePath === "CONTEXT.md" && line.includes("_Avoid_:")) {
    return true;
  }
  if (relativePath === "lib/siteJsonLd.ts" && line.includes('"Pubmaxing"')) {
    return true;
  }
  if (
    relativePath === "docs/growth/SEARCH_CONSOLE.md" &&
    line.includes("Pub Maxxing, Pubmaxing")
  ) {
    return true;
  }
  if (
    (relativePath === "scripts/lib/overpassClient.mjs" ||
      relativePath === "scripts/fetch_city_osm_pubs.mjs") &&
    (line.includes("User-Agent") || line.includes("PubMaxing/0.1"))
  ) {
    return true;
  }
  return false;
}

function collectAgentsAndReadmes(relativeDir: string, out: Set<string>): void {
  const absoluteDir = relativeDir ? join(ROOT, relativeDir) : ROOT;
  for (const entry of readdirSync(absoluteDir)) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const rel = relativeDir ? `${relativeDir}/${entry}` : entry;
    const abs = join(absoluteDir, entry);
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      collectAgentsAndReadmes(rel, out);
      continue;
    }
    if (entry === "AGENTS.md" || entry === "README.md") {
      out.add(rel);
    }
  }
}

function walkFiles(absoluteDir: string, relativeDir: string, out: string[]): void {
  for (const entry of readdirSync(absoluteDir)) {
    if (SKIP_DIR_NAMES.has(entry)) continue;
    const abs = join(absoluteDir, entry);
    const rel = relativeDir ? `${relativeDir}/${entry}` : entry;
    const stat = statSync(abs);
    if (stat.isDirectory()) {
      walkFiles(abs, rel, out);
      continue;
    }
    if (stat.isFile() && TEXT_EXTENSIONS.has(extname(entry).toLowerCase())) {
      out.push(rel);
    }
  }
}

function collectScanTargets(): string[] {
  const files = new Set<string>();

  for (const dir of SCAN_DIRS) {
    const abs = join(ROOT, dir);
    const dirFiles: string[] = [];
    walkFiles(abs, dir, dirFiles);
    for (const f of dirFiles) files.add(f);
  }

  collectAgentsAndReadmes("", files);

  for (const file of SCAN_ROOT_FILES) files.add(file);

  return [...files].sort();
}

function findMisspellings(relativePath: string): string[] {
  const text = readFileSync(join(ROOT, relativePath), "utf8");
  const hits: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (lineIsExplicitlyAllowed(relativePath, defined(line))) continue;
    if (MISSPELLING.test(defined(line))) {
      hits.push(`${relativePath}:${i + 1}`);
    }
  }
  return hits;
}

describe("product name spelling (PubMaxxing in prose)", () => {
  it("does not use the one-x PubMaxing / Pubmaxing spellings outside explicit allowlists", () => {
    const violations: string[] = [];
    for (const file of collectScanTargets()) {
      violations.push(...findMisspellings(file));
    }
    expect(violations, violations.join("\n")).toEqual([]);
  });

  it("catches the one-x spellings and leaves identifiers and the real name alone", () => {
    expect(MISSPELLING.test("PubMaxing is a planner")).toBe(true);
    expect(MISSPELLING.test("the Pubmaxing dataset")).toBe(true);
    expect(MISSPELLING.test("PubMaxingShell mounts PubMap")).toBe(false);
    expect(MISSPELLING.test("PubMaxxing is a planner")).toBe(false);
  });

  it("scans the files it claims to scan", () => {
    const targets = new Set(collectScanTargets());
    expect(targets.has("CONTEXT.md")).toBe(true);
    expect(targets.has("AGENTS.md")).toBe(true);
    expect(targets.has("README.md")).toBe(true);
    expect(targets.has("lib/siteJsonLd.ts")).toBe(true);
    expect(targets.has("docs/growth/SEARCH_CONSOLE.md")).toBe(true);
    expect(targets.has("scripts/lib/overpassClient.mjs")).toBe(true);
  });
});
