// @vitest-environment jsdom

import { createElement } from "react";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/link", () => ({
  default: ({ href, children, ...props }: { href: string; children: React.ReactNode }) =>
    createElement("a", { href, ...props }, children),
}));
vi.mock("@/components/nav/SiteNav", () => ({
  default: () => createElement("nav", null, "site nav"),
}));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));

// The viewer the page sees: the door it paints depends on who is in front of it.
const viewer = vi.hoisted(() => ({
  phase: "signed-in" as "signed-in" | "signed-out" | "unresolved",
  handle: "alice" as string | null,
  identityResolved: true,
  retryIdentity: vi.fn(),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => ({
    phase: viewer.phase,
    signedIn: viewer.phase === "signed-in",
    signedOut: viewer.phase === "signed-out",
    unresolved: viewer.phase === "unresolved",
  }),
}));
vi.mock("@/components/auth/useViewerHandle", () => ({
  useViewerHandle: () => viewer.handle,
}));
vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({
    identityResolved: viewer.identityResolved,
    retryIdentity: viewer.retryIdentity,
  }),
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: vi.fn(),
}));

import WeAreOutClient from "@/app/we-are-out/WeAreOutClient";
import { authedActionFetch } from "@/lib/authedFetch";

let host: HTMLDivElement;
let root: Root;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

async function completeCheckIn(socialFriendsLaunchEnabled?: boolean): Promise<void> {
  vi.mocked(authedActionFetch).mockResolvedValue(jsonResponse({ ok: true }));
  await act(async () => {
    root.render(createElement(WeAreOutClient, { socialFriendsLaunchEnabled }));
    await Promise.resolve();
    await Promise.resolve();
  });
  const select = host.querySelector<HTMLSelectElement>("select");
  expect(select).toBeTruthy();
  select!.value = select!.options[1]!.value;
  await act(async () => {
    select!.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const submit = [...host.querySelectorAll("button")].find((button) =>
    button.textContent?.includes("I'm here"),
  );
  expect(submit).toBeTruthy();
  await act(async () => {
    submit!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function renderRollback(): Promise<void> {
  await act(async () => {
    root.render(createElement(WeAreOutClient, { socialFriendsLaunchEnabled: false }));
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  viewer.phase = "signed-in";
  viewer.handle = "alice";
  viewer.identityResolved = true;
  viewer.retryIdentity.mockReset();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  host.remove();
  vi.clearAllMocks();
});

describe("we-are-out Social honesty", () => {
  it("defaults completed check-ins to Social", async () => {
    await completeCheckIn();
    expect(host.querySelector('a[href="/social"]')?.textContent).toContain("Open Social");
  });

  it("uses Memories for completed check-ins during rollback", async () => {
    await renderRollback();
    expect(host.querySelector('a[href="/u/you#night-memories"]')?.textContent).toContain("Open Memories");
  });
});

// F18: signed out, the full form opened and only a submit answered "Choose a
// handle in your account first." with no way to act on it.
describe("we-are-out signed-out and handle-less doors", () => {
  async function render(): Promise<void> {
    await act(async () => {
      root.render(createElement(WeAreOutClient, { socialFriendsLaunchEnabled: true }));
      await Promise.resolve();
    });
  }

  it("shows a sign-in door in place of the form, returning to /we-are-out", async () => {
    viewer.phase = "signed-out";
    viewer.handle = null;
    await render();
    expect(host.querySelector("select")).toBeNull();
    expect(host.textContent).toContain("Sign in to tell your lot.");
    const door = host.querySelector<HTMLAnchorElement>("a.weAreOutDoorAction");
    expect(door?.getAttribute("href")).toBe("/login?from=%2Fwe-are-out");
    expect(host.querySelector('[role="alert"]')).toBeNull();
  });

  it("shows a claim-a-handle door for an account with no handle", async () => {
    viewer.phase = "signed-in";
    viewer.handle = null;
    await render();
    expect(host.querySelector("select")).toBeNull();
    expect(host.textContent).toContain("Choose a handle first.");
    expect(host.querySelector("a.weAreOutDoorAction")?.getAttribute("href")).toBe("/u/you");
  });

  it("paints no invitation and no form until the session has answered", async () => {
    viewer.phase = "unresolved";
    viewer.handle = null;
    await render();
    expect(host.querySelector("a.weAreOutDoorAction")).toBeNull();
    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Checking your account.");
  });

  it("does not call an account handle-less before its identity resolves", async () => {
    viewer.phase = "signed-in";
    viewer.handle = null;
    viewer.identityResolved = false;
    await render();
    expect(host.querySelector("a.weAreOutDoorAction")).toBeNull();
    expect(host.querySelector("select")).toBeNull();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Checking your account.");
  });

  // A failed identity read leaves the account unknown, and nothing reads it
  // again on its own: the wait must not be a dead end.
  it("offers Try again and the profile after a slow account check, and reads again", async () => {
    vi.useFakeTimers();
    viewer.phase = "signed-in";
    viewer.handle = null;
    viewer.identityResolved = false;
    await render();
    const tryAgain = () =>
      [...host.querySelectorAll("button")].find((button) => button.textContent === "Try again");

    await act(async () => {
      vi.advanceTimersByTime(3_999);
    });
    expect(tryAgain()).toBeUndefined();
    expect(host.querySelector('a[href="/u/you"]')).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(1);
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Checking your account.");
    expect(tryAgain()).toBeTruthy();
    expect(host.querySelector('a[href="/u/you"]')?.textContent).toBe("Open your profile");
    expect(host.querySelector("select")).toBeNull();

    await act(async () => {
      tryAgain()!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(viewer.retryIdentity).toHaveBeenCalledTimes(1);
    expect(tryAgain()).toBeUndefined();
    expect(host.textContent).toContain("One moment, then you can tell your lot.");

    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    expect(tryAgain()).toBeTruthy();
  });

  it("offers sign-in and the profile, never Try again, when the session stays unanswered", async () => {
    vi.useFakeTimers();
    viewer.phase = "unresolved";
    viewer.handle = null;
    viewer.identityResolved = false;
    await render();

    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    expect(host.querySelector('[role="status"]')?.textContent).toContain("Checking your account.");
    expect(host.querySelector("button")).toBeNull();
    expect(host.querySelector('a[href="/login?from=%2Fwe-are-out"]')?.textContent).toBe("Sign in");
    expect(host.querySelector('a[href="/u/you"]')?.textContent).toBe("Open your profile");
    expect(host.querySelector("select")).toBeNull();
    expect(viewer.retryIdentity).not.toHaveBeenCalled();
  });

  it("opens the form once a retried read resolves the handle", async () => {
    vi.useFakeTimers();
    viewer.phase = "signed-in";
    viewer.handle = null;
    viewer.identityResolved = false;
    await render();
    await act(async () => {
      vi.advanceTimersByTime(4_000);
    });
    viewer.retryIdentity.mockImplementation(() => {
      viewer.handle = "alice";
      viewer.identityResolved = true;
    });
    const tryAgain = [...host.querySelectorAll("button")].find(
      (button) => button.textContent === "Try again",
    );
    await act(async () => {
      tryAgain!.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await render();
    expect(host.querySelector("select")).toBeTruthy();
    expect(host.querySelector('[role="status"]')).toBeNull();
  });
});
