// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  setSession: vi.fn(),
  getUser: vi.fn(),
  mintSession: vi.fn(),
  localAttemptOwned: false,
}));

vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/posthog/posthogPerson", () => ({ syncPosthogPersonIdentity: vi.fn() }));
vi.mock("@/lib/authClient", () => ({
  isAuthConfigured: () => true,
  ensureSupabaseBrowser: async () => ({
    auth: {
      getUser: harness.getUser,
      setSession: harness.setSession,
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe: vi.fn() } } }),
      signOut: vi.fn(),
    },
  }),
}));
vi.mock("@/lib/authProviderAvailability", () => ({
  loadSocialAuthProviders: async () => ({ google: false, apple: false, microsoft: false }),
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
}));
vi.mock("@/lib/deviceAccountSwitch", () => ({
  mintSessionFromRefreshToken: harness.mintSession,
  browserDeviceAccountSwitchDeps: () => ({ authConfig: null, fetchImpl: vi.fn() }),
  activateDeviceAccount: vi.fn(),
}));
vi.mock("@/lib/authRedirect", () => ({
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT: "pubmax-auth-return-fragment-restored",
  scrubAuthCallback: async () => ({
    attempt: {
      attemptId: null,
      tokens: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" },
      providerError: false,
    },
    cleanUrl: "/map",
    localAttemptOwned: harness.localAttemptOwned,
    releaseCoordination: vi.fn(),
  }),
  scrubLingeringAuthCallback: vi.fn(() => false),
}));
vi.mock("@/lib/authSessionBootstrap", () => ({
  AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS: 20_000,
  bootstrapAuthSession: async () => ({ status: "none" }),
}));
vi.mock("@/lib/identityClient", () => ({
  handleClaimRouteAfterSignIn: async () => null,
  IDENTITY_HANDLE_CHANGED_EVENT: "pubmax:identity-handle-changed",
  identityHandleForOwner: () => null,
  resolveCanonicalIdentity: async () => null,
}));
vi.mock("@/lib/referralClaimClient", () => ({
  claimSignupReferralFromAuthCallback: async () => {},
  withReferralSignupProof: (attempt: unknown) => attempt,
}));

import { AuthProvider } from "@/components/auth/AuthProvider";

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  harness.localAttemptOwned = false;
  harness.setSession.mockReset();
  harness.getUser.mockReset();
  harness.mintSession.mockReset();
  harness.getUser.mockResolvedValue({
    data: { user: { id: "account-a", email: "person@example.com" } },
    error: null,
  });
  harness.setSession.mockResolvedValue({
    data: {
      session: {
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        user: { id: "account-a", email: "person@example.com" },
      },
    },
    error: null,
  });
  harness.mintSession.mockResolvedValue({
    status: "minted",
    session: { access_token: "synthetic-access", refresh_token: "synthetic-refresh" },
  });
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container?.remove();
  root = null;
  container = null;
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: false });
});

async function mount(): Promise<void> {
  await act(async () => {
    root?.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }));
  });
}

describe("unowned auth callback confirmation", () => {
  it("shows the verified account and leaves session untouched when cancelled", async () => {
    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
    expect(harness.setSession).not.toHaveBeenCalled();
    const cancel = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Cancel");
    await act(async () => cancel?.click());
    expect(harness.setSession).not.toHaveBeenCalled();
    expect(container?.textContent).not.toContain("Sign in as person@example.com?");
  });

  it("installs an unowned callback only after Continue", async () => {
    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
    expect(harness.setSession).not.toHaveBeenCalled();
    const continueButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Continue");
    await act(async () => continueButton?.click());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());
    expect(container?.textContent).toContain("Signed in as person@example.com.");
  });

  it("leaves an invalid unowned callback unsigned-in", async () => {
    harness.getUser.mockResolvedValue({ data: { user: null }, error: new Error("invalid") });
    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign-in could not be completed."));
    expect(harness.setSession).not.toHaveBeenCalled();
  });

  it("does not offer confirmation for mismatched access and refresh identities", async () => {
    harness.getUser.mockImplementation(async (accessToken: string) => ({
      data: { user: accessToken === "synthetic-access"
        ? { id: "account-a", email: "a@example.com" }
        : { id: "account-b", email: "b@example.com" } },
      error: null,
    }));
    harness.mintSession.mockResolvedValue({
      status: "minted",
      session: { access_token: "access-b", refresh_token: "refresh-b" },
    });
    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign-in could not be completed."));
    expect(container?.textContent).not.toContain("Sign in as a@example.com?");
    expect(harness.setSession).not.toHaveBeenCalled();
  });

  it("completes a locally owned callback without a confirmation step", async () => {
    harness.localAttemptOwned = true;
    await mount();
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());
    expect(harness.getUser).not.toHaveBeenCalled();
    expect(container?.textContent).not.toContain("Sign in as person@example.com?");
  });
});
