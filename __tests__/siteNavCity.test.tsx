// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { writePreferredCity } from "@/lib/cityPreference";

vi.mock("next/navigation", () => ({
  usePathname: () => "/places",
  useRouter: () => ({ prefetch: () => {} }),
}));
vi.mock("next/link", async () => {
  const { forwardRef, createElement } = await import("react");
  return {
    default: forwardRef<HTMLAnchorElement, { href: string; children: ReactNode; prefetch?: boolean }>(
      function Link({ href, children, prefetch: _prefetch, ...props }, ref) {
        void _prefetch;
        return createElement("a", { href, ref, ...props }, children);
      },
    ),
  };
});
vi.mock("@/components/command/CommandPaletteProvider", () => ({
  useCommandPalette: () => ({ open: () => {} }),
}));
vi.mock("@/components/ThemeToggle", () => ({ default: () => null }));
vi.mock("@/components/nav/MessagesLink", () => ({ default: () => null }));
vi.mock("@/components/nav/NotificationBell", () => ({ default: () => null }));
vi.mock("@/components/nav/SiteNavMore", () => ({
  default: () => null,
  siteNavMoreItems: () => [],
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/brand/PubmaxxWordmark", () => ({ default: () => null }));

import SiteNav from "@/components/nav/SiteNav";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

function mapLink(): HTMLAnchorElement {
  const link = host.querySelector<HTMLAnchorElement>(
    '.siteNavLinks a[aria-label="Map"]',
  );
  if (!link) throw new Error("Desktop Map link missing");
  return link;
}

beforeEach(async () => {
  window.localStorage.clear();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => root.render(<SiteNav active="places" />));
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  window.localStorage.clear();
});

it("keeps London fallback and updates Map after choosing Manchester in the same tab", async () => {
  expect(mapLink().getAttribute("href")).toBe("/map");
  await act(async () => writePreferredCity("manchester"));
  expect(mapLink().getAttribute("href")).toBe("/map/manchester");
});

it("updates Map when another tab changes the preferred city", async () => {
  await act(async () => {
    window.localStorage.setItem("pubmax:preferredCity:v1", "manchester");
    window.dispatchEvent(new StorageEvent("storage", { key: "pubmax:preferredCity:v1" }));
  });
  expect(mapLink().getAttribute("href")).toBe("/map/manchester");
});
