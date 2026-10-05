// @vitest-environment jsdom

import { act, createElement, Fragment, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const preferredCityState = vi.hoisted(() => ({
  current: null as string | null,
  listeners: new Set<() => void>(),
}));

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: () => Promise.resolve(), push: () => undefined }),
  usePathname: () => "/",
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => "PUBMAXXING" }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/pal/PubPalMascot", () => ({ PubPalMascot: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () =>
    preferredCityState.current ? `/map/${preferredCityState.current}` : "/map",
  readPreferredCity: () => preferredCityState.current,
  subscribePreferredCity: (listener: () => void) => {
    preferredCityState.listeners.add(listener);
    return () => preferredCityState.listeners.delete(listener);
  },
}));
vi.mock("@/lib/mapWarmup", () => ({
  warmMapRoute: () => undefined,
  warmNavRoute: () => undefined,
}));
vi.mock("@/lib/mobileShell", () => ({ requestMobileSheetDismiss: () => undefined }));
vi.mock("@/lib/softKeyboard", () => ({
  readSoftKeyboardOpen: () => false,
  serverSoftKeyboardOpen: () => false,
  subscribeSoftKeyboard: () => () => {},
}));
vi.mock("@/lib/useFocusTrap", () => ({
  readStrictModalFocusTrap: () => false,
  serverStrictModalFocusTrap: () => false,
  subscribeStrictModalFocusTrap: () => () => {},
}));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({ useSocialFriendsLaunch: () => true }));

import LandingPage from "@/components/landing/LandingPage";
import MobileTabBar from "@/components/nav/MobileTabBar";
import { defined } from "@/__tests__/helpers/defined";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  preferredCityState.current = null;
  preferredCityState.listeners.clear();
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      media: "",
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function renderNavigation(): Promise<void> {
  await act(async () => {
    root.render(
      createElement(
        Fragment,
        null,
        createElement(LandingPage),
        createElement(MobileTabBar),
      ),
    );
  });
}

function serverNavigation(): HTMLDivElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(
    createElement(
      Fragment,
      null,
      createElement(LandingPage),
      createElement(MobileTabBar),
    ),
  );
  return host;
}

function href(selector: string): string | null {
  return container.querySelector<HTMLAnchorElement>(selector)?.getAttribute("href") ?? null;
}

function linksContaining(text: string): HTMLAnchorElement[] {
  return Array.from(container.querySelectorAll<HTMLAnchorElement>("a")).filter((link) =>
    link.textContent?.includes(text),
  );
}

describe("landing and mobile Map navigation", () => {
  it("uses the same preferred-city destination in both navs", async () => {
    const server = serverNavigation();
    expect(server.querySelector<HTMLAnchorElement>(".lpPrimaryNav a[href^='/map']")?.getAttribute("href")).toBe(
      "/map",
    );
    expect(
      server.querySelector<HTMLAnchorElement>(".mobileTabBar a[href^='/map']")?.getAttribute("href"),
    ).toBe("/map");

    preferredCityState.current = "glasgow";
    await renderNavigation();

    expect(href(".lpPrimaryNav a[href^='/map']")).toBe("/map/glasgow");
    expect(href(".mobileTabBar a[href^='/map']")).toBe("/map/glasgow");
    expect(href(".lpFooterNav a")).toBe("/map/glasgow");
  });

  it("starts at root Map and updates both navs after the city resolves", async () => {
    await renderNavigation();

    expect(href(".lpPrimaryNav a[href^='/map']")).toBe("/map");
    expect(href(".mobileTabBar a[href^='/map']")).toBe("/map");

    preferredCityState.current = "glasgow";
    await act(async () => {
      for (const listener of [...preferredCityState.listeners]) listener();
    });

    expect(href(".lpPrimaryNav a[href^='/map']")).toBe("/map/glasgow");
    expect(href(".mobileTabBar a[href^='/map']")).toBe("/map/glasgow");
  });

  it("keeps city selection on arrival calls to action", async () => {
    await renderNavigation();

    const openTheMap = linksContaining("Open the map");
    expect(openTheMap.length).toBeGreaterThan(0);
    for (const link of openTheMap) expect(link.getAttribute("href")).toBe("/map");
  });

  it("keeps the city chooser reachable from the footer", async () => {
    await renderNavigation();

    const chooser = linksContaining("Pick your city");
    expect(chooser).toHaveLength(1);
    expect(defined(chooser[0]).getAttribute("href")).toBe("/places");
  });
});
