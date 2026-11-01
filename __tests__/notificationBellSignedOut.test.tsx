// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const fetchMock = vi.hoisted(() => vi.fn());
const authState = vi.hoisted(() => ({
  user: null as { id: string } | null,
  handle: "ken" as string | null,
}));

vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: fetchMock,
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState,
}));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({
  useSocialFriendsLaunch: () => true,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn() }),
}));

import NotificationBell from "@/components/nav/NotificationBell";

let host: HTMLDivElement | null = null;
let root: Root | null = null;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

afterEach(async () => {
  await act(async () => root?.unmount());
  host?.remove();
  root = null;
  host = null;
  fetchMock.mockReset();
  authState.user = null;
  authState.handle = "ken";
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

async function mount(): Promise<void> {
  host = document.createElement("div");
  document.body.appendChild(host);
  const mountedRoot = createRoot(host);
  root = mountedRoot;
  await act(async () => {
    mountedRoot.render(createElement(NotificationBell));
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe("NotificationBell signed-in poll", () => {
  it("does not poll notifications for a signed-out visitor", async () => {
    window.localStorage.setItem("pubmax_handle", "ken");
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    await mount();

    expect(fetchMock).not.toHaveBeenCalled();
    expect(setIntervalSpy).not.toHaveBeenCalled();
    setIntervalSpy.mockRestore();
  });

  it("polls once a visitor is signed in", async () => {
    authState.user = { id: "user-1" };
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ unread: 2 }),
    });

    await mount();

    expect(fetchMock).toHaveBeenCalled();
    expect(String(fetchMock.mock.calls[0]?.[0])).toContain("/api/notifications");
    expect(document.querySelector("a[href='/activity']")).not.toBeNull();
  });

  it("draws no bell for a signed-out visitor, who has no activity behind it", async () => {
    // Oct 2026 UX audit: an icon with nothing behind it is header noise.
    await mount();

    expect(document.querySelector("a[href='/activity']")).toBeNull();
    expect(document.querySelector(".siteNavBell")).toBeNull();
  });
});
