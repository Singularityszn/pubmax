// @vitest-environment jsdom
import { act, createContext, createElement, useContext, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ProviderAuthState } from "@/lib/authProviderRevision";

const auth = vi.hoisted(() => ({
  user: null as null | { id: string },
  handle: null as string | null,
  identityResolved: true,
  providerAuthState: "signed-out" as ProviderAuthState,
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({
  usePathname: () => "/tonight",
  useRouter: () => ({ prefetch: vi.fn() }),
}));
// The href Next is opening, or null. A link reads its own status, as it does
// under the real router.
const hop = vi.hoisted(() => ({ pendingHref: null as string | null }));
const LinkHref = createContext<string | null>(null);
vi.mock("next/link", () => ({
  useLinkStatus: () => {
    const href = useContext(LinkHref);
    return { pending: href !== null && href === hop.pendingHref };
  },
  default: ({ prefetch, ...props }: {
    href: string;
    prefetch?: boolean;
    children?: ReactNode;
  }) => {
    void prefetch;
    return createElement(LinkHref.Provider, { value: props.href }, createElement("a", props));
  },
}));

import MobileTabBar from "@/components/nav/MobileTabBar";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  localStorage.clear();
  localStorage.setItem("pubmax_handle", "karan");
  auth.user = null;
  auth.handle = null;
  auth.identityResolved = true;
  auth.providerAuthState = "signed-out";
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  localStorage.clear();
});

async function renderYouDestination(): Promise<string | null | undefined> {
  await act(async () => root.render(createElement(MobileTabBar)));
  return host.querySelector<HTMLAnchorElement>('a[aria-label="You"]')?.getAttribute("href");
}

describe("You navigation with a cached profile handle", () => {
  it("opens the session-owned You route after sign-out instead of the cached public profile", async () => {
    expect(await renderYouDestination()).toBe("/u/you");
    expect(localStorage.getItem("pubmax_handle")).toBe("karan");
  });

  it("does not name the cached profile while the session is pending", async () => {
    auth.identityResolved = false;
    auth.providerAuthState = "unresolved";
    expect(await renderYouDestination()).toBe("/u/you");
  });

  it("uses the neutral You route when the authentication provider is unavailable", async () => {
    auth.providerAuthState = "unavailable";
    expect(await renderYouDestination()).toBe("/u/you");
  });

  it("uses the signed-in account's canonical handle instead of the cached handle", async () => {
    auth.user = { id: "second-account" };
    auth.handle = "alice";
    auth.providerAuthState = "authenticated";
    expect(await renderYouDestination()).toBe("/u/alice");

    auth.user = null;
    auth.handle = null;
    auth.providerAuthState = "signed-out";
    expect(await renderYouDestination()).toBe("/u/you");
  });
});

describe("a tab hop on a slow network", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    hop.pendingHref = null;
    vi.useRealTimers();
  });

  async function open(href: string | null) {
    hop.pendingHref = href;
    await act(async () => root.render(createElement(MobileTabBar)));
  }
  const lit = () => host.querySelector(".mobileTab.isActive")?.getAttribute("aria-label");
  const current = () => host.querySelector('a[aria-current="page"]')?.getAttribute("aria-label");
  const heldFrame = () => document.querySelector(".tabHopVeil");
  const outlastTheGrace = () => act(async () => vi.advanceTimersByTime(600));

  it("lights the tab being opened at once and still names the page the reader is on", async () => {
    await open(null);
    expect(lit()).toBe("Tonight");

    await open("/social");
    expect(lit()).toBe("Social");
    expect(current()).toBe("Tonight");

    await open(null);
    expect(lit()).toBe("Tonight");
  });

  it("draws the held frame only when the hop outlasts its grace, and removes it when the hop ends", async () => {
    await open("/plan");
    await act(async () => vi.advanceTimersByTime(599));
    expect(heldFrame()).toBeNull();

    await act(async () => vi.advanceTimersByTime(1));
    expect(heldFrame()).not.toBeNull();

    await open(null);
    expect(heldFrame()).toBeNull();
  });

  it("leaves the map to draw its own wait", async () => {
    await open("/map");
    await outlastTheGrace();
    expect(lit()).toBe("Explore");
    expect(heldFrame()).toBeNull();
  });
});
