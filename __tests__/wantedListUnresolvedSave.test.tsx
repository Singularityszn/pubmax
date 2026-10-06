// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  auth: {
    accountRevision: 0,
    supabaseAuthState: "unresolved" as "unresolved" | "authenticated",
    user: null as { id: string } | null,
  },
  fetch: vi.fn(),
  action: vi.fn(),
  getCurrentUserId: vi.fn(),
}));

vi.mock("@/components/auth/AuthProvider", () => ({
  useAuth: () => ({ ...state.auth, getCurrentUserId: state.getCurrentUserId }),
}));
vi.mock("@/components/auth/useViewerSession", () => ({
  useViewerSession: () => {
    const signedIn = state.auth.supabaseAuthState === "authenticated" && Boolean(state.auth.user);
    return {
      phase: signedIn ? "signed-in" : "unresolved",
      signedIn,
      signedOut: false,
      unresolved: !signedIn,
    };
  },
}));
vi.mock("@/lib/authedFetch", () => ({
  authedActionFetch: state.action,
  authedFetch: state.fetch,
}));
// WantedCapture reaches the contribution gate dialog, whose sign-in door pulls
// in SignInButton, and that file imports next/dynamic. This file replaces
// next/dynamic with a factory that awaits WantedListBody, so the real
// SignInButton would wait on a factory that is waiting on it. The door is not
// under test here.
vi.mock("@/components/auth/SignInButton", () => ({ default: () => null }));
vi.mock("@/lib/venueMapUrl", () => ({
  venueMapUrl: (venueId: string) => `/map/${venueId}`,
}));
vi.mock("@/components/wanted/WantedPromotionControl", () => ({
  default: () => null,
}));
vi.mock("next/dynamic", async () => {
  const { default: Body } = await import("@/components/wanted/WantedListBody");
  return { default: () => Body };
});

import WantedList from "@/components/wanted/WantedList";
import { setProviderIdentity } from "@/lib/authProviderRevision";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  setProviderIdentity("supabase", null);
  state.auth = {
    accountRevision: 0,
    supabaseAuthState: "unresolved",
    user: null,
  };
  state.fetch.mockReset().mockImplementation(() => new Promise<Response>(() => {}));
  state.action.mockReset().mockImplementation(async (input: RequestInfo | URL) => {
    if (String(input) === "/api/wanted/resolve") {
      return new Response(JSON.stringify({
        query: "Dove",
        sourceUrl: "",
        sourcePlatform: "none",
        rawPaste: "The Dove",
        status: "ready",
        candidates: [
          {
            venueId: "venue-dove",
            venueName: "The Dove",
            venueKind: "curated",
            address: "",
            contextLabel: "Hammersmith",
          },
        ],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }
    throw new Error(`Unexpected action: ${String(input)}`);
  });
  state.getCurrentUserId.mockImplementation(() => state.auth.user?.id ?? null);
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

describe("Wanted saves crossing auth settlement", () => {
  it("keeps an anonymous save after the first account arrives without attributing it", async () => {
    await render();

    await act(async () => {
      const paste = container.querySelector<HTMLInputElement>("#wanted-paste");
      if (!paste) throw new Error("Wanted paste input missing.");
      paste.value = "The Dove";
      paste.dispatchEvent(new Event("input", { bubbles: true }));
    });

    const findButton = container.querySelector<HTMLButtonElement>("button.wantedCapture__submit");
    expect(findButton?.disabled).toBe(false);
    await act(async () => {
      findButton?.click();
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    });

    const candidate = container.querySelector<HTMLButtonElement>(".wantedCandidate");
    expect(candidate).not.toBeNull();
    await act(async () => {
      candidate?.click();
      await Promise.resolve();
    });
    const anonymousList = container.querySelector<HTMLElement>("[aria-label='Anonymous open Wanted places']");
    expect(anonymousList?.textContent).toContain("The Dove");
    expect(container.querySelector("[aria-label='Open Wanted places']")).toBeNull();
    expect(state.action.mock.calls.some(([input]) => String(input) === "/api/wanted")).toBe(false);
    expect(state.action.mock.calls.find(([input]) => String(input) === "/api/wanted/resolve")?.[2]).toEqual({
      requiresIdentity: false,
    });

    setProviderIdentity("supabase", "account-a");
    state.auth = {
      accountRevision: 1,
      supabaseAuthState: "authenticated",
      user: { id: "account-a" },
    };
    await render();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(container.querySelector("[aria-label='Anonymous open Wanted places']")?.textContent)
      .toContain("The Dove");
    expect(container.querySelector("[aria-label='Open Wanted places']")).toBeNull();
  });
});
