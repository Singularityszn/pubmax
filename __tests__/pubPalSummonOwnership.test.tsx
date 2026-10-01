// @vitest-environment jsdom

import { act, createElement, Fragment, type ComponentProps } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const viewer = vi.hoisted(() => ({
  user: { id: "owner-a" } as { id: string } | null,
  loading: false,
  pathname: "/map",
}));
const requests = vi.hoisted(() => ({ authedActionFetch: vi.fn() }));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ user: viewer.user, loading: viewer.loading, configured: true }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    signedIn: Boolean(viewer.user) && !viewer.loading,
    signedOut: !viewer.user && !viewer.loading,
    unresolved: viewer.loading,
  }),
}));
vi.mock("next/navigation", () => ({ usePathname: () => viewer.pathname }));
vi.mock("next/link", async () => {
  const { createElement } = await import("react");
  return { default: ({ children, ...props }: ComponentProps<"a">) => createElement("a", props, children) };
});
vi.mock("@/components/pubpal/PubPalAvatar", () => ({
  PubPalAvatar: ({ name }: { name: string }) => createElement("span", { role: "img", "aria-label": `${name} avatar` }),
}));
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/components/pal/PalPortrait", () => ({ default: () => null }));
vi.mock("@/components/pubpal/PubPalVoice", () => ({ default: () => null }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: requests.authedActionFetch }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

import PalExperience from "@/components/pal/PalExperience";
import PubPalSummon from "@/components/pubpal/PubPalSummon";
import { DEFAULT_PAL_DRAFT, type PubPal } from "@/lib/pubPal";

const PAL_CACHE_KEY = "pubmax_pub_pal_v1";
let container: HTMLDivElement;
let root: Root;

function ownedPal(ownerId = "owner-a", patch: Partial<PubPal> = {}): PubPal {
  return {
    id: `pal-${ownerId}`,
    ownerId,
    name: ownerId === "owner-a" ? "Moss" : "Robin",
    adultAttestedAt: "2026-10-01T00:00:00.000Z",
    appearance: DEFAULT_PAL_DRAFT.appearance,
    personality: DEFAULT_PAL_DRAFT.personality,
    voice: DEFAULT_PAL_DRAFT.voice,
    muted: false,
    hidden: false,
    proposalPreferences: { memories: false, routes: true },
    masteryPoints: 0,
    createdAt: "2026-10-01T00:00:00.000Z",
    updatedAt: "2026-10-01T00:00:00.000Z",
    ...patch,
  };
}

function surface(withControls = false) {
  return createElement(Fragment, null,
    createElement(PubPalSummon),
    withControls ? createElement(PalExperience) : null,
  );
}

async function render(withControls = false): Promise<void> {
  await act(async () => {
    root.render(surface(withControls));
    for (let turn = 0; turn < 8; turn += 1) await Promise.resolve();
  });
}

function summon(): HTMLAnchorElement | null {
  return container.querySelector<HTMLAnchorElement>(".palSummon");
}

async function externalCacheChange(pal: PubPal | null): Promise<void> {
  await act(async () => {
    if (pal) localStorage.setItem(PAL_CACHE_KEY, JSON.stringify(pal));
    else localStorage.removeItem(PAL_CACHE_KEY);
    const event = new StorageEvent("storage", {
      key: PAL_CACHE_KEY,
      newValue: pal ? JSON.stringify(pal) : null,
    });
    Object.defineProperty(event, "storageArea", { value: localStorage });
    window.dispatchEvent(event);
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  localStorage.clear();
  sessionStorage.clear();
  viewer.user = { id: "owner-a" };
  viewer.loading = false;
  viewer.pathname = "/map";
  requests.authedActionFetch.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe("owned Pub Pal summon", () => {
  it("shows the signed-in owner's visible Pal on an allowed surface", async () => {
    localStorage.setItem(PAL_CACHE_KEY, JSON.stringify(ownedPal()));
    await render();
    expect(summon()?.getAttribute("aria-label")).toBe("Summon Moss, your Pub Pal");
    expect(summon()?.getAttribute("href")).toBe("/pal");
  });

  it.each(["loading", "signed-out", "different-owner"])("keeps cached Pal private while %s", async (phase) => {
    localStorage.setItem(PAL_CACHE_KEY, JSON.stringify(ownedPal()));
    if (phase === "loading") viewer.loading = true;
    if (phase === "signed-out") viewer.user = null;
    if (phase === "different-owner") viewer.user = { id: "owner-b" };
    await render();
    expect(summon()).toBeNull();
    expect(container.textContent).not.toContain("Moss");
  });

  it("hides the former owner's Pal on account switch without a pathname change", async () => {
    localStorage.setItem(PAL_CACHE_KEY, JSON.stringify(ownedPal()));
    await render();
    expect(summon()).not.toBeNull();
    viewer.user = { id: "owner-b" };
    await act(async () => {
      flushSync(() => root.render(surface()));
      expect(summon()).toBeNull();
    });
    await externalCacheChange(ownedPal("owner-b"));
    expect(summon()?.getAttribute("aria-label")).toBe("Summon Robin, your Pub Pal");
    await externalCacheChange(ownedPal());
    expect(summon()).toBeNull();
  });

  it("hides the former owner's Pal immediately on logout", async () => {
    localStorage.setItem(PAL_CACHE_KEY, JSON.stringify(ownedPal()));
    await render();
    viewer.user = null;
    await act(async () => {
      flushSync(() => root.render(surface()));
      expect(summon()).toBeNull();
    });
  });

  it("does not apply a queued cache read from an owner who has already left", async () => {
    localStorage.setItem(PAL_CACHE_KEY, JSON.stringify(ownedPal()));
    await act(async () => {
      flushSync(() => root.render(surface()));
      viewer.user = { id: "owner-b" };
      flushSync(() => root.render(surface()));
      await Promise.resolve();
    });
    expect(summon()).toBeNull();
  });

  it("reacts to cross-tab hide and delete without navigation", async () => {
    localStorage.setItem(PAL_CACHE_KEY, JSON.stringify(ownedPal()));
    await render();
    await externalCacheChange(ownedPal("owner-a", { hidden: true }));
    expect(summon()).toBeNull();
    await externalCacheChange(ownedPal());
    expect(summon()).not.toBeNull();
    await externalCacheChange(null);
    expect(summon()).toBeNull();
  });

  it("reacts to a same-tab successful hide control update", async () => {
    localStorage.setItem(PAL_CACHE_KEY, JSON.stringify(ownedPal()));
    requests.authedActionFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/pub-pal/memories") return Response.json({ memories: [] });
      return Response.json({ pal: ownedPal("owner-a", init?.method === "PATCH" ? { hidden: true } : {}) });
    });
    await render(true);
    expect(summon()).not.toBeNull();
    const hide = [...container.querySelectorAll("button")].find((button) => button.querySelector("strong")?.textContent === "Visible");
    expect(hide).toBeDefined();
    await act(async () => hide?.click());
    expect(localStorage.getItem(PAL_CACHE_KEY)).toContain('"hidden":true');
    expect(summon()).toBeNull();
  });

  it("reacts to same-tab Pal deletion after explicit confirmation", async () => {
    localStorage.setItem(PAL_CACHE_KEY, JSON.stringify(ownedPal()));
    vi.spyOn(window, "confirm").mockReturnValue(true);
    requests.authedActionFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url === "/api/pub-pal/memories") return Response.json({ memories: [] });
      return Response.json(init?.method === "DELETE" ? { deleted: true } : { pal: ownedPal() });
    });
    await render(true);
    const remove = [...container.querySelectorAll("button")].find((button) => button.querySelector("strong")?.textContent === "Delete Moss");
    expect(remove).toBeDefined();
    await act(async () => remove?.click());
    expect(localStorage.getItem(PAL_CACHE_KEY)).toBeNull();
    expect(summon()).toBeNull();
  });

  it("refuses hidden, malformed or absent cached state", async () => {
    localStorage.setItem(PAL_CACHE_KEY, JSON.stringify(ownedPal("owner-a", { hidden: true })));
    await render();
    expect(summon()).toBeNull();
    localStorage.setItem(PAL_CACHE_KEY, "broken json");
    viewer.pathname = "/plan";
    await render();
    expect(summon()).toBeNull();
    localStorage.removeItem(PAL_CACHE_KEY);
    viewer.pathname = "/";
    await render();
    expect(summon()).toBeNull();
  });
});
