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
  current: { supabaseAuthState: "unresolved" } as { supabaseAuthState: string },
}));
const authedFetch = vi.hoisted(() => vi.fn());

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => authState.current,
}));
vi.mock("@/lib/authedFetch", () => ({ authedFetch }));

import WantedList from "@/components/wanted/WantedList";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  authState.current = { supabaseAuthState: "unresolved" };
  authedFetch.mockReset();
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

describe("the Wanted list asks only when there is somebody to ask for", () => {
  it("asks nothing while the session has not answered", async () => {
    await render();
    expect(authedFetch).not.toHaveBeenCalled();
  });

  it("asks nothing for a signed-out reader", async () => {
    authState.current = { supabaseAuthState: "signed-out" };
    await render();
    expect(authedFetch).not.toHaveBeenCalled();
  });

  it("still offers that reader the way in", async () => {
    authState.current = { supabaseAuthState: "signed-out" };
    await render();
    // The 401 was how this state used to be reached. Reaching it without one
    // must not cost the reader the sentence that tells them what to do.
    expect(container.textContent).toMatch(/sign in/i);
  });

  it("drops the previous account's places the moment the session goes", async () => {
    // The signed-out answer is DERIVED rather than stored, so a sign-out hides
    // those rows in the same paint instead of leaving them up until a write
    // clears them. Its sibling holds the same line for the plan chips.
    authState.current = { supabaseAuthState: "authenticated" };
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

    authState.current = { supabaseAuthState: "signed-out" };
    await render();
    expect(container.textContent).not.toContain("Account A Pub");
  });

  it("asks once the session answers with an account", async () => {
    authState.current = { supabaseAuthState: "authenticated" };
    authedFetch.mockResolvedValue(
      new Response(JSON.stringify({ wanteds: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    await render();
    expect(authedFetch).toHaveBeenCalledWith("/api/wanted");
  });
});
