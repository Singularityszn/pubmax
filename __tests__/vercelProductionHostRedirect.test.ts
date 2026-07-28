import type { NextConfig } from "next";
import { afterEach, describe, expect, it, vi } from "vitest";

// @ts-expect-error -- next.config.mjs is JavaScript without a declaration file.
import nextConfigModule from "@/next.config.mjs";

const nextConfig = nextConfigModule as NextConfig;

type HostCondition = { type: string; value?: string };
type RedirectRule = {
  source: string;
  destination: string;
  permanent?: boolean;
  has?: HostCondition[];
};

afterEach(() => {
  vi.unstubAllEnvs();
});

async function loadRedirects(): Promise<RedirectRule[]> {
  expect(typeof nextConfig.redirects).toBe("function");
  return (await nextConfig.redirects!()) as RedirectRule[];
}

function hostRuleMatches(rule: RedirectRule, host: string): boolean {
  return (
    rule.has?.some(
      (condition) =>
        condition.type === "host" &&
        typeof condition.value === "string" &&
        new RegExp(`^(?:${condition.value})$`).test(host),
    ) ?? false
  );
}

describe("Vercel production host canonicalisation", () => {
  it("permanently redirects any production vercel.app alias to the apex", async () => {
    vi.stubEnv("VERCEL_ENV", "production");

    const rule = (await loadRedirects()).find((entry) =>
      hostRuleMatches(entry, "chengdu-pubmax69.vercel.app"),
    );

    expect(rule).toMatchObject({
      source: "/:path*",
      destination: "https://pubmaxxing.com/:path*",
      permanent: true,
    });
    expect(rule?.destination).not.toContain("?");
    expect(hostRuleMatches(rule!, "pubmaxxing.com")).toBe(false);
  });

  it("does not redirect vercel.app hosts in preview builds", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");

    expect(
      (await loadRedirects()).some((entry) =>
        hostRuleMatches(entry, "pubmax-git-auth-preview.vercel.app"),
      ),
    ).toBe(false);
  });

  it("does not redirect vercel.app hosts in local builds", async () => {
    vi.stubEnv("VERCEL_ENV", "");

    expect(
      (await loadRedirects()).some((entry) =>
        hostRuleMatches(entry, "localhost.vercel.app"),
      ),
    ).toBe(false);
  });
});
