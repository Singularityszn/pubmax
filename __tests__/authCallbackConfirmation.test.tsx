// @vitest-environment jsdom
import { act, createElement, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const harness = vi.hoisted(() => ({
  setSession: vi.fn(),
  bootstrap: vi.fn(),
  getUser: vi.fn(),
  mintSession: vi.fn(),
  scrubCallback: vi.fn(),
  releaseCoordination: vi.fn(),
  socialProviderLoads: vi.fn(),
  localAttemptOwned: false,
  hasCallback: true,
  existingSession: null as null | {
    access_token: string;
    refresh_token: string;
    user: { id: string; email: string };
  },
}));

vi.mock("@/components/auth/ArrivalWelcome", () => ({ default: () => null }));
vi.mock("@/components/identity/AccountOnboarding", () => ({ default: () => null }));
vi.mock("@/components/identity/IdentityNudge", () => ({ default: () => null }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
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
  loadSocialAuthProviders: async () => {
    harness.socialProviderLoads();
    return { google: false, apple: false, microsoft: false };
  },
  NO_SOCIAL_AUTH_PROVIDERS: { google: false, apple: false, microsoft: false },
}));
vi.mock("@/lib/deviceAccountSwitch", () => ({
  mintSessionFromRefreshToken: harness.mintSession,
  browserDeviceAccountSwitchDeps: () => ({
    authConfig: { url: "https://provider.example", key: "public-key" },
    fetchImpl: async (_url: string, init: RequestInit) => {
      const token = defined((init.headers as Record<string, string>).authorization).slice(7);
      const result = await harness.getUser(token);
      return new Response(JSON.stringify(result.error ?? result.data.user), { status: result.error ? 403 : 200 });
    },
  }),
  activateDeviceAccount: vi.fn(),
}));
vi.mock("@/lib/authRedirect", () => ({
  AUTH_RETURN_FRAGMENT_RESTORED_EVENT: "pubmax-auth-return-fragment-restored",
  scrubAuthCallback: async () => {
    harness.scrubCallback();
    if (!harness.hasCallback) return null;
    return {
      attempt: {
        attemptId: null,
        tokens: { accessToken: "synthetic-access", refreshToken: "synthetic-refresh" },
        providerError: false,
      },
      cleanUrl: "/map",
      localAttemptOwned: harness.localAttemptOwned,
      releaseCoordination: harness.releaseCoordination,
    };
  },
  scrubLingeringAuthCallback: vi.fn(() => false),
}));
vi.mock("@/lib/authSessionBootstrap", () => ({
  AUTH_SESSION_BOOTSTRAP_TIMEOUT_MS: 20_000,
  bootstrapAuthSession: harness.bootstrap,
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

import { AuthProvider, useAuth } from "@/components/auth/AuthProvider";
import { defined } from "@/__tests__/helpers/defined";

function ViewerProbe() {
  const { user, loading } = useAuth();
  return createElement("output", { "data-testid": "viewer", "aria-busy": loading }, user?.id ?? "signed-out");
}

let root: Root | null = null;
let container: HTMLDivElement | null = null;

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  harness.localAttemptOwned = false;
  harness.hasCallback = true;
  harness.existingSession = null;
  harness.bootstrap.mockReset();
  harness.bootstrap.mockImplementation(async () => harness.existingSession
    ? { status: "local", session: harness.existingSession }
    : { status: "none" });
  harness.setSession.mockReset();
  harness.getUser.mockReset();
  harness.mintSession.mockReset();
  harness.scrubCallback.mockReset();
  harness.releaseCoordination.mockReset();
  harness.socialProviderLoads.mockReset();
  harness.getUser.mockResolvedValue({
    data: { user: { id: "account-a", email: "person@example.com", email_confirmed_at: "2026-01-01T00:00:00.000Z" } },
    error: null,
  });
  harness.setSession.mockResolvedValue({
    data: {
      session: {
        access_token: "synthetic-access",
        refresh_token: "synthetic-refresh",
        user: { id: "account-a", email: "person@example.com", email_confirmed_at: "2026-01-01T00:00:00.000Z" },
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
    root?.render(createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(ViewerProbe)));
  });
}

describe("unowned auth callback confirmation", () => {
  it.each(["none", "restored", "expired", "banned", "unavailable", "rejected"])(
    "keeps loading until a %s bootstrap settles without a callback",
    async (status) => {
      harness.hasCallback = false;
      let finishBootstrap!: (value: unknown) => void;
      let rejectBootstrap!: (reason: Error) => void;
      harness.bootstrap.mockImplementation(() => new Promise((resolve, reject) => {
        finishBootstrap = resolve;
        rejectBootstrap = reject;
      }));

      await mount();
      expect(harness.bootstrap).toHaveBeenCalledOnce();
      expect(container?.querySelector('[data-testid="viewer"]')?.getAttribute("aria-busy")).toBe("true");

      await act(async () => {
        if (status === "rejected") rejectBootstrap(new Error("offline"));
        else finishBootstrap({
          status,
          session: { access_token: "access-b", refresh_token: "refresh-b" },
          maskedEmail: "b@example.com",
          message: "Account unavailable",
        });
      });

      expect(container?.querySelector('[data-testid="viewer"]')?.getAttribute("aria-busy")).toBe("false");
      expect(harness.setSession).not.toHaveBeenCalled();
    },
  );

  it("holds one confirmation through StrictMode effect replay", async () => {
    await act(async () => {
      root?.render(createElement(
        StrictMode,
        null,
        createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(ViewerProbe)),
      ));
    });

    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in as person@example.com?"));
    expect(harness.socialProviderLoads).toHaveBeenCalledTimes(2);
    expect(container?.textContent?.match(/Sign in as person@example.com\?/g)).toHaveLength(1);
    expect(harness.scrubCallback).toHaveBeenCalledOnce();
    expect(harness.mintSession).toHaveBeenCalledOnce();
    expect(harness.releaseCoordination).toHaveBeenCalledOnce();
    expect(harness.setSession).not.toHaveBeenCalled();

    const continueButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Continue");
    await act(async () => continueButton?.click());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());
    expect(container?.textContent).toContain("Signed in as person@example.com.");
  });

  it.each(["Continue", "Cancel"])("publishes restored B before allowing %s under StrictMode", async (action) => {
    let finishBootstrap!: (value: unknown) => void;
    harness.bootstrap.mockImplementation(() => new Promise((resolve) => { finishBootstrap = resolve; }));
    await act(async () => {
      root?.render(createElement(StrictMode, null,
        createElement(AuthProvider, { clerkIntegrationConfigured: false }, createElement(ViewerProbe))));
    });
    expect(harness.bootstrap).toHaveBeenCalledOnce();
    expect(container?.querySelector('[data-testid="viewer"]')?.getAttribute("aria-busy")).toBe("true");
    expect(container?.textContent).not.toContain("Sign in as person@example.com?");
    expect(harness.setSession).not.toHaveBeenCalled();
    await act(async () => finishBootstrap({ status: "local", session: {
      access_token: "access-b", refresh_token: "refresh-b", user: { id: "account-b", email: "b@example.com" },
    } }));
    expect(container?.querySelector('[data-testid="viewer"]')?.textContent).toBe("account-b");
    expect(container?.querySelector('[data-testid="viewer"]')?.getAttribute("aria-busy")).toBe("false");
    expect(container?.textContent).toContain("Sign in as person@example.com?");
    const button = [...container!.querySelectorAll("button")].find((button) => button.textContent === action);
    await act(async () => button?.click());
    expect(container?.querySelector('[data-testid="viewer"]')?.textContent).toBe(action === "Continue" ? "account-a" : "account-b");
    expect(harness.setSession).toHaveBeenCalledTimes(action === "Continue" ? 1 : 0);
  });

  it("keeps an existing account active when the reader cancels another account's callback", async () => {
    harness.existingSession = {
      access_token: "existing-access-b",
      refresh_token: "existing-refresh-b",
      user: { id: "account-b", email: "existing@example.com" },
    };

    await mount();
    await vi.waitFor(() => {
      expect(container?.textContent).toContain("Sign in as person@example.com?");
      expect(container?.querySelector('[data-testid="viewer"]')?.textContent).toBe("account-b");
    });
    expect(harness.setSession).not.toHaveBeenCalled();

    const cancel = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Cancel");
    await act(async () => cancel?.click());

    expect(container?.textContent).not.toContain("Sign in as person@example.com?");
    expect(container?.querySelector('[data-testid="viewer"]')?.textContent).toBe("account-b");
    expect(harness.setSession).not.toHaveBeenCalled();
  });

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

  it("asks to sign in to this account when the email is unverified", async () => {
    harness.getUser.mockResolvedValue({
      data: { user: { id: "account-a", email: "victim@example.com" } },
      error: null,
    });
    harness.setSession.mockResolvedValue({
      data: {
        session: {
          access_token: "synthetic-access",
          refresh_token: "synthetic-refresh",
          user: { id: "account-a", email: "victim@example.com" },
        },
      },
      error: null,
    });
    await mount();
    await vi.waitFor(() => expect(container?.textContent).toContain("Sign in to this account?"));
    expect(container?.textContent).not.toContain("victim@example.com");
    expect(container?.textContent).not.toContain("account-a?");
    const continueButton = [...container!.querySelectorAll("button")].find((button) => button.textContent === "Continue");
    await act(async () => continueButton?.click());
    await vi.waitFor(() => expect(harness.setSession).toHaveBeenCalledOnce());
    await vi.waitFor(() => expect(container?.textContent).toContain("Signed in."));
    expect(container?.textContent).not.toContain("victim@example.com");
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
