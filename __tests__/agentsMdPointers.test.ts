import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join } from "node:path";

import { describe, expect, it } from "vitest";

// AGENTS.md is a POINTER document, so a pointer that no longer resolves is the
// one way it can rot silently. Nothing else reads this file: no test, script or
// e2e spec opens it, so the suite cannot otherwise tell whether a law still
// names a real module or a fence that was renamed a month ago.
//
// This fence answers only that question. It says nothing about what the prose
// claims, because a document that must be true cannot be checked by a test;
// what it CAN check is that every file, test and directory the prose sends a
// reader to is still there.
//
// Written while trimming the file from 164KB to a pointer document, during
// which a bullet count plus an identifier diff caught four laws that would
// otherwise have been shipped dropped or gutted. That check was manual and
// one-off; this is the part of it worth keeping.

const ROOT = process.cwd();
const DOC = readFileSync(join(ROOT, "AGENTS.md"), "utf8");

/** Backticked tokens that look like a path into this repository. */
const POINTER = /`([A-Za-z0-9_@./*[\]-]+\.(?:ts|tsx|mjs|mts|sql|json|css|md))`|`([a-z0-9_/-]+\/)`/g;

// Names that look like repo paths but are package specifiers, generated
// artifacts, or files a reader is told to create rather than find.
const NOT_REPO_PATHS = new Set([
  "next.config.mjs",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "vercel.json",
  "playwright.config.ts",
  "proxy.ts",
  ".env.local",
  "next-env.d.ts",
  "./.next/dev/types/routes.d.ts",
  ".server.ts",
  "*.json",
]);

function pointers(): string[] {
  const found = new Set<string>();
  for (const match of DOC.matchAll(POINTER)) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (!raw || NOT_REPO_PATHS.has(raw)) continue;
    // Only paths, not bare filenames: a bare name is prose, not a pointer.
    if (!raw.includes("/")) continue;
    if (raw.startsWith("@") || raw.startsWith("http")) continue;
    // `lib/**/*.server.ts` names a CLASS of files rather than one path. That is
    // prose about a convention, and resolving it would only assert that the
    // convention has at least one member, which is not what the law says.
    if (raw.includes("**")) continue;
    found.add(raw);
  }
  return [...found].sort();
}

/** Resolve a pointer that may carry a `*` segment or be a directory. */
function resolves(pointer: string): boolean {
  const full = join(ROOT, pointer);
  if (existsSync(full)) return true;
  if (!pointer.includes("*")) return false;
  const dir = join(ROOT, dirname(pointer));
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  const pattern = new RegExp(
    `^${pointer.slice(pointer.lastIndexOf("/") + 1).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`,
  );
  return readdirSync(dir).some((entry) => pattern.test(entry));
}

describe("AGENTS.md pointers", () => {
  it("sends every reader to a file or directory that exists", () => {
    const dangling = pointers().filter((pointer) => !resolves(pointer));
    expect(dangling, "AGENTS.md points at paths that are no longer here").toEqual([]);
  });

  it("still carries pointers at all, so a trim cannot quietly gut it", () => {
    // A pointer document with no pointers has stopped being one. The floor is
    // deliberately far below the current count: this catches a wholesale
    // deletion, not ordinary editing.
    expect(pointers().length).toBeGreaterThan(150);
  });
});
