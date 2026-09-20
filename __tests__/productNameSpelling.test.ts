import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MISSPELLING = /\bPub[Mm]axing\b/g;

const SCAN_DIRS = ["docs", "app", "components", "lib", "scripts"] as const;

const SKIP_DIR_NAMES = new Set([
  "node_modules",
  ".next",
  ".next-prod",
  ".git",
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
    if (stat.isFile()) {
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

  return [...files].sort();
}

function findMisspellings(relativePath: string): string[] {
  const text = readFileSync(join(ROOT, relativePath), "utf8");
  const hits: string[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (lineIsExplicitlyAllowed(relativePath, line)) continue;
    if (MISSPELLING.test(line)) {
      hits.push(`${relativePath}:${i + 1}`);
      MISSPELLING.lastIndex = 0;
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
});
