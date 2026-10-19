// Two modules whose import paths differ only by case (18 Oct 2026).
//
// components/listing/PlacePhoto.tsx and components/listing/placePhoto.ts both
// answered `@/components/listing/PlacePhoto` on macOS, whose file system
// ignores case, so the macOS layout-pin build imported the rules file, found
// no default export and failed to type check, while Linux CI stayed green. An
// import path names a module without its extension, so two source files that
// lower-case to the same path without one may not sit side by side.

import { readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = process.cwd();
const MODULE = /\.(?:tsx?|mjs|cjs|jsx?)$/;

function modules(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules" || name.startsWith(".")) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) modules(full, out);
    else if (MODULE.test(name)) out.push(relative(ROOT, full));
  }
  return out;
}

describe("module paths", () => {
  it("never holds two modules whose import paths differ only by case", () => {
    const seen = new Map<string, string>();
    const clashes: string[] = [];
    for (const dir of ["app", "components", "lib", "scripts"]) {
      for (const file of modules(join(ROOT, dir))) {
        const key = file.replace(MODULE, "").replace(/\/index$/, "").toLowerCase();
        const other = seen.get(key);
        if (other && other.replace(MODULE, "") !== file.replace(MODULE, "")) clashes.push(`${other} <> ${file}`);
        else seen.set(key, file);
      }
    }
    expect(clashes).toEqual([]);
  });
});
