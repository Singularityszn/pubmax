// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { Session, User } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/u/you",
  useSearchParams: () => new URLSearchParams(),
}));

import PubmaxxAccountHub from "@/components/profile/PubmaxxAccountHub";
import { AuthContext, useAuth } from "@/components/auth/authContext";
import { analyticsConsentDecision, setAnalyticsConsent } from "@/lib/analytics";
import { ANALYTICS_CONSENT_STORAGE_KEY } from "@/lib/analyticsIdentity";

const user: User = {
  id: "11111111-1111-4111-8111-111111111111",
  aud: "authenticated",
  email: "consent@example.invalid",
  app_metadata: {},
  user_metadata: {},
  created_at: "2026-10-15T00:00:00.000Z",
};
const session: Session = {
  user,
  access_token: "disposable-consent-test-token",
  refresh_token: "disposable-consent-test-refresh",
  token_type: "bearer",
  expires_in: 3600,
};

function Account({ signedIn }: { signedIn: boolean }) {
  const defaults = useAuth();
  return (
    <AuthContext.Provider value={{
      ...defaults,
      user: signedIn ? user : null,
      session: signedIn ? session : null,
      loading: false,
      handle: signedIn ? "consent_pints" : null,
      identityResolved: true,
      providerAuthState: signedIn ? "signed-in" : "signed-out",
      supabaseAuthState: signedIn ? "signed-in" : "signed-out",
      getCurrentUserId: () => signedIn ? user.id : null,
    }}>
      <PubmaxxAccountHub />
    </AuthContext.Provider>
  );
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.history.replaceState(null, "", "/u/you");
  vi.stubGlobal("matchMedia", (media: string) => ({
    media, matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    addListener: vi.fn(), removeListener: vi.fn(), dispatchEvent: vi.fn(),
  }));
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
    expect(url.origin).toBe(window.location.origin);
    return new Response(JSON.stringify({ profile: null, recaps: [], memories: [] }), {
      headers: { "content-type": "application/json" },
    });
  }));
  setAnalyticsConsent(false);
  window.localStorage.clear();
  host = document.body.appendChild(document.createElement("div"));
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  setAnalyticsConsent(false);
  vi.unstubAllGlobals();
});

async function mount(signedIn = true) {
  await act(async () => root.render(<Account signedIn={signedIn} />));
}

function settings(): HTMLElement {
  const section = host.querySelector('[aria-labelledby="account-settings-title"]');
  const controls = section?.querySelector<HTMLElement>("#analytics-settings");
  if (!controls) throw new Error("The account settings must contain the analytics controls.");
  return controls;
}

function button(label: string): HTMLButtonElement {
  const control = Array.from(settings().querySelectorAll("button"))
    .find((candidate) => candidate.textContent?.trim() === label);
  if (!control) throw new Error(`Missing analytics control: ${label}`);
  return control;
}

it("leaves the signed-out panel with no Allow / No thanks pair of its own", async () => {
  await mount(false);
  expect(host.textContent).toContain("On this device");
  expect(host.querySelector("#analytics-settings")).toBeNull();
  const labels = Array.from(host.querySelectorAll("button")).map((button) => button.textContent?.trim());
  expect(labels).not.toContain("Allow");
  expect(labels).not.toContain("No thanks");
  expect(analyticsConsentDecision()).toBeNull();
  expect(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBeNull();
});

it("keeps both undecided choices in the signed-in settings block", async () => {
  await mount();
  expect(settings().textContent).toContain("Optional usage analytics");
  expect(Array.from(settings().querySelectorAll("button")).map((control) => control.textContent?.trim()))
    .toEqual(["Allow", "No thanks"]);
  expect(button("Allow").disabled).toBe(false);
  expect(button("No thanks").disabled).toBe(false);
  expect(settings().querySelector('[role="status"]')).toBeNull();
  expect(analyticsConsentDecision()).toBeNull();
  expect(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBeNull();
});

it.each([
  { choice: "Allow", decision: "granted", status: "Usage analytics on.", reverse: "Withdraw" },
  { choice: "No thanks", decision: "denied", status: "Usage analytics off.", reverse: "Allow" },
])("persists $choice and updates the mounted status immediately", async ({ choice, decision, status, reverse }) => {
  await mount();
  await act(async () => button(choice).click());
  expect(analyticsConsentDecision()).toBe(decision);
  expect(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe(decision);
  expect(settings().querySelector('[role="status"]')?.textContent).toContain(status);
  expect(Array.from(settings().querySelectorAll("button")).map((control) => control.textContent?.trim()))
    .toEqual([reverse]);

  await act(async () => root.unmount());
  root = createRoot(host);
  await mount();
  expect(settings().querySelector('[role="status"]')?.textContent).toContain(status);
  expect(button(reverse).disabled).toBe(false);
  expect(analyticsConsentDecision()).toBe(decision);
});

it.each([
  { stored: "granted", initial: "Usage analytics on.", reverse: "Withdraw", next: "denied", nextStatus: "Usage analytics off.", restore: "Allow" },
  { stored: "denied", initial: "Usage analytics off.", reverse: "Allow", next: "granted", nextStatus: "Usage analytics on.", restore: "Withdraw" },
])("reads $stored consent and reverses it in both directions", async ({ stored, initial, reverse, next, nextStatus, restore }) => {
  window.localStorage.setItem(ANALYTICS_CONSENT_STORAGE_KEY, stored);
  await mount();
  expect(settings().querySelector('[role="status"]')?.textContent).toContain(initial);
  expect(analyticsConsentDecision()).toBe(stored);
  await act(async () => button(reverse).click());
  expect(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe(next);
  expect(analyticsConsentDecision()).toBe(next);
  expect(settings().querySelector('[role="status"]')?.textContent).toContain(nextStatus);
  await act(async () => button(restore).click());
  expect(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe(stored);
  expect(analyticsConsentDecision()).toBe(stored);
  expect(settings().querySelector('[role="status"]')?.textContent).toContain(initial);
});

it("refreshes the mounted control when another consent consumer changes the decision", async () => {
  await mount();
  await act(async () => setAnalyticsConsent(true));
  expect(settings().querySelector('[role="status"]')?.textContent).toContain("Usage analytics on.");
  expect(button("Withdraw").disabled).toBe(false);
  await act(async () => setAnalyticsConsent(false));
  expect(settings().querySelector('[role="status"]')?.textContent).toContain("Usage analytics off.");
  expect(button("Allow").disabled).toBe(false);
  expect(window.localStorage.getItem(ANALYTICS_CONSENT_STORAGE_KEY)).toBe("denied");
});
