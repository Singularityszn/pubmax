import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { Children, createElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseFragment } from "parse5";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const request = vi.hoisted(() => ({ nonce: undefined as string | undefined }));
vi.mock("next/headers", () => ({ headers: async () => ({ get: () => request.nonce }) }));
vi.mock("next/font/google", () => ({
  Space_Grotesk: () => ({ variable: "display", style: { fontFamily: "Display, Display Fallback" } }),
  Inter: () => ({ variable: "body", style: { fontFamily: "Body, Body Fallback" } }),
}));
vi.mock("next/font/local", () => ({ default: () => ({ variable: "mono" }) }));

import RootLayout from "@/app/layout";
import { defined } from "@/__tests__/helpers/defined";

// A CEILING A RETRY CAN LAUNDER IS NOT A CEILING.
//
// playwright.config.ts retries once on CI. Playwright calls a test that fails
// and then passes FLAKY, and a flaky run exits 0, so the Performance budget job
// reported GREEN on main's own head (6 September 2026) over a printed breach
// table: /pubs measured 1275 KB against a 1200 ceiling and 73 requests against
// 68, retried, drew a lower sample and passed. Every pull request carrying the
// same numbers went red, which is what made it read as a push-versus-pull-
// request difference when it was a coin flip.
//
// No browser run reproduces that here, so the fence is the source: the sweep
// declares its own zero-retry policy, and the shared retry setting it opts out
// of is still in the config it opts out of.

const ROOT = process.cwd();

describe("the performance budget sweep is measured once", () => {
  it("configures zero retries for itself", () => {
    const spec = readFileSync(
      path.join(ROOT, "e2e", "performance-budget.spec.ts"),
      "utf8",
    );
    expect(spec).toContain("test.describe.configure({ retries: 0 })");
  });

  it("still runs under a config that retries the ordinary browser suite", () => {
    const config = readFileSync(path.join(ROOT, "playwright.config.ts"), "utf8");
    expect(config).toContain("retries: process.env.CI ? 1 : 0");
  });

  it.each(["theme-test-nonce", undefined])("emits canonical pre-paint work at the existing head position with nonce %s", async (nonce) => {
    request.nonce = nonce;
    const sharedInit = readFileSync(path.join(ROOT, "public", "theme-init.js"), "utf8");
    const doc = await RootLayout({ children: createElement("main") });
    const head = Children.toArray(doc.props.children).find(
      (child) => typeof child === "object" && child !== null && "type" in child && child.type === "head",
    ) as ReactElement<{ children: ReactNode }>;
    const elements = Children.toArray(head.props.children) as ReactElement<{
      src?: string;
      rel?: string;
      type?: string;
      nonce?: string;
      async?: boolean;
      defer?: boolean;
      dangerouslySetInnerHTML?: { __html: string };
    }>[];
    const scripts = elements.filter((element) => element.type === "script");
    const boot = defined(scripts[0]);

    expect(boot.props.dangerouslySetInnerHTML?.__html).toBe(sharedInit);
    expect(boot.props.nonce).toBe(nonce);
    expect(boot.props.src).toBeUndefined();
    expect(boot.props.async).toBeUndefined();
    expect(boot.props.defer).toBeUndefined();
    expect(defined(elements[elements.indexOf(boot) - 1]).props.rel).toBe("dns-prefetch");
    expect(defined(scripts[1]).props.type).toBe("speculationrules");
    const fragment = parseFragment(renderToStaticMarkup(boot));
    const script = defined(fragment.childNodes[0]);
    expect(script.nodeName).toBe("script");
    if (!("childNodes" in script)) throw new Error("The boot script was not emitted.");
    const body = defined(script.childNodes[0]);
    expect("value" in body ? body.value : undefined).toBe(sharedInit);
    expect(scripts.some((script) => /theme-init|splash-init|native-entry-init/.test(script.props.src ?? ""))).toBe(false);
    expect(existsSync(path.join(ROOT, "public", "splash-init.js"))).toBe(false);
  });
});
