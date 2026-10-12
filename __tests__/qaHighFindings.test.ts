/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it, vi, afterEach } from "vitest";

import {
  clerkDevelopmentKeyBlockedInProduction,
  isClerkConfigured,
  isClerkDevelopmentPublishableKey,
} from "@/lib/clerkIdentity";
import {
  MOBILE_SHEET_DISMISS_EVENT,
} from "@/lib/mobileShell";
import { requestMobileSheetDismiss } from "@/lib/mobileSheetDismiss";

const PUBLISHABLE_KEY = "pk_test_cmFyZS10cm91dC0yOS5jbGVyay5hY2NvdW50cy5kZXYk";

describe("QA high findings — mobile sheet and consent layering", () => {
  const globalCss = readFileSync(join(process.cwd(), "app/globals.css"), "utf8");
  const mobileMapShellCss = readFileSync(
    join(process.cwd(), "components/mobile/mobileMapShell.css"),
    "utf8",
  );
  const mobileNavCss = readFileSync(
    join(process.cwd(), "components/nav/mobileNav.css"),
    "utf8",
  );
  const mobileTabBar = readFileSync(
    join(process.cwd(), "components/nav/MobileTabBar.tsx"),
    "utf8",
  );
  const pubMap = readFileSync(join(process.cwd(), "components/PubMap.tsx"), "utf8");

  it("keeps the primary tab bar above map sheets", () => {
    expect(globalCss).toMatch(/--z-tabbar:\s*1350/);
    expect(globalCss).toMatch(/--z-overlay-top:\s*1300/);
    expect(mobileNavCss).toMatch(/z-index:\s*var\(--z-tabbar\)/);
    expect(mobileMapShellCss).toMatch(
      /\.mobileSheetPortal\s*{[^}]*bottom:\s*calc\(var\(--tabbar-h\) \+ env\(safe-area-inset-bottom,\s*0px\)\)/,
    );
    expect(mobileMapShellCss).toMatch(
      /\.mobileSharedSheet\.mapDrawer\s*{[^}]*position:\s*absolute/,
    );
  });

  it("hides the analytics consent card while any map sheet is open", () => {
    const rule = globalCss.match(
      /body:has\(\.mobileSheetPortal\) \.analyticsConsentPrompt,\s*body:has\(\.chooseAreaDesktopScrim\) \.analyticsConsentPrompt\s*{([^}]*)}/,
    )?.[1] ?? "";
    expect(rule).toMatch(/visibility:\s*hidden/);
    expect(rule).toMatch(/pointer-events:\s*none/);
  });

  it("dismisses open map sheets before primary-tab navigation", () => {
    expect(mobileTabBar).toContain("requestMobileSheetDismiss");
    expect(pubMap).toContain("MOBILE_SHEET_DISMISS_EVENT");
    expect(pubMap).toContain("closeEverySurface");
    const focusTrap = readFileSync(join(process.cwd(), "lib/useFocusTrap.ts"), "utf8");
    expect(focusTrap).toMatch(/shouldInertOutsideSibling/);
    expect(focusTrap).toMatch(/mobileTabBar/);
  });

  function expectDismissDispatch(request: () => void) {
    const events: Event[] = [];
    const listener = (event: Event) => events.push(event);
    window.addEventListener(MOBILE_SHEET_DISMISS_EVENT, listener);
    try {
      request();
      expect(events).toHaveLength(1);
      expect(events[0]).toBeInstanceOf(CustomEvent);
      expect(events[0]?.type).toBe("pubmax:mobile-sheet-dismiss");
    } finally {
      window.removeEventListener(MOBILE_SHEET_DISMISS_EVENT, listener);
    }
  }

  it("rejects a dismissal function that never dispatches", () => {
    expect(() => expectDismissDispatch(() => {})).toThrow();
  });

  it("dispatches the mobile-shell dismissal event synchronously on each request", () => {
    expectDismissDispatch(requestMobileSheetDismiss);
    expectDismissDispatch(requestMobileSheetDismiss);
  });

  it("does nothing when no browser window exists", () => {
    vi.stubGlobal("window", undefined);
    try {
      expect(() => requestMobileSheetDismiss()).not.toThrow();
    } finally {
      vi.unstubAllGlobals();
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
