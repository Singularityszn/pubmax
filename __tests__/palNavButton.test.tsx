// @vitest-environment jsdom
import { act, createElement, Fragment, useLayoutEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/tonight" }));
const auth = vi.hoisted(() => ({ userId: "owner" as string | null }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => nav.pathname,
}));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => null }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => ({ signedIn: false }) }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => ({ user: auth.userId ? { id: auth.userId } : null }) }));

import MobileTabBar from "@/components/nav/MobileTabBar";
import {
  PalMapEdgeButton,
  PalSiteNavButton,
  PalTopBarButton,
  palForNav,
  palNavActive,
  palNavLabel,
} from "@/components/nav/PalNavButton";
import { announceLocalPalChange } from "@/lib/localPal";
import { announcePalMoment } from "@/lib/palMoments";
import { DEFAULT_PAL_DRAFT, type PubPal } from "@/lib/pubPal";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function pal(overrides: Partial<PubPal> = {}): PubPal {
  const now = "2026-10-04T12:00:00.000Z";
  return {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", ownerId: "owner", name: "Ripley", adultAttestedAt: now,
    appearance: DEFAULT_PAL_DRAFT.appearance, personality: DEFAULT_PAL_DRAFT.personality, voice: DEFAULT_PAL_DRAFT.voice,
    muted: false, hidden: false, proposalPreferences: {}, masteryPoints: 0, createdAt: now, updatedAt: now,
    ...overrides,
  } as PubPal;
}

function store(value: PubPal) {
  window.localStorage.setItem("pubmax_pub_pal_v1", JSON.stringify(value));
}

let root: Root | null = null;
let host: HTMLElement;

async function render(element: React.ReactElement) {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  await act(async () => {
    root!.render(element);
  });
  // The stored Pal is read after mount.
  await act(async () => {
    await Promise.resolve();
  });
}

beforeEach(() => {
  window.localStorage.clear();
  nav.pathname = "/tonight";
  auth.userId = "owner";
});
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  host?.remove();
  vi.useRealTimers();
});

describe("the Pal's own door", () => {
  it("shows only the person's own Pal, never a hidden one or one with no photograph", () => {
    expect(palForNav(null, "owner")).toBeNull();
    expect(palForNav(pal({ hidden: true }), "owner")).toBeNull();
    expect(palForNav(pal(), "owner")?.name).toBe("Ripley");
  });

  it("never wears a Pal another account left on this device", () => {
    expect(palForNav(pal(), "someone-else")).toBeNull();
    expect(palForNav(pal(), null)).toBeNull();
  });

  it("names the door for the Pal it shows", () => {
    expect(palNavLabel(null)).toBe("Pub Pal");
    expect(palNavLabel(pal())).toBe("Pub Pal, Ripley");
  });

  it("is lit on /pal and nowhere else", () => {
    expect(palNavActive("/pal")).toBe(true);
    expect(palNavActive("/pal/memories")).toBe(true);
    expect(palNavActive("/palace")).toBe(false);
    expect(palNavActive("/map")).toBe(false);
  });

  it("is the shared icon button in the phone top bar, drawing a bird and loading no image for a stranger", async () => {
    await render(createElement(PalTopBarButton, { pathname: "/tonight" }));
    const link = host.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/pal");
    expect(link.getAttribute("aria-label")).toBe("Pub Pal");
    // The icon button primitive (components/ui/icon-button.tsx) at its 44px
    // control size, in the quiet ghost look the theme control beside it wears.
    expect(link.classList.contains("uiButton")).toBe(true);
    expect(link.classList.contains("uiButton--icon")).toBe(true);
    expect(link.classList.contains("uiButton--ghost")).toBe(true);
    expect(link.classList.contains("palTopBarDoor")).toBe(true);
    expect(link.querySelector("img")).toBeNull();
    expect(link.querySelector(".palNavFace--bird svg")).not.toBeNull();
  });

  it("keeps the bird for a Pal the person hid from shortcuts", async () => {
    store(pal({ hidden: true }));
    await render(createElement(PalTopBarButton, { pathname: "/tonight" }));
    expect(host.querySelector("a")!.getAttribute("aria-label")).toBe("Pub Pal");
    expect(host.querySelector("img")).toBeNull();
  });

  it("wears the person's own Pal, asleep when muted", async () => {
    store(pal({ muted: true }));
    await render(createElement(PalTopBarButton, { pathname: "/tonight" }));
    const link = host.querySelector("a")!;
    expect(link.getAttribute("aria-label")).toBe("Pub Pal, Ripley");
    expect(link.querySelector(".palNavFace img")).not.toBeNull();
    expect(link.querySelector(".palNavFace")!.getAttribute("data-pal-state")).toBe("sleeping");
  });

  it("keeps the bird after the owner signs out, or for another account", async () => {
    store(pal());
    auth.userId = null;
    await render(createElement(PalTopBarButton, { pathname: "/tonight" }));
    expect(host.querySelector("a")!.getAttribute("aria-label")).toBe("Pub Pal");
    expect(host.querySelector("img")).toBeNull();
    act(() => root?.unmount());
    host.remove();

    auth.userId = "someone-else";
    await render(createElement(PalTopBarButton, { pathname: "/tonight" }));
    expect(host.querySelector("a")!.getAttribute("aria-label")).toBe("Pub Pal");
    expect(host.querySelector("img")).toBeNull();
  });

  it("follows a Pal hidden or deleted in the same tab, with no page change", async () => {
    store(pal());
    await render(createElement(PalTopBarButton, { pathname: "/pal" }));
    expect(host.querySelector("a")!.getAttribute("aria-label")).toBe("Pub Pal, Ripley");

    store(pal({ hidden: true }));
    await act(async () => { announceLocalPalChange(); });
    expect(host.querySelector("a")!.getAttribute("aria-label")).toBe("Pub Pal");
    expect(host.querySelector("img")).toBeNull();

    store(pal({ name: "Moss" }));
    await act(async () => { announceLocalPalChange(); });
    expect(host.querySelector("a")!.getAttribute("aria-label")).toBe("Pub Pal, Moss");

    window.localStorage.removeItem("pubmax_pub_pal_v1");
    await act(async () => { announceLocalPalChange(); });
    expect(host.querySelector("a")!.getAttribute("aria-label")).toBe("Pub Pal");
  });

  it("never paints the last account's Pal on the frame an account switch lands", async () => {
    store(pal());
    // Layout effects run after the DOM is written and before the door's own
    // read runs, so this sees exactly what the switch paints first.
    const painted: string[] = [];
    function Probe() {
      useLayoutEffect(() => {
        painted.push(document.querySelector("a.palTopBarDoor")?.getAttribute("aria-label") ?? "");
      });
      return null;
    }
    const tree = () => createElement(Fragment, null, createElement(PalTopBarButton, { pathname: "/tonight" }), createElement(Probe));
    await render(tree());
    await act(async () => root!.render(tree()));
    expect(painted.at(-1)).toBe("Pub Pal, Ripley");

    painted.length = 0;
    auth.userId = "someone-else";
    await act(async () => root!.render(tree()));
    expect(painted.length).toBeGreaterThan(0);
    expect(painted).not.toContain("Pub Pal, Ripley");
  });

  it("marks itself as the page on /pal, in ink", async () => {
    await render(createElement(PalTopBarButton, { pathname: "/pal" }));
    const link = host.querySelector("a")!;
    expect(link.getAttribute("aria-current")).toBe("page");
    expect(link.classList.contains("isActive")).toBe(true);
    expect(link.classList.contains("uiButton--primary")).toBe(false);
  });

  it("hops once for a Pal moment", async () => {
    store(pal());
    await render(createElement(PalTopBarButton, { pathname: "/tonight" }));
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "requestAnimationFrame"] });
    await act(async () => {
      announcePalMoment({ kind: "price-added" });
      vi.advanceTimersToNextFrame();
    });
    const link = host.querySelector("a")!;
    expect(link.classList.contains("isCheering")).toBe(true);
    await act(async () => { vi.advanceTimersByTime(1_300); });
    expect(link.classList.contains("isCheering")).toBe(false);
  });

  it("stands on the phone map's edge as the same door, on the edge's quiet surface", async () => {
    await render(createElement(PalMapEdgeButton, { pathname: "/map" }));
    const link = host.querySelector("a")!;
    expect(link.getAttribute("href")).toBe("/pal");
    expect(link.getAttribute("aria-label")).toBe("Pub Pal");
    expect(link.classList.contains("mobileMapPalDoor")).toBe(true);
    expect(link.classList.contains("uiButton--icon")).toBe(true);
    expect(link.classList.contains("uiButton--secondary")).toBe(true);
  });

  it("names the Pal in the desktop bar", async () => {
    store(pal());
    await render(createElement(PalSiteNavButton, { pathname: "/map" }));
    const link = host.querySelector("a")!;
    expect(link.textContent).toBe("Ripley");
    expect(link.getAttribute("aria-label")).toBe("Pub Pal, Ripley");
  });
});

describe("the phone dock", () => {
  it("is the five tabs and nothing else (captain, 1 Nov 2026)", async () => {
    await render(createElement(MobileTabBar));
    const links = [...host.querySelectorAll<HTMLAnchorElement>("nav[aria-label='Primary'] a")];
    expect(links.map((link) => link.textContent)).toEqual(["Explore", "Tonight", "Plan", "Social", "You"]);
    expect(host.querySelectorAll(".mobileTab")).toHaveLength(5);
    expect(host.querySelector("a[href='/pal']")).toBeNull();
    const list = host.querySelector<HTMLElement>(".mobileTabList")!;
    expect(list.style.getPropertyValue("--tab-count")).toBe("5");
  });

  it("slides the well to each tab's own column, and fades it on /pal", async () => {
    await render(createElement(MobileTabBar));
    const well = () => host.querySelector<HTMLElement>(".mobileTabHighlight")!;
    expect(well().style.getPropertyValue("--active-index")).toBe("1");
    expect(well().style.opacity).toBe("1");
    act(() => root?.unmount());
    host.remove();

    nav.pathname = "/plan";
    await render(createElement(MobileTabBar));
    expect(well().style.getPropertyValue("--active-index")).toBe("2");
    act(() => root?.unmount());
    host.remove();

    nav.pathname = "/pal";
    await render(createElement(MobileTabBar));
    expect(well().style.getPropertyValue("--active-index")).toBe("0");
    expect(well().style.opacity).toBe("0");
    expect(host.querySelector("[aria-current='page']")).toBeNull();
  });
});
