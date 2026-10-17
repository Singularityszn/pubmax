// @vitest-environment jsdom
import { act as reactAct, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

const authState = vi.hoisted(() => ({
  current: {} as Record<string, unknown>,
}));

const deviceState = vi.hoisted(() => ({
  records: [] as Array<{ userId: string; refreshToken: string; email: string; handle: string | null; lastActiveAt: number }>,
}));

vi.mock("@/components/auth/useDeviceAccounts", () => ({
  useDeviceAccounts: () => deviceState.records,
}));

const requestState = vi.hoisted(() => ({
  calls: [] as string[],
  responses: [] as Array<Response | Error>,
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));

vi.mock("@/lib/accountBoundFetch", () => ({
  captureAccountAuth: (userId: string | null, session: { access_token?: string } | null) =>
    userId && session?.access_token
      ? { userId, accessToken: session.access_token }
      : null,
  accountBoundFetch: async (
    _auth: unknown,
    input: RequestInfo | URL,
  ) => {
    requestState.calls.push(String(input));
    const response = requestState.responses.shift() ?? Response.json({ complete: true });
    if (response instanceof Error) throw response;
    return response;
  },
}));

import AccountOnboarding, {
  AccountOnboardingLoadError,
} from "@/components/identity/AccountOnboarding";
import { readStrictModalFocusTrap } from "@/lib/useFocusTrap";

let root: Root | null = null;
let container: HTMLDivElement;

async function commit(work: () => void | Promise<void>): Promise<void> {
  if (typeof reactAct === "function") {
    await reactAct(work);
    return;
  }
  work();
  await Promise.resolve();
}

function settleOnboarding(): Promise<void> {
  return commit(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  authState.current = {
    user: { id: "user-a" },
    session: { user: { id: "user-a" }, access_token: "token-a" },
    loading: false,
    identityResolved: false,
    signOut: vi.fn(async () => {}),
    switchAccount: vi.fn(async () => ({ status: "unavailable" })),
  };
  deviceState.records = [];
  requestState.calls = [];
  requestState.responses = [];

  document.body.replaceChildren();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", typeof reactAct === "function");
  container = document.createElement("div");
  root = createRoot(container);
});

afterEach(async () => {
  if (root) {
    await commit(() => root?.unmount());
    root = null;
  }
  document.body.replaceChildren();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("AccountOnboarding cold-open identity race", () => {
  it("lets an unclaimed account sign out inside the mandatory modal without claiming", async () => {
    requestState.responses = [Response.json({ complete: false })];
    authState.current.identityResolved = true;
    authState.current.user = { id: "user-a", email: "new@example.test" };
    const signOut = vi.fn(async () => {
      authState.current = { ...authState.current, user: null, session: null };
      root?.render(createElement(AccountOnboarding));
    });
    authState.current.signOut = signOut;
    await commit(() => root?.render(createElement(AccountOnboarding)));
    await settleOnboarding();
    const dialog = document.querySelector('[role="dialog"]')!;
    expect(dialog.textContent).toContain("new@example.test");
    expect([...dialog.querySelectorAll("button")].find((button) => button.textContent === "Claim handle")?.disabled).toBe(true);
    const exit = [...dialog.querySelectorAll("button")].find((button) => button.textContent === "Sign out");
    expect(exit).toBeDefined();
    await commit(() => exit?.click());
    await settleOnboarding();
    expect(signOut).toHaveBeenCalledWith("account");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(requestState.calls).toEqual(["/api/identity/onboarding"]);
    expect(localStorage.getItem("pubmax_handle")).toBeNull();

    requestState.responses = [Response.json({ complete: false, handle: "original" })];
    authState.current = { ...authState.current, user: { id: "user-b" }, session: { user: { id: "user-b" }, access_token: "token-b" } };
    await commit(() => root?.render(createElement(AccountOnboarding)));
    await settleOnboarding();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(localStorage.getItem("pubmax_handle")).toBe("original");
  });

  it("switches to a remembered owned account from an unclaimed modal without a claim", async () => {
    deviceState.records = [{ userId: "user-b", refreshToken: "token-b", email: "owned@example.test", handle: "original", lastActiveAt: 1 }];
    requestState.responses = [Response.json({ complete: false })];
    authState.current.identityResolved = true;
    const switchAccount = vi.fn(async (userId: string) => {
      requestState.responses = [Response.json({ complete: false, handle: "original" })];
      authState.current = { ...authState.current, user: { id: userId }, session: { user: { id: userId }, access_token: "token-b" } };
      root?.render(createElement(AccountOnboarding));
      return { status: "switched", userId };
    });
    authState.current.switchAccount = switchAccount;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({})));
    await commit(() => root?.render(createElement(AccountOnboarding)));
    await settleOnboarding();
    const toggle = [...document.querySelectorAll('[role="dialog"] button')].find((button) => button.textContent?.startsWith("Switch account"));
    expect(toggle).toBeDefined();
    await commit(() => (toggle as HTMLButtonElement)?.click());
    const target = document.querySelector<HTMLButtonElement>('[role="dialog"] .authSwitcherRow');
    expect(target?.textContent).toContain("@original");
    switchAccount.mockResolvedValueOnce({ status: "unavailable", userId: "user-b" });
    await commit(() => target?.click());
    await settleOnboarding();
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("could not switch account");
    expect(requestState.calls).toEqual(["/api/identity/onboarding"]);
    await commit(() => target?.click());
    await settleOnboarding();
    expect(switchAccount).toHaveBeenCalledWith("user-b");
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    expect(requestState.calls).toEqual(["/api/identity/onboarding", "/api/identity/onboarding"]);
    expect(localStorage.getItem("pubmax_handle")).toBe("original");
  });

  it("supersedes an open sheet with strict modal focus and restores its owner", async () => {
    const sheetControl = document.createElement("button");
    sheetControl.inert = false;
    sheetControl.setAttribute("class", "mobileTabBar");
    document.body.appendChild(sheetControl);
    sheetControl.focus();
    requestState.responses = [Response.json({ complete: false })];
    authState.current.identityResolved = true;

    await commit(() => root?.render(createElement(AccountOnboarding)));
    await settleOnboarding();

    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(document.activeElement).toBe(dialog);
    expect(sheetControl.inert).toBe(true);
    expect(readStrictModalFocusTrap()).toBe(true);

    authState.current = {
      user: null,
      session: null,
      loading: false,
      identityResolved: true,
    };
    await commit(() => root?.render(createElement(AccountOnboarding)));

    expect(document.activeElement).toBe(sheetControl);
    expect(sheetControl.inert).toBe(false);
    expect(readStrictModalFocusTrap()).toBe(false);
  });

  it("does not read onboarding status without a live session", async () => {
    authState.current = {
      user: null,
      session: null,
      loading: false,
      identityResolved: true,
    };

    await commit(() => root?.render(createElement(AccountOnboarding)));

    expect(requestState.calls).toHaveLength(0);
    expect(container.childNodes).toHaveLength(0);
  });

  it("waits for identity resolution before reading onboarding status", async () => {
    await commit(() => root?.render(createElement(AccountOnboarding)));
    expect(requestState.calls).toHaveLength(0);

    authState.current.identityResolved = true;
    await commit(() => root?.render(createElement(AccountOnboarding)));

    await vi.waitFor(() => expect(requestState.calls).toHaveLength(1));
    expect(requestState.calls).toEqual(["/api/identity/onboarding"]);
  });

  it("does not restart the status read when an identity event rerenders its parent", async () => {
    requestState.responses = Array.from({ length: 20 }, () =>
      Response.json({ complete: true, handle: "night_owl" }),
    );
    authState.current.identityResolved = true;

    await commit(() => root?.render(createElement(AccountOnboarding)));
    await settleOnboarding();
    for (let rerender = 0; rerender < 5; rerender += 1) {
      await commit(() => root?.render(createElement(AccountOnboarding)));
      await settleOnboarding();
    }

    expect(requestState.calls).toHaveLength(1);
  });

  it("retries one failed authenticated read before showing a failure", async () => {
    vi.useFakeTimers();
    requestState.responses = [
      new TypeError("Failed to fetch"),
      Response.json({ complete: true }),
    ];
    authState.current.identityResolved = true;

    await commit(() => root?.render(createElement(AccountOnboarding)));
    await commit(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(requestState.calls).toHaveLength(1);

    await commit(() => {
      vi.advanceTimersByTime(249);
    });
    expect(requestState.calls).toHaveLength(1);
    await commit(() => {
      vi.advanceTimersByTime(1);
    });
    await commit(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requestState.calls).toHaveLength(2);
    expect(requestState.calls).toEqual([
      "/api/identity/onboarding",
      "/api/identity/onboarding",
    ]);
    vi.useRealTimers();
  });

  it("keeps the quiet loading state while a failed read is retrying", async () => {
    vi.useFakeTimers();
    requestState.responses = [
      new TypeError("Failed to fetch"),
      Response.json({ complete: true }),
    ];
    authState.current.identityResolved = true;

    await commit(() => root?.render(createElement(AccountOnboarding)));
    await settleOnboarding();

    expect(requestState.calls).toHaveLength(1);
    expect(container.childNodes).toHaveLength(0);

    await commit(() => {
      vi.advanceTimersByTime(250);
    });
    await settleOnboarding();

    expect(requestState.calls).toHaveLength(2);
    expect(container.childNodes).toHaveLength(0);
    vi.useRealTimers();
  });

  it("shows persistent failure only after the quiet retry, inline", async () => {
    vi.useFakeTimers();
    requestState.responses = [
      new TypeError("Failed to fetch"),
      new TypeError("Failed to fetch"),
      new TypeError("Failed to fetch"),
    ];
    authState.current.identityResolved = true;

    await commit(() => root?.render(createElement(AccountOnboarding)));
    await commit(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await commit(() => {
      vi.advanceTimersByTime(250);
    });
    await commit(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    await commit(() => {
      vi.advanceTimersByTime(1_500);
    });
    await commit(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(requestState.calls).toHaveLength(3);
    expect(document.body.childNodes[0]?.nodeName).toBe("SECTION");
    expect(container.childNodes).toHaveLength(0);
    vi.useRealTimers();
  });

  it("reloads an unavailable status after connectivity returns without caching identity", async () => {
    vi.useFakeTimers();
    window.setTimeout = setTimeout;
    window.clearTimeout = clearTimeout;
    requestState.responses = [
      new TypeError("Failed to fetch"),
      new TypeError("Failed to fetch"),
      new TypeError("Failed to fetch"),
      Response.json({ complete: true, handle: "night_owl" }),
    ];
    authState.current.identityResolved = true;

    await commit(() => root?.render(createElement(AccountOnboarding)));
    await settleOnboarding();
    await commit(() => {
      vi.advanceTimersByTime(250);
    });
    await settleOnboarding();
    await commit(() => {
      vi.advanceTimersByTime(1_500);
    });
    await settleOnboarding();
    expect(requestState.calls).toHaveLength(3);
    expect(document.body.childNodes[0]?.nodeName).toBe("SECTION");
    expect(container.childNodes).toHaveLength(0);
    expect(sessionStorage.length).toBe(0);

    await commit(() => {
      window.dispatchEvent(new Event("online"));
    });
    await commit(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    await settleOnboarding();

    expect(requestState.calls).toHaveLength(4);
    expect(container.childNodes).toHaveLength(0);
    expect(sessionStorage.length).toBe(0);
    vi.useRealTimers();
  });

  it("keeps persistent read failure inline instead of taking over the surface", () => {
    const html = renderToStaticMarkup(
      createElement(AccountOnboardingLoadError, {
        error: "Account setup is unavailable right now.",
        onRetry: () => {},
      }),
    );
    expect(html).toContain("Account setup is unavailable right now.");
    expect(html).toContain("Try again");
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('role="dialog"');
    expect(html).not.toContain('aria-modal="true"');
    expect(html).not.toContain("accountOnboardingBackdrop");
  });
});
