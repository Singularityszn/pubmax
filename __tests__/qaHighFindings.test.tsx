/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";

import postcss from "postcss";
import { act, createElement, Fragment, useRef, type ComponentProps, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { describe, expect, it, vi, afterEach, beforeEach } from "vitest";

const navigation = vi.hoisted(() => ({ events: [] as string[] }));

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/map",
  useSearchParams: () => new URLSearchParams(window.location.search),
  useRouter: () => ({ prefetch: vi.fn(), push: vi.fn() }),
}));
vi.mock("next/link", () => ({
  default: ({ href, children, onClick, prefetch: _prefetch, ...props }: ComponentProps<"a"> & { prefetch?: boolean }) => {
    void _prefetch;
    return createElement("a", {
      ...props,
      href,
      onClick: (event: React.MouseEvent<HTMLAnchorElement>) => {
        onClick?.(event);
        event.preventDefault();
        navigation.events.push(`navigate:${href}`);
      },
    }, children);
  },
}));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => null }));

import PubMap from "@/components/PubMap";
import MobileTabBar from "@/components/nav/MobileTabBar";
import MobileSharedSheet from "@/components/mobile/MobileSharedSheet";
import { useFocusTrap } from "@/lib/useFocusTrap";

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
  function declarations(css: string, selector: string, media: string[] = []): Record<string, string> {
    const values: Record<string, string> = {};
    const important = new Set<string>();
    postcss.parse(css).walkRules((rule) => {
      if (!postcss.list.comma(rule.selector).includes(selector)) return;
      const conditions: string[] = [];
      for (let parent: postcss.Node["parent"] = rule.parent; parent; parent = parent.parent) {
        if (parent instanceof postcss.AtRule && parent.name === "media") conditions.unshift(parent.params);
      }
      if (conditions.length !== media.length || conditions.some((condition, index) => condition !== media[index])) return;
      rule.each((node) => {
        if (node.type !== "decl" || (important.has(node.prop) && !node.important)) return;
        values[node.prop] = postcss.list.space(node.value).join(" ");
        if (node.important) important.add(node.prop);
      });
    });
    return values;
  }

  function expectLayering(css: string, nav: string, sheet: string) {
    const tokens = declarations(css, ":root");
    expect(tokens["--z-tabbar"]).toBe("1350");
    expect(tokens["--z-overlay-top"]).toBe("1300");
    expect(declarations(nav, ".mobileTabBar", ["(max-width: 640px)"])["z-index"]).toBe("var(--z-tabbar)");
    expect(declarations(sheet, ".mobileSheetPortal", ["(max-width: 640px)"]).bottom).toBe(
      "calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px))",
    );
    expect(declarations(sheet, ".mobileSharedSheet.mapDrawer", ["(max-width: 640px)"]).position).toBe("absolute");
  }

  it("keeps the primary tab bar above map sheets", () => {
    expectLayering(globalCss, mobileNavCss, mobileMapShellCss);
  });

  it("rejects commented layering declarations with incorrect live values", () => {
    const mobile = (css: string) => `@media (max-width: 640px) { ${css} }`;
    const css = "/* :root { --z-tabbar: 1350; --z-overlay-top: 1300; } */ :root { --z-tabbar: 1; --z-overlay-top: 2; }";
    expect(() => expectLayering(css, mobileNavCss, mobileMapShellCss)).toThrow();
    expect(() => expectLayering(globalCss,
      mobile("/* .mobileTabBar { z-index: var(--z-tabbar); } */ .mobileTabBar { z-index: 0; }"),
      mobileMapShellCss)).toThrow();
    expect(() => expectLayering(globalCss, mobileNavCss,
      mobile("/* .mobileSheetPortal { bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px)); } */ .mobileSheetPortal { bottom: 0; } .mobileSharedSheet.mapDrawer { position: absolute; }"),
    )).toThrow();
    expect(() => expectLayering(globalCss, mobileNavCss,
      mobile(".mobileSheetPortal { bottom: calc(var(--tabbar-h) + env(safe-area-inset-bottom, 0px)); } /* .mobileSharedSheet.mapDrawer { position: absolute; } */ .mobileSharedSheet.mapDrawer { position: fixed; }"),
    )).toThrow();
    expect(() => expectLayering(globalCss,
      "@media (min-width: 641px) { .mobileTabBar { z-index: var(--z-tabbar); } }",
      mobileMapShellCss,
    )).toThrow();
  });

  function expectConsentHidden(css: string) {
    for (const selector of [
      "body:has(.mobileSheetPortal) .analyticsConsentPrompt",
      "body:has(.chooseAreaDesktopScrim) .analyticsConsentPrompt",
    ]) {
      expect(declarations(css, selector)).toMatchObject({ visibility: "hidden", "pointer-events": "none" });
    }
  }

  it("hides the analytics consent card while any map sheet is open", () => {
    expectConsentHidden(globalCss);
  });

  it.each(["visibility: visible; pointer-events: none", "visibility: hidden; pointer-events: auto"])(
    "rejects a comment-only consent policy with %s", (live) => {
      const selectors = "body:has(.mobileSheetPortal) .analyticsConsentPrompt, body:has(.chooseAreaDesktopScrim) .analyticsConsentPrompt";
      expect(() => expectConsentHidden(`/* ${selectors} { visibility: hidden; pointer-events: none; } */ ${selectors} { ${live}; }`)).toThrow();
    },
  );

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

describe("mounted primary navigation and map-sheet dismissal", () => {
  let root: Root;
  let host: HTMLDivElement;
  let previousActEnvironment: boolean | undefined;
  const inertDescriptor = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "inert");
  const actEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };

  beforeEach(() => {
    previousActEnvironment = actEnvironment.IS_REACT_ACT_ENVIRONMENT;
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    navigation.events.length = 0;
    Object.defineProperty(HTMLElement.prototype, "inert", {
      configurable: true,
      get() { return this.hasAttribute("inert"); },
      set(value: boolean) { this.toggleAttribute("inert", value); },
    });
    localStorage.clear();
    sessionStorage.clear();
    vi.stubGlobal("innerWidth", 390);
    vi.stubGlobal("innerHeight", 844);
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query.includes("max-width") && !query.includes("prefers"),
      media: query,
      addEventListener() {}, removeEventListener() {},
      addListener() {}, removeListener() {},
    }));
    vi.stubGlobal("fetch", vi.fn(() => new Promise(() => {})));
    host = document.body.appendChild(document.createElement("div"));
    root = createRoot(host);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    host.remove();
    if (inertDescriptor) Object.defineProperty(HTMLElement.prototype, "inert", inertDescriptor);
    else Reflect.deleteProperty(HTMLElement.prototype, "inert");
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
    window.history.replaceState(null, "", "/");
    actEnvironment.IS_REACT_ACT_ENVIRONMENT = previousActEnvironment;
  });

  async function renderMap(search = "?sel=venue-test") {
    window.history.replaceState(null, "", `/map${search}`);
    await act(async () => root.render(createElement(Fragment, null,
      createElement(PubMap), createElement(MobileTabBar),
    )));
    expect(document.querySelector(".mobileSheetPortal")).not.toBeNull();
  }

  function primaryTab(href: string): HTMLAnchorElement {
    const tab = document.querySelector<HTMLAnchorElement>(`.mobileTabBar a[href="${href}"]`);
    expect(tab).not.toBeNull();
    return tab!;
  }

  function expectSheetsClosed() {
    expect(document.querySelector(".mobileSheetPortal")).toBeNull();
  }

  it.each(["/tonight", "/map", "/places", "/out", "/plan", "/u/you"])(
    "dismisses the mounted map sheet when the reader chooses %s", async (href) => {
      await renderMap();
      expect(isInert(primaryTab(href))).toBe(false);
      const onDismiss = () => navigation.events.push("dismiss");
      window.addEventListener(MOBILE_SHEET_DISMISS_EVENT, onDismiss);
      try {
        await act(async () => primaryTab(href).click());
        expect(navigation.events).toEqual(["dismiss", `navigate:${href}`]);
        expectSheetsClosed();
      } finally {
        window.removeEventListener(MOBILE_SHEET_DISMISS_EVENT, onDismiss);
      }
    },
  );

  it("dismisses the planner and clears a price-entry intent through the same navigation", async () => {
    await renderMap("?plan=1&contribute=price");
    await act(async () => primaryTab("/places").click());
    expectSheetsClosed();
    expect(new URLSearchParams(window.location.search).has("contribute")).toBe(false);
  });

  it("detects navigation whose dismissal dispatch does not execute", async () => {
    await renderMap();
    const dispatch = window.dispatchEvent.bind(window);
    vi.spyOn(window, "dispatchEvent").mockImplementation((event) =>
      event.type === MOBILE_SHEET_DISMISS_EVENT ? true : dispatch(event),
    );
    await act(async () => primaryTab("/plan").click());
    expect(navigation.events).toEqual(["navigate:/plan"]);
    expect(() => expectSheetsClosed()).toThrow();
  });

  it("detects a missing map dismissal consumer even when navigation dispatches", async () => {
    const addListener = window.addEventListener.bind(window);
    const listenerSpy = vi.spyOn(window, "addEventListener").mockImplementation((...args) => {
      if (args[0] !== MOBILE_SHEET_DISMISS_EVENT) addListener(...args);
    });
    await renderMap();
    listenerSpy.mockRestore();
    await act(async () => primaryTab("/plan").click());
    expect(navigation.events).toEqual(["navigate:/plan"]);
    expect(() => expectSheetsClosed()).toThrow();
  });

  function StrictModal({ children }: { children?: ReactNode }) {
    const ref = useRef<HTMLDivElement>(null);
    useFocusTrap(true, ref, "strict-modal");
    return createElement("div", { ref, role: "dialog" }, children);
  }

  function isInert(element: HTMLElement): boolean {
    for (let node: HTMLElement | null = element; node; node = node.parentElement) {
      if (node.inert || node.hasAttribute("inert")) return true;
    }
    return false;
  }

  it.each(["nested", "body"])("keeps %s primary tabs reachable beside a map sheet and withdraws them for a strict modal", async (placement) => {
    const tabs = createElement(MobileTabBar);
    const render = async (strict: boolean) => act(async () => root.render(createElement(Fragment, null,
      placement === "body" ? createPortal(tabs, document.body) : tabs,
      createElement("button", { id: "outside-control" }, "Other control"),
      <MobileSharedSheet kind="venue" title="Pub detail" onClose={() => {}}>Content</MobileSharedSheet>,
      strict ? createElement(StrictModal, null, createElement("button", null, "Modal action")) : null,
    )));
    await render(false);
    expect(isInert(primaryTab("/plan"))).toBe(false);
    expect(isInert(document.getElementById("outside-control")!)).toBe(true);
    await render(true);
    expect(isInert(primaryTab("/plan"))).toBe(true);
    await render(false);
    expect(isInert(primaryTab("/plan"))).toBe(false);
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
