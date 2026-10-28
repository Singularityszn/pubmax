import { readFileSync } from "node:fs";
import { join } from "node:path";

import { JSDOM } from "jsdom";
import postcss from "postcss";
import { describe, expect, it, vi, afterEach } from "vitest";

import {
  clerkDevelopmentKeyBlockedInProduction,
  isClerkConfigured,
  isClerkDevelopmentPublishableKey,
} from "@/lib/clerkIdentity";

const PUBLISHABLE_KEY = "pk_test_cmFyZS10cm91dC0yOS5jbGVyay5hY2NvdW50cy5kZXYk";

describe("QA high findings — mobile sheet and consent layering", () => {
  const globalCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");

  const consentHidingSelectors: string[] = [];
  postcss.parse(globalCss).walkRules((rule) => {
    const hidesConsent = rule.nodes.some(
      (node) => node.type === "decl" && node.prop === "visibility" && node.value === "hidden",
    );
    const disablesPointers = rule.nodes.some(
      (node) => node.type === "decl" && node.prop === "pointer-events" && node.value === "none",
    );
    if (hidesConsent && disablesPointers) {
      consentHidingSelectors.push(
        ...rule.selectors.filter((selector) => selector.includes(".analyticsConsentPrompt")),
      );
    }
  });

  // These fixtures check selector matching, not browser paint or the CSS cascade.
  it.each([
    ["an active mobile portal", '<div class="mobileSheetPortal"></div>', true],
    [
      "only a retained exiting mobile portal",
      '<div class="mobileSheetPortal" data-sheet-exiting="true"></div>',
      false,
    ],
    ["a desktop choose-area scrim", '<div class="chooseAreaDesktopScrim"></div>', true],
  ])("applies consent hiding selectors with %s", (_state, surface, hidden) => {
    const dom = new JSDOM(`<body>${surface}<aside class="analyticsConsentPrompt"></aside></body>`);
    try {
      const consent = dom.window.document.querySelector(".analyticsConsentPrompt")!;
      expect(consentHidingSelectors.some((selector) => consent.matches(selector))).toBe(hidden);
    } finally {
      dom.window.close();
    }
  });
});

describe("QA high findings — Clerk development keys on production", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("recognises development publishable keys", () => {
    expect(isClerkDevelopmentPublishableKey(PUBLISHABLE_KEY)).toBe(true);
    expect(
      isClerkDevelopmentPublishableKey(
        `pk_live_${Buffer.from("clerk.pubmaxxing.com$").toString("base64")}`,
      ),
    ).toBe(false);
  });

  it("blocks development keys on production deploys only", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("VERCEL_ENV", "production");
    expect(clerkDevelopmentKeyBlockedInProduction(PUBLISHABLE_KEY)).toBe(true);
    expect(isClerkConfigured(PUBLISHABLE_KEY)).toBe(false);

    vi.stubEnv("VERCEL_ENV", "preview");
    expect(clerkDevelopmentKeyBlockedInProduction(PUBLISHABLE_KEY)).toBe(false);
    expect(isClerkConfigured(PUBLISHABLE_KEY)).toBe(true);
  });
});
