import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

const ROOT = join(__dirname, "..");

function resolveSpec(spec: string, fromFile: string): string | null {
  let base: string;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith("./") || spec.startsWith("../")) base = resolve(dirname(fromFile), spec);
  else return null;
  for (const ext of ["", ".ts", ".tsx", ".mjs", ".js", ".json", "/index.ts", "/index.tsx"]) {
    const candidate = base + ext;
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function staticImportGraph(entry: string): Map<string, string | null> {
  const seen = new Map<string, string | null>([[join(ROOT, entry), null]]);
  const queue = [join(ROOT, entry)];
  while (queue.length) {
    const file = queue.shift() as string;
    if (file.endsWith(".json")) continue;
    let source = "";
    try {
      source = readFileSync(file, "utf8");
    } catch {
      continue;
    }
    const specs: string[] = [];
    const withBindings =
      /(?:^|\n)\s*(?:import|export)\s+(?!type\s)(?:[\s\S]*?)\s*from\s*["']([^"']+)["']/g;
    const sideEffect = /(?:^|\n)\s*import\s+["']([^"']+)["']/g;
    let match: RegExpExecArray | null;
    while ((match = withBindings.exec(source))) specs.push(match[1]);
    while ((match = sideEffect.exec(source))) specs.push(match[1]);
    for (const spec of specs) {
      const resolved = resolveSpec(spec, file);
      if (!resolved || seen.has(resolved)) continue;
      seen.set(resolved, file);
      queue.push(resolved);
    }
  }
  return seen;
}

function readPackageJson(): Record<string, unknown> {
  return JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as Record<
    string,
    unknown
  >;
}

function allDependencyNames(pkg: Record<string, unknown>): string[] {
  const names: string[] = [];
  for (const field of ["dependencies", "devDependencies", "optionalDependencies"]) {
    const block = pkg[field];
    if (block && typeof block === "object") {
      names.push(...Object.keys(block as Record<string, string>));
    }
  }
  return names;
}

describe("venue reveal dependency fence", () => {
  const forbidden = [
    /^three$/,
    /^@react-three\//,
    /^lottie/,
    /^@rive-app\//,
    /^@designcodeio\//,
  ];

  it("does not add forbidden 3D or motion-library packages", () => {
    const names = allDependencyNames(readPackageJson());
    for (const name of names) {
      for (const pattern of forbidden) {
        expect(name, `forbidden package ${name}`).not.toMatch(pattern);
      }
    }
  });

  it("keeps the venue inspector off the eager PubMap graph", () => {
    const mapShell = staticImportGraph("components/PubMap.tsx");
    expect(mapShell.has(join(ROOT, "components/map/VenueInspector.tsx"))).toBe(
      false,
    );
  });
});
