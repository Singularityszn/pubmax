import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { NextConfig } from "next";
// The converter `next typegen` runs on every next.config redirect and rewrite
// source to build the typedRoutes route list.
import { convertCustomRouteSource } from "next/dist/server/lib/router-utils/route-types-utils.js";
import { describe, expect, it } from "vitest";

// next.config.mjs is plain JS with no type declaration; import it and pin the
// shape locally so the test stays typed without a bespoke .d.ts.
// @ts-expect-error -- no declaration file for the JS config module.
import nextConfigModule from "@/next.config.mjs";

const nextConfig = nextConfigModule as NextConfig;

type HasCondition = { type: string; value?: string; key?: string };
type RedirectRule = {
  source: string;
  destination: string;
  permanent?: boolean;
  has?: HasCondition[];
};

// The www redirect is served by Vercel's edge from the shipped vercel.json.
function loadVercelRedirects(): RedirectRule[] {
  const vercelConfig = JSON.parse(
    readFileSync(join(process.cwd(), "vercel.json"), "utf8"),
  ) as { redirects?: RedirectRule[] };
  return vercelConfig.redirects ?? [];
}

function findWwwRule(): RedirectRule | undefined {
  return loadVercelRedirects().find(
    (entry) =>
      entry.source === "/:path*" &&
      entry.has?.some(
        (c) => c.type === "host" && c.value === "www.pubmaxxing.com",
      ),
  );
}

// SEO split-brain fix (docs/SEO_CANONICAL_RUNBOOK_2026-07-21.md): www must not
// serve a 200 mirror — it has to 308 to the apex so Google collapses the two
// hosts into one indexed site.
describe("www → apex host redirect", () => {
  it("permanently redirects the www host to the apex for every path", () => {
    expect(findWwwRule()).toMatchObject({
      source: "/:path*",
      destination: "https://pubmaxxing.com/:path*",
      permanent: true,
    });
  });

  it("only fires for the www host, never self-redirecting the apex", () => {
    const hosts = (findWwwRule()?.has ?? [])
      .filter((c) => c.type === "host")
      .map((c) => c.value);
    expect(hosts).toEqual(["www.pubmaxxing.com"]);
  });

  it("targets the HTTPS apex origin so the redirect resolves the host in one hop", () => {
    expect(findWwwRule()?.destination.startsWith("https://pubmaxxing.com")).toBe(
      true,
    );
  });
});

// typedRoutes checks every next/link href against the routes `next typegen`
// writes, and typegen adds each redirect and rewrite source as a route while
// ignoring `has`. A source that converts to a root dynamic route such as
// "/[[...path]]" matches every literal path, so a link to a page that does not
// exist would pass the typecheck. The www redirect above was that source.
describe("next.config route sources and typedRoutes", () => {
  it("never hands typegen a source that becomes a root catch-all route", async () => {
    const redirects = (await nextConfig.redirects?.()) ?? [];
    const rewrites = await nextConfig.rewrites?.();
    const rewriteRules = Array.isArray(rewrites)
      ? rewrites
      : [
          ...(rewrites?.beforeFiles ?? []),
          ...(rewrites?.afterFiles ?? []),
          ...(rewrites?.fallback ?? []),
        ];
    const sources = [...redirects, ...rewriteRules].map((rule) => rule.source);
    expect(sources.length).toBeGreaterThan(0);

    const rootDynamic = sources.filter((source) =>
      convertCustomRouteSource(source).some((route) => route.startsWith("/[")),
    );
    expect(rootDynamic).toEqual([]);
  });
});
