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
const POINTER = /`([A-Za-z0-9_@./*\[\]{}<>-]+\.[A-Za-z0-9_@./*\[\]{}<>-]+|[A-Za-z0-9_@./*\[\]{}<>-]+\/)`/g;

// Explicit non-file names remain here so real repository pointers are checked.
const NOT_REPO_PATHS = new Set([
  // Next development route types are generated and absent from a clean clone.
  "./.next/dev/types/routes.d.ts",
  // Server suffix names a convention, not one concrete file.
  ".server.ts",
  // Generic JSON glob names a publish input class, not one repository file.
  "*.json",
  // Generic manifest name is a publish input, not the repository root file.
  "manifest.json",
  // ESM declaration suffix names a sidecar convention, not one concrete file.
  ".d.mts",
  // Homepage card uses `/api/home-card`, not this absent Next file convention.
  "opengraph-image.tsx",
  // Next trace suffix names generated output, not a committed file.
  ".nft.json",
  // This glob names a class of server modules, not one concrete file.
  "lib/**/*.server.ts",
  // Member name, not a repository path.
  "AuthProvider.updateSession",
  // Database column glob, not a repository path.
  "profiles.cover_*",
  // Analytics event name, not a repository path.
  "uploaded_image.scan_skipped",
  // Database column name, not a repository path.
  "plan_crew_members.token_hash",
  // Database column name, not a repository path.
  "community_prices.actor",
  // Database column name, not a repository path.
  "venue_occupancy_flags.actor_hash",
  // External host policy endpoint, not a repository path.
  "robots.txt",
  // Database column name, not a repository path.
  "profiles.founding_member_number",
  // Date-template path, not a literal repository path.
  "public/data/pint_index/<YYYY-MM>.json",
  // Next configuration property, not a repository path.
  "experimental.staleTimes",
  // URL in trailing-slash law, not a repository path.
  "/api/thing/",
  // Harvest working directory is gitignored by design.
  "data-harvest/bars-enriched/",
  // Throwaway Overpass working directory is absent from clean clones.
  "raw_venues/",
]);

function pointers(): string[] {
  const found = new Set<string>();
  for (const match of DOC.matchAll(POINTER)) {
    const raw = (match[1] ?? match[2] ?? "").trim();
    if (!raw || NOT_REPO_PATHS.has(raw)) continue;
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

  it("keeps its pointers, so a trim cannot quietly gut it", () => {
    // A pointer document with no pointers has stopped being one, and the
    // pointer is the half a future reader cannot reconstruct: prose can be
    // re-derived from the code, the knowledge of WHICH file owns a rule cannot.
    // So this floor RATCHETS. It sits just under the shipped count rather than
    // far below it, because a floor hundreds of pointers beneath the number it guards
    // reads as protection and can never fire. Same rule as the performance
    // budgets: take it UP when the count rises, and take it DOWN only in the
    // commit that removes pointers on purpose, with the reason.
    expect(pointers().length).toBeGreaterThan(538);
  });
});
