// EVERY REQUEST-TIME VENUE-INDEX READER MUST SHIP THE VENUE PACKS.
//
// lib/venueIndex.ts builds each pack path from city config at request time, so
// Next cannot discover those files from the reader bundle. A build may still
// contain them through incidental route grouping, but that is not a contract.
//
// Route discovery therefore follows local imports from App Router entries to
// lib/venueIndex.ts. This test pins both halves independently: a synthetic
// import graph proves discovery follows helpers and converts route conventions,
// then the real graph must be represented in evaluated Next config.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { enabledVenuePackIncludes } from "@/lib/cityVenuePacks.mjs";
import { discoverVenueIndexRouteGlobs } from "@/lib/venueIndexTracing.mjs";

const root = join(__dirname, "..");
const temporaryRoots: string[] = [];

function tracingIncludes(): Record<string, string[]> {
  const out = execFileSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "const m = await import(process.argv[1]);" +
        "console.log(JSON.stringify(m.default.outputFileTracingIncludes ?? null));",
      join(root, "next.config.mjs"),
    ],
    { cwd: root, encoding: "utf8" },
  );
  return JSON.parse(out) as Record<string, string[]>;
}

function writeFixture(relativePath: string, source: string): void {
  const fixtureRoot = temporaryRoots.at(-1);
  if (!fixtureRoot) throw new Error("fixture root missing");
  const file = join(fixtureRoot, relativePath);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, source);
}

afterEach(() => {
  for (const directory of temporaryRoots.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("venue-index runtime tracing", () => {
  it("derives route globs by following local imports from App Router entries", () => {
    temporaryRoots.push(mkdtempSync(join(tmpdir(), "venue-index-tracing-")));

    writeFixture("lib/venueIndex.ts", "export async function getVenueIndex() {}");
    writeFixture(
      "components/serverVenue.ts",
      'import { getVenueIndex } from "@/lib/venueIndex";\nexport { getVenueIndex };\n',
    );
    writeFixture(
      "app/nested/reader.ts",
      'export { getVenueIndex } from "@/components/serverVenue";\n',
    );
    writeFixture(
      "app/nested/page.tsx",
      'import { getVenueIndex } from "./reader";\nexport default getVenueIndex;\n',
    );
    writeFixture(
      "app/api/direct/route.ts",
      'import { getVenueIndex } from "@/lib/venueIndex";\nexport const GET = getVenueIndex;\n',
    );
    writeFixture(
      "app/bar/[id]/opengraph-image.tsx",
      'import { getVenueIndex } from "@/lib/venueIndex";\nexport default getVenueIndex;\n',
    );
    writeFixture(
      "app/cyclic/a.ts",
      'import "./b";\nexport { getVenueIndex } from "@/lib/venueIndex";\n',
    );
    writeFixture("app/cyclic/b.ts", 'export * from "./a";\n');
    writeFixture("app/cyclic/page.tsx", 'export * from "./b";\n');
    writeFixture("app/unrelated/page.tsx", "export default function Page() { return null; }\n");

    expect(discoverVenueIndexRouteGlobs(temporaryRoots[0])).toEqual([
      "/api/direct",
      "/bar/\\[id\\]/opengraph-image",
      "/cyclic",
      "/nested",
    ]);
  });

  it("declares every enabled venue pack for every discovered runtime reader", () => {
    const routes = discoverVenueIndexRouteGlobs(root);
    const packs = enabledVenuePackIncludes();
    const includes = tracingIncludes();

    expect(routes.length).toBeGreaterThan(0);
    expect(packs.length).toBeGreaterThan(0);
    for (const route of routes) {
      expect(includes[route], `${route} must declare venue-index files`).toBeDefined();
      for (const pack of packs) {
        expect(includes[route], `${route} is missing ${pack}`).toContain(pack);
      }
    }
  });
});
