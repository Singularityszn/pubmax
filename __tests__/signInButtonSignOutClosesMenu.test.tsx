// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SignInButton from "@/components/auth/SignInButton";

// The nav menu is opened as the ACCOUNT menu. Choosing Sign out used to leave
// its open flag set, so the same component re-rendered as the SIGNED-OUT
// control with that flag still true and the Sign in popover opened by itself.

const authState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => authState.current }));
vi.mock("@/components/auth/ClerkAccountControls", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/u/someone" }));

let container: HTMLDivElement;
let root: Root;

const base = {
  loading: false,
  configured: true,
  supabaseAuthState: "authenticated",
  clerkIntegrationConfigured: false,
  socialProviders: { google: false, apple: false, microsoft: false },
  signInWithGoogle: async () => ({}),
  signInWithApple: async () => ({}),
  signInWithMicrosoft: async () => ({}),
  signInWithEmail: async () => ({}),
  cancelAuthAttempt: () => {},
  switchAccount: async () => ({}),
};

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    value: () => ({
      matches: false,
      addEventListener() {},
      removeEventListener() {},
    }),
  });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

function render(): void {
  act(() => {
    root.render(createElement(SignInButton, { compact: true }));
  });
}

describe("SignInButton sign-out", () => {
  it("does not open the sign-in popover by itself after Sign out", async () => {
    authState.current = {
      ...base,
      user: { id: "user-1", email: "mia@example.com", user_metadata: {} },
      handle: "mia",
      signOut: async () => {
        authState.current = { ...base, user: null, handle: null, signOut: async () => {} };
      },
    };
    render();

    await act(async () => {
      container.querySelector<HTMLButtonElement>(".authCompactTrigger")!.click();
    });
    expect(container.querySelector(".authMenu")).not.toBeNull();

    const signOut = [...container.querySelectorAll<HTMLButtonElement>(".authMenu button")].find(
      (candidate) => candidate.textContent?.trim() === "Sign out",
    )!;
    await act(async () => {
      signOut.click();
    });
    render();

    expect(container.querySelector(".authMenu")).toBeNull();
    expect(container.querySelector("input[type=email]")).toBeNull();
    expect(
      container.querySelector<HTMLButtonElement>(".authCompactTrigger")?.getAttribute("aria-expanded") ?? "false",
    ).toBe("false");
  });
});
