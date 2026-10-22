// @vitest-environment jsdom

import { act, createElement, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
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

const roots = new Set<Root>();

afterEach(async () => {
  await act(async () => {
    for (const root of roots) root.unmount();
  });
  roots.clear();
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
  roots.add(root);
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
});

it("keeps B's badge when an already in-flight A response arrives later", async () => {
  let resolveAccountA: ((response: Response) => void) | undefined;
  fetchMock
    .mockResolvedValueOnce(new Response(JSON.stringify({ unread: 7 }), { status: 200 }))
    .mockImplementationOnce(() => new Promise<Response>((resolve) => { resolveAccountA = resolve; }))
    .mockResolvedValueOnce(new Response(JSON.stringify({ unread: 3 }), { status: 200 }));

  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.add(root);
  await act(async () => root.render(createElement(NotificationBell)));
  await vi.waitFor(() => expect(host.querySelector("a")?.getAttribute("aria-label")).toBe("Activity: 7 unread"));

  await act(async () => window.dispatchEvent(new Event("focus")));
  await vi.waitFor(() => expect(resolveAccountA).toBeTypeOf("function"));
  authState.current = { user: { id: "account-b" }, handle: "accountb" };
  await act(async () => root.render(createElement(NotificationBell)));
  await vi.waitFor(() => expect(host.querySelector("a")?.getAttribute("aria-label")).toBe("Activity: 3 unread"));
  expect(host.querySelector(".siteNavBellBadge")?.textContent).toBe("3");

  await act(async () => resolveAccountA?.(new Response(JSON.stringify({ unread: 9 }), { status: 200 })));
  expect(host.querySelector("a")?.getAttribute("aria-label")).toBe("Activity: 3 unread");
  expect(host.querySelector(".siteNavBellBadge")?.textContent).toBe("3");
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
    "/api/notifications?handle=accounta",
    "/api/notifications?handle=accounta",
    "/api/notifications?handle=accountb",
  ]);
});

it("does not reuse a stored handle after the canonical handle clears", async () => {
  window.localStorage.setItem("pubmax_handle", "accounta");
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ unread: 7 }), { status: 200 }));
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.add(root);
  await act(async () => root.render(createElement(NotificationBell)));
  await vi.waitFor(() => expect(host.querySelector("a")?.getAttribute("aria-label")).toBe("Activity: 7 unread"));

  fetchMock.mockClear();
  authState.current = { user: { id: "account-a" }, handle: null };
  await act(async () => root.render(createElement(NotificationBell)));
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });

  expect(host.querySelector("a")?.getAttribute("aria-label")).toBe("Activity");
  expect(fetchMock).not.toHaveBeenCalled();
});

it("does not start A's queued refresh after switching to B", async () => {
  fetchMock.mockImplementation(async () => new Response(JSON.stringify({ unread: 2 }), { status: 200 }));
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.add(root);

  await act(async () => {
    flushSync(() => root.render(createElement(NotificationBell)));
    authState.current = { user: { id: "account-b" }, handle: "accountb" };
    flushSync(() => root.render(createElement(NotificationBell)));
  });

  await vi.waitFor(() => expect(host.querySelector("a")?.getAttribute("aria-label")).toBe("Activity: 2 unread"));
  expect(fetchMock.mock.calls.map(([url]) => url)).toEqual(["/api/notifications?handle=accountb"]);
});

it("does not poll a signed-out account even when a legacy handle remains", async () => {
  authState.current = { user: null, handle: "accounta" };
  window.localStorage.setItem("pubmax_handle", "accounta");
  fetchMock.mockResolvedValue(new Response(JSON.stringify({ unread: 7 }), { status: 200 }));
  const host = document.createElement("div");
  document.body.appendChild(host);
  const root = createRoot(host);
  roots.add(root);
  await act(async () => root.render(createElement(NotificationBell)));
  await act(async () => window.dispatchEvent(new Event("focus")));

  expect(fetchMock).not.toHaveBeenCalled();
  expect(host.querySelector("a")?.getAttribute("aria-label")).toBe("Activity");
  expect(host.querySelector(".siteNavBellBadge")).toBeNull();
});
