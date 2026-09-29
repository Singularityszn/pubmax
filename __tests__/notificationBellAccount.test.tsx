// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: { user: { id: "account-a" } as { id: string } | null, handle: "accounta" as string | null },
}));
const fetchMock = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => authState.current }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: fetchMock }));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({ useSocialFriendsLaunch: () => true }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: vi.fn() }) }));
vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: ReactNode; prefetch?: boolean }) =>
    createElement("a", { href, ...props, prefetch: undefined }, children),
}));

import NotificationBell from "@/components/nav/NotificationBell";

afterEach(() => {
  authState.current = { user: { id: "account-a" }, handle: "accounta" };
  fetchMock.mockReset();
  window.localStorage.clear();
  document.body.innerHTML = "";
});

it("clears A's badge on sign-out and ignores A's delayed response", async () => {
  let resolveLate: ((response: Response) => void) | undefined;
  fetchMock
    .mockResolvedValueOnce(new Response(JSON.stringify({ unread: 7 }), { status: 200 }))
    .mockImplementation(() => new Promise<Response>((resolve) => { resolveLate = resolve; }));

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => {
    root.render(createElement(NotificationBell));
  });
  await vi.waitFor(() => expect(host.querySelector("a")?.getAttribute("aria-label")).toBe("Activity: 7 unread"));

  await act(async () => window.dispatchEvent(new Event("focus")));
  await vi.waitFor(() => expect(resolveLate).toBeTypeOf("function"));
  authState.current = { user: null, handle: null };
  await act(async () => root.render(createElement(NotificationBell)));
  expect(host.querySelector("a")?.getAttribute("aria-label")).toBe("Activity");
  expect(host.querySelector(".siteNavBellBadge")).toBeNull();

  await act(async () => resolveLate?.(new Response(JSON.stringify({ unread: 9 }), { status: 200 })));
  expect(host.querySelector("a")?.getAttribute("aria-label")).toBe("Activity");
  expect(host.querySelector(".siteNavBellBadge")).toBeNull();
  await act(async () => root.unmount());
});

it("does not reuse a stored handle after the canonical handle clears", async () => {
  window.localStorage.setItem("pubmax_handle", "accounta");
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ unread: 7 }), { status: 200 }));
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  await act(async () => root.render(createElement(NotificationBell)));
  await vi.waitFor(() => expect(host.querySelector("a")?.getAttribute("aria-label")).toBe("Activity: 7 unread"));

  fetchMock.mockClear();
  authState.current = { user: { id: "account-a" }, handle: null };
  await act(async () => root.render(createElement(NotificationBell)));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  expect(host.querySelector("a")?.getAttribute("aria-label")).toBe("Activity");
  expect(fetchMock).not.toHaveBeenCalled();
  await act(async () => root.unmount());
});
