// @vitest-environment jsdom

import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({
  accountRevision: 0,
  user: { id: "optional-details-owner" },
  session: { user: { id: "optional-details-owner" }, access_token: "local-test-token" },
  loading: false,
  identityResolved: true,
  configured: true,
  handle: null,
}));

vi.mock("@/components/auth/AuthProvider", () => ({ useAuth: () => auth }));
vi.mock("@/components/auth/authContext", () => ({ useAuth: () => auth }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/u/you",
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/lib/authClient", () => ({ getAccessToken: async () => "local-test-token" }));

import PubmaxxAccountHub from "@/components/profile/PubmaxxAccountHub";
import { AccountOnboardingForm } from "@/components/identity/AccountOnboarding";
import { forgetCurrentIdentityRead } from "@/lib/currentIdentityRead";
import { publishAuthActionState } from "@/lib/authedFetch";

it("keeps unclaimed profile guidance consistent with optional onboarding details", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }));
  publishAuthActionState({ status: "signed-in", identityResolved: true });
  forgetCurrentIdentityRead();
  localStorage.clear();
  const requests = vi.fn<typeof fetch>(async () => Response.json({ handle: null, profile: null, pending: [] }));
  vi.stubGlobal("fetch", requests);
  const host = document.body.appendChild(document.createElement("div"));
  const root = createRoot(host);
  try {
    await act(async () => root.render(createElement(PubmaxxAccountHub)));
    expect(host.textContent).toContain("Claim your @handle");
    expect(host.textContent).toContain("Your name and date of birth are optional.");
    expect(host.textContent).not.toContain("Claiming a handle alone is not enough");
    expect(requests.mock.calls.some(([, init]) => init?.method === "POST")).toBe(false);
    await act(async () => root.render(createElement(AccountOnboardingForm, {
      handle: "night_owl", dateOfBirth: "", fullName: "", availability: "available",
      busy: false, error: null, onHandleChange: vi.fn(), onDateOfBirthChange: vi.fn(),
      onFullNameChange: vi.fn(), onSubmit: vi.fn(),
    })));
    const labels = [...host.querySelectorAll("label")];
    expect(labels.find((label) => label.textContent?.startsWith("Name"))?.textContent).toContain("Optional");
    expect(labels.find((label) => label.textContent?.startsWith("Date of birth"))?.textContent).toContain("Optional");
    const claim = [...host.querySelectorAll("button")].find((button) => button.textContent === "Claim handle");
    expect(claim).toBeDefined();
    expect(claim?.disabled).toBe(false);
    expect(host.querySelector<HTMLInputElement>('input[type="date"]')?.value).toBe("");
  } finally {
    await act(async () => root.unmount());
    host.remove();
    forgetCurrentIdentityRead();
    publishAuthActionState({ status: "unknown", identityResolved: false });
    vi.unstubAllGlobals();
  }
});
