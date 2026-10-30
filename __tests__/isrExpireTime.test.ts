import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { describe, expect, it } from "vitest";

// @ts-expect-error -- next.config.mjs has no declaration file.
import nextConfigModule from "@/next.config.mjs";

// SEO audit #2126, finding 3: Next's default expire is a year, so /today could
// serve a stale copy for up to 31,535,700 seconds. The captain chose one global
// hour (30 Oct 2026). Next builds an ISR header as
// `s-maxage=<revalidate>, stale-while-revalidate=<expire - revalidate>` and
// drops the stale part when revalidate is not below expire.

function pageFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return pageFiles(path);
    return /^(page|route)\.tsx?$/.test(name) ? [path] : [];
  });
}

function isrRevalidateSeconds(): Map<string, number> {
  const routes = new Map<string, number>();
  for (const file of pageFiles(join(process.cwd(), "app"))) {
    const match = /^export const revalidate = (\d+);/m.exec(readFileSync(file, "utf8"));
    if (match && Number(match[1]) > 0) routes.set(relative(process.cwd(), file), Number(match[1]));
  }
  return routes;
}

describe("the ISR stale window", () => {
  it("is one hour for every ISR route", () => {
    expect(nextConfigModule.expireTime).toBe(3600);
  });

  it("is never shorter than a route's own revalidate, which Next would refuse to serve stale from", () => {
    const routes = isrRevalidateSeconds();
    expect(routes.get("app/today/page.tsx")).toBe(300);
    expect(routes.get("app/tonight/page.tsx")).toBe(300);
    for (const [file, seconds] of routes) {
      expect(seconds, file).toBeLessThanOrEqual(nextConfigModule.expireTime);
    }
  });
});
