// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({ usePathname: () => route.pathname }));
vi.mock("next/link", async () => {
  const { forwardRef, createElement: h } = await import("react");
  return {
    default: forwardRef<HTMLAnchorElement, { href: string; children: ReactNode }>(
      function Link({ href, children, ...props }, ref) {
        return h("a", { href, ref, ...props }, children);
      },
    ),
  };
});

import SiteNavMore, { siteNavMoreItems } from "@/components/nav/SiteNavMore";

// Social left the primary row for the desktop More menu, so More is where a
// reader on a Social page is told where they are. The dock tabs light on their
// routes AND the routes those routes own; the More entry must do the same, or a
// desktop reader on /feed or /crawls/soho loses both the lit item and
// aria-current="page".

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function openMoreOn(pathname: string): Promise<HTMLAnchorElement[]> {
  // A fresh mount per route, so every case starts with the menu closed: the
  // trigger toggles, and a menu left open by an earlier case would close.
  await act(async () => root.unmount());
  root = createRoot(container);
  route.pathname = pathname;
  await act(async () => {
    root.render(createElement(SiteNavMore, { items: siteNavMoreItems("Social") }));
  });
  const trigger = container.querySelector<HTMLButtonElement>(".siteNavMoreBtn");
  if (!trigger) throw new Error("More trigger not rendered");
  await act(async () => {
    trigger.click();
  });
  const menu = document.querySelector('[role="menu"]');
  if (!menu) throw new Error("More menu did not open");
  return Array.from(menu.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]'));
}

function current(items: HTMLAnchorElement[]): string[] {
  return items
    .filter((item) => item.getAttribute("aria-current") === "page")
    .map((item) => item.querySelector(".siteNavMoreLabel")?.textContent ?? "");
}

describe("the More menu marks where a reader is", () => {
  it.each([
    "/social",
    "/social/crews/crew-1",
    "/feed",
    "/feed/friends",
    "/discover",
    "/drinks",
    "/stories",
    "/crawls",
    "/crawls/soho",
  ])("marks Social as the current page on %s", async (pathname) => {
    const items = await openMoreOn(pathname);
    expect(current(items)).toEqual(["Social"]);
    const social = items.find((item) => item.getAttribute("href") === "/social");
    expect(social?.classList.contains("isActive")).toBe(true);
  });

  it("marks only the destination a reader is on, never a lookalike prefix", async () => {
    expect(current(await openMoreOn("/near"))).toEqual(["Near"]);
    expect(current(await openMoreOn("/socialite"))).toEqual([]);
    expect(current(await openMoreOn("/tonight"))).toEqual([]);
  });
});
