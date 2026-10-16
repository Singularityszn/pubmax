// @vitest-environment jsdom

import { act, type ReactNode } from "react";
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

// The More menu marks the secondary destination a reader is on, with
// aria-current="page", and never a lookalike prefix. Social is a primary tab
// (captain, 16 Oct 2026), so a Social page lights the tab and nothing in here.

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
    root.render(<SiteNavMore items={siteNavMoreItems()} />);
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
  it.each(["/wall", "/near", "/historic", "/pal"])("marks the item current on %s", async (pathname) => {
    const items = await openMoreOn(pathname);
    expect(items.filter((item) => item.getAttribute("aria-current") === "page")).toHaveLength(1);
    expect(items.find((item) => item.getAttribute("href") === pathname)?.classList.contains("isActive")).toBe(true);
  });

  it.each(["/social", "/feed", "/crawls/soho"])("lists no Social item and marks nothing on %s", async (pathname) => {
    const items = await openMoreOn(pathname);
    expect(items.some((item) => item.getAttribute("href") === "/social")).toBe(false);
    expect(current(items)).toEqual([]);
  });

  it("marks only the destination a reader is on, never a lookalike prefix", async () => {
    expect(current(await openMoreOn("/near"))).toEqual(["Near"]);
    expect(current(await openMoreOn("/nearby"))).toEqual([]);
    expect(current(await openMoreOn("/tonight"))).toEqual([]);
  });
});
