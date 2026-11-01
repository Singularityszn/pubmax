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
  useLinkStatus: () => ({ pending: false }),
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
import { SOCIAL_SIGNED_OUT_VALUE_LINE } from "@/lib/socialLaunch";

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

  it("reserves the signed-out door's one line in the same slot before the account answers", async () => {
    await renderSocial();

    // A stranger on the posts tab reads ONE column (taste plan, 18 Oct 2026):
    // no rail beside a body that holds a single line.
    expect(host.querySelector('aside[aria-label="Social views"]')).toBeNull();
    const door = host.querySelector(".socialDoor")!;
    expect(door, "the posts tab paints one reading column for a stranger").not.toBeNull();
    expect(host.querySelector("main")?.classList.contains("socialPage--door")).toBe(true);
    const slot = door.querySelector('section[aria-label="Social posts"]');
    expect(slot, "the pending account must reserve the door's slot").not.toBeNull();
    const content = slot!.querySelector(".emptyState")!.parentElement!;
    const pendingChildren = Array.from(door.children);
    const sizingContent = content.textContent;
    // The sizing copy is the same shape as the answer (a one-line title and
    // the value line) and names no door before the session answers. Only the
    // title waits: the value line reads the same for every reader, so it
    // paints with the document rather than when the session answers, which
    // made it /social's largest paint.
    expect(sizingContent).toContain(SOCIAL_SIGNED_OUT_VALUE_LINE);
    expect(sizingContent).not.toMatch(/sign in/i);
    expect(content.getAttribute("aria-hidden")).toBe("true");
    expect(getComputedStyle(content.querySelector(".emptyStateTitle")!).visibility).toBe("hidden");
    expect(getComputedStyle(content.querySelector(".emptyStateLine")!).visibility).toBe("visible");
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

    expect(door.querySelector('section[aria-label="Social posts"]')).toBe(slot);
    expect(slot!.querySelector(".emptyState")!.parentElement).toBe(content);
    // The boundary prints its line ONCE, beside the value line, and the head
    // carries the only door.
    expect(content.textContent).toContain("Sign in to use Social.");
    expect(content.textContent).toContain(SOCIAL_SIGNED_OUT_VALUE_LINE);
    expect(content.hasAttribute("aria-hidden")).toBe(false);
    expect(getComputedStyle(content).visibility).toBe("visible");
    expect(getComputedStyle(content.querySelector(".emptyStateTitle")!).visibility).toBe("visible");
    expect(slot!.getAttribute("role")).toBe("status");
    expect(slot!.querySelector('[role="status"]')).toBeNull();
    expect(host.querySelectorAll('a[href*="/login"]')).toHaveLength(1);
    expect(host.querySelectorAll('.screenPrimary a[href*="/login"]')).toHaveLength(1);
    expect(host.textContent!.match(/Sign in/g)).toHaveLength(2);
    expect(host.querySelectorAll(".starterPacks__card")).toHaveLength(1);
    expect(host.querySelectorAll(".starterPacks__follow")).toHaveLength(0);
    expect(host.querySelectorAll("#find-lot-title")).toHaveLength(1);
    expect(host.querySelectorAll(".socialFoundersLink")).toHaveLength(1);
    // Everything above the packs kept its place while the account answered.
    expect(Array.from(door.children).slice(0, 2)).toEqual(pendingChildren.slice(0, 2));
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
    // The stale signed-out title is hidden again; the value line names no door.
    expect(getComputedStyle(slot.querySelector(".emptyStateTitle")!).visibility).toBe("hidden");
    expect(slot.querySelector(".emptyStateTitle")!.textContent).not.toMatch(/sign in/i);
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
