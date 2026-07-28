// EVERY REQUEST-TIME DATA-PACK READER MUST SHIP THE FILES IT OPENS.
//
// lib/venueIndex.ts builds each city pack path from config at request time, and
// lib/venueDetailIndex.ts builds the detail manifest, rows and raw dataset paths
// the same way, so Next cannot discover those files from the reader bundle. A
// build may still contain them through incidental route grouping, but that is
// not a contract.
//
// Route discovery therefore follows local imports from App Router entries to
// each pack's module (lib/venueIndexTracing.mjs RUNTIME_DATA_PACKS). This test
// pins both halves independently: a synthetic import graph proves discovery
// follows helpers, converts route conventions and merges two packs on one
// route, then every reader in the real graph must be represented in evaluated
// Next config.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  RUNTIME_DATA_PACKS,
  discoverRuntimeReaderRouteGlobs,
  runtimeDataPackRouteIncludes,
} from "@/lib/venueIndexTracing.mjs";

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

describe("runtime data-pack tracing", () => {
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

    expect(discoverRuntimeReaderRouteGlobs(temporaryRoots[0], "lib/venueIndex.ts")).toEqual([
      "/api/direct",
      "/bar/\\[id\\]/opengraph-image",
      "/cyclic",
      "/nested",
    ]);
  });

  it("declares each pack's own files, and merges both where one route reads both", () => {
    temporaryRoots.push(mkdtempSync(join(tmpdir(), "venue-index-tracing-")));

    const [venueIndexPack, venueDetailPack] = RUNTIME_DATA_PACKS;
    writeFixture(venueIndexPack.module, "export async function getVenueIndex() {}");
    writeFixture(venueDetailPack.module, "export async function getVenueDetail() {}");
    writeFixture(
      "app/api/packs/route.ts",
      `import "@/${venueIndexPack.module.replace(/\.ts$/, "")}";\n` +
        `import "@/${venueDetailPack.module.replace(/\.ts$/, "")}";\n`,
    );
    writeFixture(
      "app/detail/page.tsx",
      `import "@/${venueDetailPack.module.replace(/\.ts$/, "")}";\n` +
        "export default function Page() { return null; }\n",
    );

    const includes = runtimeDataPackRouteIncludes(temporaryRoots[0]);

    expect(new Set(Object.keys(includes))).toEqual(new Set(["/api/packs", "/detail"]));
    expect(new Set(includes["/api/packs"])).toEqual(
      new Set([...venueIndexPack.files, ...venueDetailPack.files]),
    );
    expect(new Set(includes["/detail"])).toEqual(new Set(venueDetailPack.files));
  });

  it("declares every pack file for every discovered runtime reader of that pack", () => {
    const includes = tracingIncludes();

    expect(RUNTIME_DATA_PACKS.length).toBeGreaterThan(0);
    for (const pack of RUNTIME_DATA_PACKS) {
      const routes = discoverRuntimeReaderRouteGlobs(root, pack.module);

      expect(routes.length, `${pack.id} must have runtime readers`).toBeGreaterThan(0);
      expect(pack.files.length, `${pack.id} must declare files`).toBeGreaterThan(0);
      for (const route of routes) {
        expect(includes[route], `${route} must declare ${pack.id} files`).toBeDefined();
        for (const file of pack.files) {
          expect(includes[route], `${route} is missing ${file}`).toContain(file);
        }
      }
    }
  });
});
