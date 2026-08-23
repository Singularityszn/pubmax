import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const UNSUFFIXED_SERVER_ONLY_MODULES = [
  "freshnessArtifact.ts",
  "importNotesStore.ts",
  "supabase.ts",
  "ukBaseIndex.ts",
] as const;

function listLibServerModules(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...listLibServerModules(path));
      continue;
    }
    if (entry.endsWith(".server.ts")) out.push(path);
  }
  return out;
}

describe("server-only guard (#1043 L8)", () => {
  it("every server-only lib module imports server-only", () => {
    const root = join(process.cwd(), "lib");
    const files = [
      ...listLibServerModules(root),
      ...UNSUFFIXED_SERVER_ONLY_MODULES.map((file) => join(root, file)),
    ];
    const missing = files.filter((file) => {
      const source = readFileSync(file, "utf8");
      return !/import\s+["']server-only["']/.test(source);
    });
    expect(missing, missing.join("\n")).toEqual([]);
  });
});
