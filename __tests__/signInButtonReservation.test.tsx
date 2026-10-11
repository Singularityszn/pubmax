// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import SignInButton from "@/components/auth/SignInButton";

const auth = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth.current }));
vi.mock("@/components/auth/usePublicProfileCard", () => ({ usePublicProfileCard: () => null }));
vi.mock("next/navigation", () => ({ usePathname: () => "/places" }));

const base = {
  configured: true, user: null, handle: null, clerkIntegrationConfigured: false,
  supabaseAuthState: "unresolved", socialProviders: { google: false, apple: false, microsoft: false },
  signInWithEmail: async () => ({}), cancelAuthAttempt: () => {}, signOut: async () => {},
};
let host: HTMLDivElement;
let root: Root | null;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  auth.current = { ...base };
  localStorage.clear();
  host = document.createElement("div");
  document.body.appendChild(host);
  root = null;
});
afterEach(() => {
  act(() => root?.unmount());
  host.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function render(phone = false, compact = true) {
  vi.stubGlobal("matchMedia", () => ({
    matches: phone, addEventListener() {}, removeEventListener() {},
  }));
  root ??= createRoot(host);
  act(() => root?.render(createElement(SignInButton, { compact })));
}

function assertReservation() {
  const reservation = host.querySelector<HTMLElement>("[data-auth-empty]");
  expect(reservation).not.toBeNull();
  expect(reservation?.hidden).toBe(false);
  expect(reservation?.getAttribute("aria-hidden")).toBe("true");
  expect(reservation?.hasAttribute("inert")).toBe(true);
  expect(reservation?.classList.contains("authUserNav")).toBe(true);
  expect(reservation?.querySelector(".authCompactTrigger")).not.toBeNull();
  expect(reservation?.querySelector("button, a, input, [tabindex]")).toBeNull();
}

describe("compact unresolved account reservation", () => {
  it("reserves an inert compact shell in server output and through hydration", async () => {
    host.innerHTML = renderToString(createElement(SignInButton, { compact: true }));
    assertReservation();
    await act(async () => { root = hydrateRoot(host, createElement(SignInButton, { compact: true })); });
    assertReservation();
  });

  it.each([true, false])("keeps identity unknown until settlement with phone=%s", (phone) => {
    render(phone);
    assertReservation();
    auth.current = { ...base, supabaseAuthState: "signed-out" };
    render(phone);
    const control = host.querySelector<HTMLElement>(".authCompactTrigger");
    expect(control?.getAttribute("aria-label")).toBe("Sign in");
    expect(control?.closest("[aria-hidden=true], [inert]")).toBeNull();
    expect(control?.tagName).toBe(phone ? "A" : "BUTTON");
    if (phone) expect(control?.getAttribute("href")).toBe("/login?from=%2Fplaces");
    else {
      act(() => control?.click());
      expect(host.querySelector(".authMenu input[type=email]")).not.toBeNull();
    }
  });

  it.each(["Mia", "A very long signed-in display name"])("keeps the account name in the accessible control for %s", (name) => {
    render();
    assertReservation();
    auth.current = { ...base, supabaseAuthState: "authenticated", user: {
      id: "local-fixture", email: "reader@example.test", user_metadata: { full_name: name },
    } };
    render();
    const control = host.querySelector<HTMLElement>(".authCompactTrigger");
    expect(control?.getAttribute("aria-label")).toBe(`Account options for ${name}`);
    expect(control?.querySelector(".authCompactLabel")?.textContent).toBe("Account");
    expect(control?.closest("[aria-hidden=true], [inert]")).toBeNull();
  });

  it("keeps unavailable identity inert and unconfigured identity empty", () => {
    auth.current = { ...base, supabaseAuthState: "unavailable" };
    render();
    assertReservation();
    auth.current = { ...base, configured: false };
    render();
    expect(host.querySelector<HTMLElement>("[data-auth-empty]")?.hidden).toBe(true);
    expect(host.querySelector(".authCompactTrigger")).toBeNull();
  });

  it("leaves a non-compact unresolved wall empty", () => {
    render(false, false);
    expect(host.querySelector<HTMLElement>("[data-auth-empty]")?.hidden).toBe(true);
    expect(host.querySelector(".authCompactTrigger")).toBeNull();
  });
});
