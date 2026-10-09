// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ViewerSession } from "@/components/auth/useViewerSession";
import type { SocialShellState } from "@/lib/socialShell";

const viewer = vi.hoisted(() => ({
  auth: { accountRevision: 0, identityResolved: false, user: null as { id: string } | null },
  session: {} as ViewerSession,
}));
const transport = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode; prefetch?: boolean }) => {
    const domProps = { ...props };
    delete domProps.prefetch;
    return createElement("a", { href, ...domProps }, children);
  },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }),
}));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => viewer.auth }));
vi.mock("@/components/auth/useViewerSession", () => ({ useViewerSession: () => viewer.session }));
vi.mock("@/components/auth/useViewerHandle", () => ({ useViewerHandle: () => null }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: transport.request }));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({ useSocialFriendsLaunch: () => true }));
vi.mock("@/lib/deviceAccountIdentity", () => ({ subscribeDeviceIdentity: () => () => undefined }));
vi.mock("@/components/nav/SiteNav", () => ({ default: () => null }));
vi.mock("@/components/profile/HandleAvatar", () => ({ default: () => null }));
vi.mock("@/components/social/CrewsPanel", () => ({ default: () => null }));
vi.mock("@/components/social/CreatorListsLane", () => ({ default: () => null }));
vi.mock("@/components/social/PeopleDirectory", () => ({ default: () => null }));
vi.mock("@/app/discover/DiscoverPageClient", () => ({ DiscoverBody: () => null }));
vi.mock("@/app/social/SocialComposer", () => ({ default: () => null }));
vi.mock("@/app/social/SocialOutbox", () => ({ default: () => null }));
vi.mock("@/app/social/SocialTagInbox", () => ({ default: () => null }));

import SocialPageClient from "@/app/social/SocialPageClient";

const posts = { valid: true as const, tab: "posts" as const, feed: "following" as const, area: null };
let host: HTMLDivElement;
let root: Root;
let style: HTMLStyleElement;

function setSession(phase: ViewerSession["phase"]): void {
  viewer.session = {
    phase,
    signedIn: phase === "signed-in",
    signedOut: phase === "signed-out",
    unresolved: phase === "unresolved",
  };
  viewer.auth.identityResolved = phase !== "unresolved";
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  viewer.auth.accountRevision = 0;
  viewer.auth.user = null;
  setSession("unresolved");
  transport.request.mockReset();
  transport.request.mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input) !== "/api/starter-packs") throw new Error(`Unexpected request: ${String(input)}`);
    return new Response(JSON.stringify({
      packs: [{
        slug: "camden", title: "Drinkers of Camden", description: "Accounts from Camden.",
        kind: "borough", borough: "Camden", members: [{ handle: "alice" }], memberCount: 1,
      }],
      viewerFollowing: null,
    }), { status: 200, headers: { "content-type": "application/json" } });
  });
  // Apply the production stylesheet to the DOM consumer, without source assertions.
  style = document.createElement("style");
  style.textContent = readFileSync("app/social/social.css", "utf8");
  document.head.appendChild(style);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  style.remove();
});

async function renderSocial(initialState: SocialShellState = posts, friendsLaunchEnabled = true): Promise<void> {
  await act(async () => {
    root.render(createElement(SocialPageClient, { initialState, friendsLaunchEnabled, rivalry: [], heritageCrawls: [] }));
  });
}

describe("Social Posts account resolution", () => {
  it.each([
    { fontSize: 16, width: "224px" },
    { fontSize: 24, width: "336px" },
  ])("keeps the primary action's reserved width when Post becomes Sign in at $fontSize px", async ({ fontSize, width }) => {
    style.sheet!.insertRule(`:root { font-size: ${fontSize}px; }`);
    await renderSocial();
    const primary = host.querySelector(".screenPrimary")!;
    const secondary = host.querySelector('a[href="#find-lot-title"]')!;
    const pendingStyle = getComputedStyle(primary);
    const pendingWidth = pendingStyle.width;
    const pendingMaxWidth = pendingStyle.maxWidth;
    expect(primary.querySelector("button")?.textContent).toBe("Post");
    expect(primary.querySelector("button")?.disabled).toBe(true);

    setSession("signed-out");
    await renderSocial();

    expect(host.querySelector(".screenPrimary")).toBe(primary);
    expect(host.querySelector('a[href="#find-lot-title"]')).toBe(secondary);
    expect(primary.querySelector("button")).toBeNull();
    expect(primary.querySelector("a")?.textContent).toBe("Sign in");
    expect(primary.querySelector("a")?.getAttribute("href")).toContain("/login");
    // jsdom exposes the sizing contract, but does not measure layout or CLS.
    expect(pendingWidth, "reserve the intended desktop action slot before authentication resolves").toBe(width);
    expect(pendingMaxWidth).toBe("100%");
    expect(getComputedStyle(primary).width).toBe(pendingWidth);
    expect(getComputedStyle(primary).maxWidth).toBe(pendingMaxWidth);
  });

  it("reserves the signed-out content in the same rail slot before the account answers", async () => {
    await renderSocial();

    const rail = host.querySelector('aside[aria-label="Social views"]')!;
    const slot = rail.querySelector('section[aria-label="Social posts"]');
    expect(slot, "the pending account must reserve the Posts rail slot").not.toBeNull();
    const content = slot!.querySelector(".emptyState")!.parentElement!;
    const pendingChildren = Array.from(rail.children);
    const sizingContent = content.textContent;
    expect(sizingContent).toContain("No posts to read yet.");
    expect(sizingContent).toContain("Sign in from the button above");
    expect(content.getAttribute("aria-hidden")).toBe("true");
    expect(getComputedStyle(content).visibility).toBe("hidden");
    expect(getComputedStyle(content).display).not.toBe("none");
    expect(getComputedStyle(content).position).not.toBe("absolute");
    const status = slot!.querySelector('[role="status"]')!;
    expect(status.getAttribute("aria-label")).toBe("Loading Social");
    expect(getComputedStyle(status.parentElement!).position).toBe("absolute");
    expect(host.querySelector('.screenPrimary button')?.hasAttribute("disabled")).toBe(true);
    expect(host.querySelector('a[href*="/login"]')).toBeNull();
    expect(transport.request).not.toHaveBeenCalled();

    setSession("signed-out");
    await renderSocial();

    expect(rail.querySelector('section[aria-label="Social posts"]')).toBe(slot);
    expect(Array.from(rail.children)).toEqual(pendingChildren);
    expect(slot!.querySelector(".emptyState")!.parentElement).toBe(content);
    expect(content.textContent).toBe(sizingContent);
    expect(content.hasAttribute("aria-hidden")).toBe(false);
    expect(getComputedStyle(content).visibility).toBe("visible");
    expect(slot!.querySelector('[role="status"]')).toBeNull();
    expect(host.querySelectorAll('.screenPrimary a[href*="/login"]')).toHaveLength(1);
    expect(host.querySelectorAll(".starterPacks__card")).toHaveLength(1);
    expect(host.querySelectorAll(".starterPacks__follow")).toHaveLength(0);
    expect(host.querySelectorAll("#find-lot-title")).toHaveLength(1);
    expect(host.querySelectorAll(".socialFoundersLink")).toHaveLength(1);
  });

  it("keeps an unanswered account neutral and hides stale signed-out copy when resolution restarts", async () => {
    await renderSocial();
    await renderSocial();
    expect(host.querySelector('a[href*="/login"]')).toBeNull();
    expect(transport.request).not.toHaveBeenCalled();

    setSession("signed-out");
    await renderSocial();
    setSession("unresolved");
    await renderSocial();

    const slot = host.querySelector('section[aria-label="Social posts"]')!;
    expect(slot.getAttribute("aria-busy")).toBe("true");
    expect(getComputedStyle(slot.querySelector(".emptyState")!.parentElement!).visibility).toBe("hidden");
    expect(host.querySelector('a[href*="/login"]')).toBeNull();
    expect(host.querySelectorAll("#find-lot-title")).toHaveLength(1);
    expect(host.querySelectorAll(".socialFoundersLink")).toHaveLength(1);
  });

  it.each([
    { initialState: posts, friendsLaunchEnabled: false },
    { initialState: { valid: true as const, tab: "discover" as const, feed: null, area: null }, friendsLaunchEnabled: true },
  ])("leaves rollback and discover without a Posts reservation: %s", async ({ initialState, friendsLaunchEnabled }) => {
    await renderSocial(initialState, friendsLaunchEnabled);
    expect(host.querySelector('section[aria-label="Social posts"]')).toBeNull();
    expect(host.querySelector('section[aria-label="Social preview posts"]')).toBeNull();
    expect(host.querySelector("#find-lot-title")).toBeNull();
    expect(transport.request).not.toHaveBeenCalled();
  });
});
