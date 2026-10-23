// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
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
vi.mock("next/link", () => ({
  default: ({ prefetch, ...props }: {
    href: string;
    prefetch?: boolean;
    children?: ReactNode;
  }) => {
    void prefetch;
    return createElement("a", props);
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
