// @vitest-environment jsdom

// The nav chip wears the person's own face and name on every page. It reads
// the public card for the signed-in handle, and until that card lands the
// claimed handle stands in.

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SignInButton from "@/components/auth/SignInButton";
import { clearSurfaceCache } from "@/lib/surfaceDataCache";

const authState = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => authState.current }));
vi.mock("@/components/auth/ClerkAccountControls", () => ({ default: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

const CARDS: Record<string, { displayName?: string; avatarUrl?: string }> = {
  qa_alice: { displayName: "Alice Archer", avatarUrl: "/api/profiles/a/avatar?v=1" },
};

let host: HTMLDivElement;
let root: Root;
let fetchStub: ReturnType<typeof vi.fn>;

function signedIn(handle: string): void {
  authState.current = {
    loading: false,
    configured: true,
    supabaseAuthState: "signed-in",
    clerkIntegrationConfigured: false,
    socialProviders: { google: false, apple: false, microsoft: false },
    signInWithGoogle: async () => ({}),
    signInWithApple: async () => ({}),
    signInWithMicrosoft: async () => ({}),
    signInWithEmail: async () => ({}),
    cancelAuthAttempt: () => {},
    signOut: async () => {},
    switchAccount: async () => {},
    user: { id: "user-1", email: "login@example.test", user_metadata: {} },
    handle,
  };
}

async function mountChip(): Promise<HTMLButtonElement> {
  await act(async () => {
    root.render(createElement(SignInButton, { compact: true }));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  const trigger = host.querySelector<HTMLButtonElement>(".authCompactTrigger");
  if (!trigger) throw new Error("account chip did not render");
  return trigger;
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  clearSurfaceCache();
  fetchStub = vi.fn(async (input: string) => {
    const handle = decodeURIComponent(String(input).split("/").pop() ?? "");
    return new Response(JSON.stringify({ profile: CARDS[handle] ?? null }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  });
  vi.stubGlobal("fetch", fetchStub);
  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  authState.current = {};
  vi.unstubAllGlobals();
});

describe("SignInButton account chip", () => {
  it("wears the face and name from the person's public card", async () => {
    signedIn("qa_alice");
    const trigger = await mountChip();

    expect(String(fetchStub.mock.calls[0]?.[0])).toBe("/api/profiles/qa_alice");
    expect(trigger.getAttribute("aria-label")).toBe("Account options for Alice Archer");
    expect(trigger.querySelector("img.authAvatar")?.getAttribute("src")).toBe(
      "/api/profiles/a/avatar?v=1",
    );
  });

  it("keeps the claimed handle on the chip when the person has no public card", async () => {
    signedIn("qa_bob");
    const trigger = await mountChip();

    expect(trigger.getAttribute("aria-label")).toBe("Account options for @qa_bob");
    expect(trigger.querySelector("img")).toBeNull();
    expect(trigger.querySelector(".authAvatarFallback")?.textContent).toBe("Q");
  });
});
