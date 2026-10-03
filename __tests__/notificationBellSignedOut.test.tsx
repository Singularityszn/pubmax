// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";

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
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children?: ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ prefetch: vi.fn() }),
}));

import NotificationBell from "@/components/nav/NotificationBell";

afterEach(() => {
  fetchMock.mockReset();
  authState.user = null;
  authState.handle = "ken";
  window.localStorage.clear();
  document.body.innerHTML = "";
});

async function mount(): Promise<void> {
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(NotificationBell));
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
  });
});
