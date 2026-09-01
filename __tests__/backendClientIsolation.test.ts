// Which backend client each surface actually pays for.
//
// U4 of docs/plans/SITE_SPEED_2026-09-01.md. Two backend clients ship as
// dependencies, `@supabase/supabase-js` and `convex`, and the question the unit
// asks is entry-point isolation rather than removal: is either parsed on a
// route that does not use it?
//
// Swept on production 2026-09-01 by fetching every same-origin script each
// route loaded and reading the libraries out of the text (decoded KB):
//
//   route      total  MapLibre  Convex  ElevenLabs  Supabase
//   /           1144         0       0           0       344
//   /pal        1746         0       0         603       363
//   /map        2599      1024       0           0       503
//   /today      1180         0       0           0       341
//   /tonight    1175         0       0           0       341
//   /out        1129         0       0           0       341
//   /about      1082         0       0           0       341
//   /pubs       1093         0       0           0       341
//
// Three findings.
//
//  1. Supabase is on every route as the same ~341 KB, and it is FETCHED AFTER
//     PAINT by ensureSupabaseBrowser's dynamic import (measured starting around
//     t=630 ms). It is the session, so every route genuinely uses it, and it is
//     already off the critical path. Nothing to isolate.
//  2. MapLibre is on /map and nowhere else. Already isolated.
//  3. Convex reaches NO browser bundle on any route, and no module under app,
//     components or lib imports it outside lib/convex, whose two files are
//     imported only by tests. Recorded for the captain rather than removed:
//     the convex/ directory carries a real schema and a migration scaffold
//     under the Wave 0.6 containment law (__tests__/convexContainment.test.ts),
//     so "no browser pays for it" is the finding, not "delete the dependency".
//
// This file is the fence that keeps those three true.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const REPO_ROOT = join(__dirname, "..");

function sourceFiles(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string): void => {
    for (const entry of readdirSync(current)) {
      if (entry === "node_modules" || entry.startsWith(".")) continue;
      const full = join(current, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (full.endsWith(".ts") || full.endsWith(".tsx")) found.push(full);
    }
  };
  walk(join(REPO_ROOT, dir));
  return found;
}

function importsPackage(source: string, name: string): boolean {
  return new RegExp(`from ["']${name}(?:/[^"']*)?["']`).test(source);
}

describe("no browser route pays for Convex", () => {
  it("is imported by nothing the app renders", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components", "lib"]) {
      for (const file of sourceFiles(dir)) {
        const relative = file.slice(REPO_ROOT.length + 1);
        // lib/convex holds the contracts and the migration scaffold. They are
        // types and tables, and no route imports them.
        if (relative.startsWith("lib/convex/")) continue;
        const source = readFileSync(file, "utf8");
        if (importsPackage(source, "convex")) offenders.push(relative);
      }
    }
    expect(
      offenders,
      "a route importing convex needs an owner ruling first (Wave 0.6 containment)",
    ).toEqual([]);
  });
});

describe("MapLibre stays on the map", () => {
  it("is imported only by the map canvas and its own scene modules", () => {
    const offenders: string[] = [];
    for (const dir of ["app", "components", "lib"]) {
      for (const file of sourceFiles(dir)) {
        const relative = file.slice(REPO_ROOT.length + 1);
        const source = readFileSync(file, "utf8");
        if (!importsPackage(source, "maplibre-gl")) continue;
        // A type-only import costs a browser nothing.
        if (/import type \* as maplibregl from ["']maplibre-gl["']/.test(source)) continue;
        if (/import type \{[^}]*\} from ["']maplibre-gl["']/.test(source)) continue;
        const onTheMap =
          relative.startsWith("components/map/") ||
          relative === "components/PubMapCanvas.tsx" ||
          relative.startsWith("lib/map");
        if (!onTheMap) offenders.push(relative);
      }
    }
    expect(offenders).toEqual([]);
  });
});

describe("the Supabase browser client stays off the critical path", () => {
  const authClient = readFileSync(join(REPO_ROOT, "lib/authClient.ts"), "utf8");

  it("is reached through a dynamic import, never a static one", () => {
    expect(authClient).toContain('import("@supabase/supabase-js")');
    expect(authClient).not.toMatch(
      /^import \{[^}]*\} from ["']@supabase\/supabase-js["']/m,
    );
  });

  it("keeps the type-only import type-only", () => {
    expect(authClient).toContain(
      'import type { SupabaseClient } from "@supabase/supabase-js"',
    );
  });
});
