// @vitest-environment jsdom
import { createElement, type ComponentType } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { describe, expect, it, vi } from "vitest";

vi.mock("next/dynamic", () => ({ default: () => () => null }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/",
  useRouter: () => ({ prefetch: () => Promise.resolve(), push: () => undefined }),
}));
vi.mock("@/components/command/CommandPaletteProvider", () => ({
  useCommandPalette: () => ({ open: () => {} }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/cityPreference", () => ({
  preferredCityMapHref: () => "/map",
  readPreferredCity: () => null,
  subscribePreferredCity: () => () => {},
}));

import LandingPage from "@/components/landing/LandingPage";
import SiteNav from "@/components/nav/SiteNav";

function render(component: ComponentType): HTMLElement {
  const host = document.createElement("div");
  host.innerHTML = renderToStaticMarkup(createElement(component));
  return host;
}

function links(host: HTMLElement, selector: string): HTMLAnchorElement[] {
  return Array.from(host.querySelectorAll<HTMLAnchorElement>(selector));
}

describe("documented desktop navigation", () => {
  it.each([
    ["landing", LandingPage],
    ["app", SiteNav],
  ] as const)("gives the %s header its documented first-paint destinations", (_name, component) => {
    const nav = links(render(component), ".siteNavLinks a");
    expect(nav.map((link) => [link.textContent, link.getAttribute("href")])).toEqual([
      ["Explore", "/map"],
      ["Tonight", "/tonight"],
      ["Plan", "/plan"],
      ["Spoons", "/spoons-value"],
      ["Social", "/social"],
      ["You", "/u/you"],
    ]);
  });
});
