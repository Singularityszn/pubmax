// @vitest-environment jsdom

// Wanted is owner-only, so asking for it with no session is a question the
// browser already knows the answer to. A cold /you asked anyway and took a 401
// to learn it, which is the console noise the 30 August live audit logged on
// the first page a stranger opens.
//
// The gate is `supabaseAuthState`, the auth readiness contract, and it is
// three-way for the reason every identity read here is: `loading` can go false
// while a durable resume is still restoring an account, so "not signed in" and
// "not asked yet" are different answers and only one of them may say Sign in.
// Its sibling __tests__/wantedPlanChipsAuth.test.ts holds the same line for the
// plan chips.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  current: {
    supabaseAuthState: "unresolved",
    user: null,
  } as { supabaseAuthState: string; user: { id: string } | null },
}));
const authedFetch = vi.hoisted(() => vi.fn());
const getCurrentUserId = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ ...authState.current, getCurrentUserId }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => {
    const signedIn = authState.current.supabaseAuthState === "authenticated" && Boolean(authState.current.user);
    const signedOut = authState.current.supabaseAuthState === "signed-out";
    return {
      phase: signedIn ? "signed-in" : signedOut ? "signed-out" : "unresolved",
      signedIn,
      signedOut,
      unresolved: !signedIn && !signedOut,
    };
  },
}));
vi.mock("@/lib/authedFetch", () => ({ authedFetch }));
// The Wanted list's age door shares the contribution gate dialog's module,
// which pulls in SignInButton, and that file imports next/dynamic. This file replaces
// next/dynamic with a factory that awaits WantedListBody, so the real
// SignInButton would wait on a factory that is waiting on it. The door is not
// under test here.
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("next/dynamic", async () => {
  const { default: Body } = await import("@/components/wanted/WantedListBody");
  return { default: () => Body };
});

import WantedList from "@/components/wanted/WantedList";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  authState.current = { supabaseAuthState: "unresolved", user: null };
  authedFetch.mockReset();
  getCurrentUserId.mockImplementation(() => authState.current.user?.id ?? null);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

async function render(): Promise<void> {
  await act(async () => {
    root.render(createElement(WantedList));
  });
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function wantedResponse(venueName?: string): Response {
  return new Response(
    JSON.stringify({
      wanteds: venueName
        ? [{ id: venueName, status: "open", venueKind: "pub", venueName }]
        : [],
    }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("the Wanted list asks only when there is somebody to ask for", () => {
  it("asks nothing while the session has not answered", async () => {
    await render();
    expect(authedFetch).not.toHaveBeenCalled();
  });

  it("asks nothing for a signed-out reader", async () => {
    authState.current = { supabaseAuthState: "signed-out", user: null };
    await render();
    expect(authedFetch).not.toHaveBeenCalled();
  });

  it("still offers that reader the way in", async () => {
    authState.current = { supabaseAuthState: "signed-out", user: null };
    await render();
    // The 401 was how this state used to be reached. Reaching it without one
    // must not cost the reader the sentence that tells them what to do.
    expect(container.textContent).toMatch(/sign in/i);
  });

  it("drops the previous account's places the moment the session goes", async () => {
    // The signed-out answer is DERIVED rather than stored, so a sign-out hides
    // those rows in the same paint instead of leaving them up until a write
    // clears them. Its sibling holds the same line for the plan chips.
    authState.current = { supabaseAuthState: "authenticated", user: { id: "account-a" } };
    authedFetch.mockResolvedValue(
      new Response(
        JSON.stringify({
          wanteds: [
            { id: "w-1", status: "open", venueKind: "pub", venueName: "Account A Pub" },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      ),
    );
    await render();
    expect(container.textContent).toContain("Account A Pub");

    authState.current = { supabaseAuthState: "signed-out", user: null };
    await render();
    expect(container.textContent).not.toContain("Account A Pub");
  });

  it("asks once the session answers with an account", async () => {
    authState.current = { supabaseAuthState: "authenticated", user: { id: "account-a" } };
    authedFetch.mockResolvedValue(
      new Response(JSON.stringify({ wanteds: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await render();
    expect(authedFetch).toHaveBeenCalledWith(
      "/api/wanted",
      { signal: expect.any(AbortSignal) },
      { requiresIdentity: true },
    );
  });

  it("does not issue a queued read after the live account changes", async () => {
    authState.current = { supabaseAuthState: "authenticated", user: { id: "account-a" } };
    authedFetch.mockResolvedValue(wantedResponse());
    await render();
    authedFetch.mockReset();

    authState.current = { supabaseAuthState: "authenticated", user: { id: "account-b" } };
    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("pubmax:wanted-fulfilled", {
          detail: { note: "Account A was fulfilled", userId: "account-a" },
        }),
      );
    });

    expect(authedFetch).not.toHaveBeenCalled();
  });

  it.each(["unresolved", "signed-out"] as const)(
    "does not fetch after a fulfil event while auth is %s",
    async (supabaseAuthState) => {
      authState.current = { supabaseAuthState, user: null };
      await render();

      await act(async () => {
        window.dispatchEvent(
          new CustomEvent("pubmax:wanted-fulfilled", {
            detail: { note: "Not for this reader" },
          }),
        );
      });

      expect(authedFetch).not.toHaveBeenCalled();
      expect(container.textContent).not.toContain("Not for this reader");
    },
  );

  it("keeps an earlier account response out after switching accounts", async () => {
    const accountA = deferred<Response>();
    const accountB = deferred<Response>();
    authedFetch
      .mockImplementationOnce(() => accountA.promise)
      .mockImplementationOnce(() => accountB.promise);

    authState.current = { supabaseAuthState: "authenticated", user: { id: "account-a" } };
    await render();
    authState.current = { supabaseAuthState: "authenticated", user: { id: "account-b" } };
    await render();
    expect(authedFetch).toHaveBeenCalledTimes(2);

    await act(async () => {
      accountB.resolve(wantedResponse("Account B Pub"));
      await accountB.promise;
    });
    expect(container.textContent).toContain("Account B Pub");

    await act(async () => {
      accountA.resolve(wantedResponse("Account A Pub"));
      await accountA.promise;
    });
    expect(container.textContent).toContain("Account B Pub");
    expect(container.textContent).not.toContain("Account A Pub");
  });

  it("does not keep one account's Wanted draft for the next account", async () => {
    authState.current = { supabaseAuthState: "authenticated", user: { id: "account-a" } };
    authedFetch.mockResolvedValue(wantedResponse());
    await render();
    const paste = container.querySelector<HTMLInputElement>("#wanted-paste");
    expect(paste).not.toBeNull();
    if (!paste) return;

    await act(async () => {
      paste.value = "Account A draft";
      paste.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await render();
    expect(container.querySelector<HTMLInputElement>("#wanted-paste")?.value).toBe(
      "Account A draft",
    );

    authState.current = { supabaseAuthState: "authenticated", user: { id: "account-b" } };
    await render();
    expect(container.querySelector<HTMLInputElement>("#wanted-paste")?.value).toBe("");
  });

  it("does not carry a fulfil note to another account", async () => {
    authedFetch.mockImplementation(() => Promise.resolve(wantedResponse()));
    authState.current = { supabaseAuthState: "authenticated", user: { id: "account-a" } };
    await render();

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("pubmax:wanted-fulfilled", {
          detail: { note: "Account A was fulfilled", userId: "account-a" },
        }),
      );
    });
    expect(container.textContent).toContain("Account A was fulfilled");

    authState.current = { supabaseAuthState: "authenticated", user: { id: "account-b" } };
    await render();
    expect(container.textContent).not.toContain("Account A was fulfilled");
  });

  it("ignores a fulfil event owned by another account", async () => {
    authedFetch.mockImplementation(() => Promise.resolve(wantedResponse()));
    authState.current = { supabaseAuthState: "authenticated", user: { id: "account-b" } };
    await render();
    const reads = authedFetch.mock.calls.length;

    await act(async () => {
      window.dispatchEvent(
        new CustomEvent("pubmax:wanted-fulfilled", {
          detail: { note: "Account A was fulfilled", userId: "account-a" },
        }),
      );
    });

    expect(authedFetch.mock.calls).toHaveLength(reads);
    expect(container.textContent).not.toContain("Account A was fulfilled");
  });
});
