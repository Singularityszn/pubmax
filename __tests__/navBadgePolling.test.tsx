// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: { user: { id: "user-ken" } as { id: string } | null, handle: "ken" },
  fetch: vi.fn<(url: string, init: RequestInit) => Promise<Response>>(),
}));
vi.mock("next/link", () => ({
  useLinkStatus: () => ({ pending: false }),
  default: ({ href, children, prefetch, ...props }: { href: string; children?: React.ReactNode; prefetch?: boolean }) => {
    void prefetch;
    return createElement("a", { href, ...props }, children);
  },
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ prefetch: vi.fn() }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => state.auth }));
vi.mock("@/lib/useSocialFriendsLaunch", () => ({ useSocialFriendsLaunch: () => true }));
vi.mock("@/lib/authedFetch", () => ({ authedActionFetch: (url: string, init: RequestInit) => state.fetch(url, init) }));

import MessagesLink from "@/components/nav/MessagesLink";
import NotificationBell from "@/components/nav/NotificationBell";

let root: Root;
let host: HTMLDivElement;
function visibility(value: DocumentVisibilityState) {
  Object.defineProperty(document, "visibilityState", { configurable: true, value });
  document.dispatchEvent(new Event("visibilitychange"));
}
async function mount(component: typeof MessagesLink) {
  await act(async () => root.render(createElement(component)));
  await act(async () => { await Promise.resolve(); });
}
beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers();
  state.auth = { user: { id: "user-ken" }, handle: "ken" };
  state.fetch.mockReset().mockImplementation(async () => Response.json({ unread: 1, conversations: [{ unread: 1 }] }));
  visibility("visible");
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe.each([["messages", MessagesLink], ["activity", NotificationBell]] as const)("%s badge requests", (_name, component) => {
  it("stops hidden polls and refreshes once when the page becomes visible", async () => {
    await mount(component);
    const initial = state.fetch.mock.calls.length;
    await act(async () => {
      visibility("hidden");
      await vi.advanceTimersByTimeAsync(180_000);
      window.dispatchEvent(new Event("focus"));
    });
    expect(state.fetch).toHaveBeenCalledTimes(initial);
    await act(async () => {
      visibility("visible");
      window.dispatchEvent(new Event("focus"));
    });
    expect(state.fetch).toHaveBeenCalledTimes(initial + 1);
  });

  it("coalesces focus and timer refreshes while a read is still pending", async () => {
    let finish: ((response: Response) => void) | undefined;
    state.fetch.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    await mount(component);
    const initial = state.fetch.mock.calls.length;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("focus"));
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(state.fetch).toHaveBeenCalledTimes(initial);
    await act(async () => { finish?.(Response.json({ unread: 3, conversations: [{ unread: 3 }] })); });
    expect(host.querySelector("a")?.getAttribute("aria-label")).toContain("3 unread");
  });

  it("does not request a badge for a signed-out or initially hidden page", async () => {
    state.auth.user = null;
    await mount(component);
    expect(state.fetch).not.toHaveBeenCalled();
    expect(host.querySelector("a")).toBeNull();
    state.auth = { user: { id: "user-ken" }, handle: "ken" };
    visibility("hidden");
    await mount(component);
    expect(state.fetch).not.toHaveBeenCalled();
  });

  it("ignores a cancelled read that resolves after the visible refresh", async () => {
    const pending: Array<(response: Response) => void> = [];
    state.fetch.mockImplementation(() => new Promise<Response>((resolve) => pending.push(resolve)));
    await mount(component);
    await act(async () => { visibility("hidden"); visibility("visible"); });
    expect(pending).toHaveLength(2);
    await act(async () => { pending[1]!(Response.json({ unread: 3, conversations: [{ unread: 3 }] })); });
    await act(async () => { pending[0]!(Response.json({ unread: 99, conversations: [{ unread: 99 }] })); });
    expect(host.querySelector("a")?.getAttribute("aria-label")).toContain("3 unread");
  });

  it.each([
    ["account", "user-bob", "ken"],
    ["handle", "user-ken", "bob"],
    ["account and handle", "user-bob", "bob"],
  ])("hides the old count when the %s changes, including a failed refresh", async (_change, userId, handle) => {
    await mount(component);
    expect(host.querySelector("a")?.getAttribute("aria-label")).toContain("1 unread");
    let finish: ((response: Response) => void) | undefined;
    state.fetch.mockImplementation(() => new Promise<Response>((resolve) => { finish = resolve; }));
    state.auth = { user: { id: userId }, handle };
    await mount(component);
    expect(host.querySelector(".siteNavBellBadge")).toBeNull();
    expect(host.querySelector("a")?.getAttribute("aria-label")).not.toContain("unread");
    await act(async () => { finish?.(Response.json({ error: "Unavailable" }, { status: 503 })); });
    expect(host.querySelector(".siteNavBellBadge")).toBeNull();
    state.fetch.mockImplementation(async () => Response.json({ unread: 4, conversations: [{ unread: 4 }] }));
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(host.querySelector("a")?.getAttribute("aria-label")).toContain("4 unread");
  });
});
