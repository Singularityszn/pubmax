// @vitest-environment jsdom

import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const route = vi.hoisted(() => ({ pathname: "/" }));

vi.mock("next/navigation", () => ({ usePathname: () => route.pathname, useRouter: () => ({ push: vi.fn() }) }));
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
import WildNightPreviewPicker from "@/components/wild/WildNightPreviewPicker";
import { readWildNightPreview, writeWildNightPreview } from "@/lib/wildNightPreview";

// The More menu marks the secondary destination a reader is on, with
// aria-current="page", and never a lookalike prefix. Social is a primary tab
// (captain, 16 Oct 2026), so a Social page lights the tab and nothing in here.

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ready", photos: [{}], nextCursor: null }))));
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  writeWildNightPreview(null);
  delete document.documentElement.dataset.theme;
  delete document.documentElement.dataset.themeChosen;
  localStorage.removeItem("pubmax-theme");
  window.history.replaceState(null, "", "/");
  container.remove();
  vi.unstubAllGlobals();
});

async function openMoreOn(pathname: string): Promise<HTMLAnchorElement[]> {
  // A fresh mount per route, so every case starts with the menu closed: the
  // trigger toggles, and a menu left open by an earlier case would close.
  await act(async () => root.unmount());
  root = createRoot(container);
  route.pathname = pathname;
  window.history.replaceState(null, "", pathname);
  await act(async () => {
    root.render(<SiteNavMore includeUtilities items={siteNavMoreItems()} />);
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
  it("keeps the wall link when an older page has a visible photo", async () => {
    const read = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "ready", photos: [], nextCursor: "older-photo" }))
      .mockResolvedValueOnce(Response.json({ status: "ready", photos: [{}], nextCursor: null }));
    vi.stubGlobal("fetch", read);

    expect((await openMoreOn("/")).map((item) => item.getAttribute("href"))).toContain("/wall");
    const nextPage = new URL(String(read.mock.calls[1]?.[0]), "http://localhost");
    expect(nextPage.searchParams.get("cursor")).toBe("older-photo");
  });

  it("hides the wall link only after the last empty page", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "ready", photos: [], nextCursor: "older-photo" }))
      .mockResolvedValueOnce(Response.json({ status: "ready", photos: [], nextCursor: null })));

    expect((await openMoreOn("/")).map((item) => item.getAttribute("href"))).not.toContain("/wall");
  });

  it("keeps the wall link when a later page cannot be checked", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "ready", photos: [], nextCursor: "older-photo" }))
      .mockRejectedValueOnce(new Error("offline")));

    expect((await openMoreOn("/")).map((item) => item.getAttribute("href"))).toContain("/wall");
  });

  it("does not reuse an earlier photo result when the menu opens again", async () => {
    let finish!: (response: Response) => void;
    const fetchWall = vi.fn()
      .mockResolvedValueOnce(Response.json({ status: "ready", photos: [{}], nextCursor: null }))
      .mockImplementationOnce(() => new Promise<Response>((resolve) => { finish = resolve; }));
    vi.stubGlobal("fetch", fetchWall);
    await act(async () => root.render(<SiteNavMore />));
    const trigger = container.querySelector<HTMLButtonElement>(".siteNavMoreBtn")!;
    await act(async () => trigger.click());
    expect(document.querySelector('[role="menu"] a[href="/wall"]')).not.toBeNull();
    await act(async () => trigger.click());
    await act(async () => trigger.click());
    expect(document.querySelector('[role="menu"] a[href="/wall"]')).toBeNull();
    await act(async () => finish(Response.json({ status: "ready", photos: [], nextCursor: null })));
    expect(document.querySelector('[role="menu"] a[href="/wall"]')).toBeNull();
  });
  it("only offers photos when the public wall has photos", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ready", photos: [], nextCursor: null }))));
    expect((await openMoreOn("/")).map((item) => item.getAttribute("href"))).not.toContain("/wall");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ready", photos: [{}], nextCursor: null }))));
    expect((await openMoreOn("/")).map((item) => item.getAttribute("href"))).toContain("/wall");
  });
  it("includes the Guides destination when More opens", async () => {
    const items = await openMoreOn("/tonight");
    expect(items.map((item) => item.getAttribute("href"))).toContain("/guides");
  });

  it.each(["/wall", "/near", "/guides", "/historic", "/pal"])("marks the item current on %s", async (pathname) => {
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


describe("More menu utilities", () => {
  it("offers compose, search and a working theme switch", async () => {
    document.documentElement.dataset.theme = "light";
    await openMoreOn("/social");
    const menu = document.querySelector('[role="menu"]')!;
    expect(menu.querySelector('a[href="/moment?returnTo=%2Fsocial"]')).not.toBeNull();
    expect(menu.textContent).toContain("Search");
    const theme = [...menu.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]
      .find((item) => item.textContent?.includes("Switch to dark theme"));
    expect(theme).toBeTruthy();
    await act(async () => theme!.click());
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});

describe("header utility ownership and Moment return URLs", () => {
  it("keeps custom Profile options limited to their supplied actions", async () => {
    const onSelect = vi.fn();
    await act(async () => root.render(<SiteNavMore label="Options" ariaLabel="Profile options" items={[
      { id: "edit", label: "Edit profile", description: "Change your details", onSelect },
    ]} />));
    await act(async () => container.querySelector<HTMLButtonElement>("button")!.click());
    const items = document.querySelectorAll<HTMLElement>('[role="menuitem"]');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain("Edit profile");
    await act(async () => items[0].click());
    expect(onSelect).toHaveBeenCalledOnce();
  });

  it.each(["pointerdown", "contextmenu", "click"])("keeps the selected pub when a keyboard-opened Moment link receives %s", async (eventType) => {
    route.pathname = "/map";
    window.history.replaceState(null, "", "/map?sel=venue-123");
    try {
      await act(async () => root.render(<SiteNavMore includeUtilities />));
      const trigger = container.querySelector<HTMLButtonElement>("button")!;
      await act(async () => { trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })); });
      const link = [...document.querySelectorAll<HTMLAnchorElement>('[role="menuitem"]')]
        .find((item) => item.textContent?.includes("Share a Moment"))!;
      expect(link.getAttribute("href")).toBe("/moment?returnTo=%2Fmap%3Fsel%3Dvenue-123");
      window.history.replaceState(null, "", "/map?sel=venue-456");
      link.addEventListener(eventType, (event) => event.preventDefault(), { once: true });
      await act(async () => { link.dispatchEvent(new MouseEvent(eventType, { bubbles: true, cancelable: true, ctrlKey: true })); });
      expect(new URL(link.href).searchParams.get("returnTo")).toBe("/map?sel=venue-456");
    } finally {
      window.history.replaceState(null, "", "/");
    }
  });
});

describe("More menu action focus", () => {
  it.each([
    ["Previews off", null],
    ["Round Rota", "round-rota"],
    ["Borough Bingo", "borough-bingo"],
  ] as const)("returns focus to More after selecting %s", async (label, value) => {
    writeWildNightPreview("round-rota");
    await act(async () => root.render(<WildNightPreviewPicker />));
    const trigger = container.querySelector<HTMLButtonElement>(".siteNavMoreBtn")!;
    await act(async () => trigger.click());
    const item = [...document.querySelectorAll<HTMLButtonElement>('button[role="menuitem"]')]
      .find((button) => button.querySelector(".siteNavMoreLabel")?.textContent === label)!;
    expect(item).toBeTruthy();
    item.focus();
    expect(document.activeElement).toBe(item);
    await act(async () => item.click());
    expect(readWildNightPreview()).toBe(value);
    expect(document.querySelector('[role="menu"]')).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it("lets a menu action move focus to its own destination", async () => {
    const destination = document.createElement("button");
    document.body.append(destination);
    try {
      await act(async () => root.render(<SiteNavMore items={[{ id: "action", label: "Open action", description: "Open a destination", onSelect: () => destination.focus() }]} />));
      const trigger = container.querySelector<HTMLButtonElement>(".siteNavMoreBtn")!;
      await act(async () => trigger.click());
      const item = document.querySelector<HTMLButtonElement>('button[role="menuitem"]')!;
      item.focus();
      await act(async () => item.click());
      expect(document.querySelector('[role="menu"]')).toBeNull();
      expect(document.activeElement).toBe(destination);
    } finally {
      destination.remove();
    }
  });
});
