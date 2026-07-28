// /map MUST SHIP WITH THE PLACE INDEX IT OPENS.
//
// A `/map?place=…` arrival is resolved server-side against our own place index
// (lib/ukPlaceIndex.server.ts), by a path joined to process.cwd() at request
// time. Next traces only paths it can see statically, so it traces this one not
// at all, and whether the file is in the function is an accident of how Vercel
// grouped the routes — the same blind spot that made the freshness cron report
// every feed as "unknown" (__tests__/freshnessTracing.test.ts).
//
// The failure hides itself twice over: an unresolved place answers as an
// ordinary London map, which is exactly what a bad `place` param is SUPPOSED to
// do. So the reader now logs and retries rather than caching an empty index,
// and this fence pins the declaration against the one path constant both the
// config and the reader import.

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  UK_PLACE_INDEX_FILE,
  UK_PLACE_INDEX_TRACING_INCLUDE,
} from "@/lib/ukPlaceIndexFile.mjs";

const MAP_ROUTE = "/map";
const root = join(__dirname, "..");
const readerSource = readFileSync(
  join(root, "lib/ukPlaceIndex.server.ts"),
  "utf8",
);

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

describe("map place-index tracing", () => {
  const includes = tracingIncludes();

  it("declares the place index /map opens at request time", () => {
    expect(
      includes?.[MAP_ROUTE],
      "/map must declare the files it opens",
    ).toBeDefined();
    expect(includes[MAP_ROUTE]).toContain(UK_PLACE_INDEX_TRACING_INCLUDE);
  });

  it("traces the file the reader actually reads", () => {
    expect(readerSource).toContain("UK_PLACE_INDEX_FILE");
    expect(readerSource).not.toMatch(/join\(\s*process\.cwd\(\),\s*"public"/);
    expect(existsSync(join(root, UK_PLACE_INDEX_FILE))).toBe(true);
  });

  it("traces nothing else into the map function", () => {
    expect(includes[MAP_ROUTE]).toEqual([UK_PLACE_INDEX_TRACING_INCLUDE]);
  });

  it("keeps a failed read observable and retryable rather than cached empty", () => {
    expect(readerSource).toContain("console.error");
    expect(readerSource).toMatch(/catch \(error\) \{[\s\S]*?return null;/);
  });
});
