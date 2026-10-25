// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/components/auth/LoginPage";

const auth = vi.hoisted(() => ({
  user: { id: "member-a", email: "member@example.test", user_metadata: {} } as Record<string, unknown> | null,
  unavailable: false,
}));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: {
  href: string; children: React.ReactNode;
}) => createElement("a", { href, ...props }, children) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn() }) }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => ({
  user: auth.user, loading: false, configured: true,
  supabaseAuthState: auth.unavailable ? "unavailable" : "authenticated",
  clerkIntegrationConfigured: false, socialProviders: { google: false, apple: false, microsoft: false },
  socialProvidersResolved: true, handle: null, welcomeBack: null,
  cancelAuthAttempt: vi.fn(), signOut: vi.fn(), switchAccount: vi.fn(), resumeSignIn: vi.fn(),
  signInWithEmail: vi.fn(), signInWithGoogle: vi.fn(), signInWithApple: vi.fn(),
}) }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let host: HTMLDivElement;
let root: Root;
beforeEach(() => {
  auth.user = { id: "member-a", email: "member@example.test", user_metadata: {} };
  auth.unavailable = false;
  localStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});
afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
});

describe("unavailable sign-in with a known account", () => {
  it.each([false, true])("keeps the map and profile doors after auth becomes unavailable, add account: %s", async (addAccount) => {
    await act(async () => root.render(<LoginPage addAccount={addAccount} />));
    if (addAccount) expect(host.querySelector('section[aria-label="Sign-in options"]')).not.toBeNull();
    auth.unavailable = true;
    await act(async () => root.render(<LoginPage addAccount={addAccount} />));
    const links = [...host.querySelectorAll("a")];
    expect(links.find((link) => link.textContent === "Continue to the map")?.getAttribute("href")).toBe("/map");
    expect(links.find((link) => link.textContent === "Your profile")?.getAttribute("href")).toBe("/u/you");
    if (addAccount) {
      expect(host.textContent).not.toContain("Browse without signing in");
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("still signed in");
      expect(host.querySelector('section[aria-label="Sign-in options"]')).toBeNull();
    }
  });

  it("keeps recovery and anonymous browsing when no account is known", async () => {
    auth.user = null;
    auth.unavailable = true;
    await act(async () => root.render(<LoginPage addAccount />));
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("Your account could not be checked.");
    expect([...host.querySelectorAll("button")].some((button) => button.textContent === "Try again")).toBe(true);
    expect([...host.querySelectorAll("a")].find((link) => link.textContent?.includes("Browse without signing in"))?.getAttribute("href")).toBe("/map");
    expect(host.textContent).not.toContain("Your profile");
  });
});
