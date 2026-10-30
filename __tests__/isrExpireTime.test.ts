import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { getCacheControlHeader } from "next/dist/server/lib/cache-control";
import { describe, expect, it } from "vitest";

// @ts-expect-error -- next.config.mjs has no declaration file.
import nextConfigModule from "@/next.config.mjs";

// SEO audit #2126, finding 3: Next's default expire is a year, so /today sent
// `s-maxage=300, stale-while-revalidate=31535700`. One global expireTime caps
// it (captain, 30 Oct 2026). Next drops the stale part when revalidate is not
// below expire, which would leave an hourly route serving its error page after
// a failed read instead of the last good copy, so every ISR route keeps a
// window of its own.

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

const header = (revalidate: number) =>
  getCacheControlHeader({ revalidate, expire: nextConfigModule.expireTime });

describe("the ISR stale window", () => {
  it("gives Today and Tonight one hour of stale copy, not a year", () => {
    const routes = isrRevalidateSeconds();
    expect(routes.get("app/today/page.tsx")).toBe(300);
    expect(routes.get("app/tonight/page.tsx")).toBe(300);
    expect(header(300)).toBe("s-maxage=300, stale-while-revalidate=3600");
  });

  it("keeps a five-minute stale window on the hourly routes", () => {
    expect(isrRevalidateSeconds().get("app/ledger/[id]/page.tsx")).toBe(3600);
    expect(header(3600)).toBe("s-maxage=3600, stale-while-revalidate=300");
  });

  it("leaves every ISR route a stale window of its own", () => {
    for (const [file, seconds] of isrRevalidateSeconds()) {
      expect(header(seconds), file).toContain("stale-while-revalidate=");
    }
  });
});
