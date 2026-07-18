import type { NextConfig } from "next";
import { describe, expect, it } from "vitest";

// next.config.mjs is plain JS with no type declaration; import it and pin the
// shape locally so the test stays typed without a bespoke .d.ts.
// @ts-expect-error -- no declaration file for the JS config module.
import nextConfigModule from "@/next.config.mjs";

const nextConfig = nextConfigModule as NextConfig;

type RedirectRule = {
  source: string;
  destination: string;
  permanent?: boolean;
};

async function loadRedirects(): Promise<RedirectRule[]> {
  expect(typeof nextConfig.redirects).toBe("function");
  return (await nextConfig.redirects!()) as RedirectRule[];
}

describe("next.config redirects", () => {
  it("sends the retired /stories route to /feed permanently", async () => {
    const rule = (await loadRedirects()).find((entry) => entry.source === "/stories");
    expect(rule).toMatchObject({
      source: "/stories",
      destination: "/feed",
      permanent: true,
    });
  });

  it("carries deep /stories/* links to /feed too", async () => {
    const rule = (await loadRedirects()).find(
      (entry) => entry.source === "/stories/:path*",
    );
    expect(rule).toMatchObject({
      destination: "/feed",
      permanent: true,
    });
  });

  it("sends the bare /you path to the canonical /u/you profile route permanently", async () => {
    const rule = (await loadRedirects()).find((entry) => entry.source === "/you");
    expect(rule).toMatchObject({
      source: "/you",
      destination: "/u/you",
      permanent: true,
    });
  });
});
